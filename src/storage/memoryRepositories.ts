import { LOCAL_AUDIT_RETENTION_LIMIT } from '@/audit/types'
import { LOCAL_COMMAND_RETENTION_LIMIT } from '@/commands/repository'

import type { ControlModeRepository } from './controlModeRepository'
import type { AuditRecord, AuditRepository } from '@/audit/types'
import type { CommandClaim, CommandRepository } from '@/commands/repository'
import type {
  CommandOutcome,
  CommandStatus,
  ControlMode,
  LocalCommand,
  StoredCommand,
} from '@/commands/types'


function statusForOutcome(outcome: CommandOutcome): CommandStatus {
  if (outcome.ok) return 'succeeded'
  if (outcome.error.code === 'cancelled') return 'cancelled'
  if (outcome.error.code === 'expired') return 'expired'
  if (outcome.error.code === 'result_unknown') return 'unknown_after_crash'
  if (outcome.error.code === 'confirmation_required' || outcome.error.code === 'disabled') {
    return 'rejected'
  }
  return 'failed'
}

export class MemoryCommandRepository implements CommandRepository {
  readonly records = new Map<string, StoredCommand>()
  #terminalCount = 0

  async get(commandId: string): Promise<StoredCommand | null> {
    return this.records.get(commandId) ?? null
  }

  async claim(command: LocalCommand, receivedAt: string): Promise<CommandClaim> {
    const existing = this.records.get(command.commandId)
    if (existing !== undefined) {
      return existing.outcome === null
        ? { kind: 'in_progress' }
        : { kind: 'replay', outcome: existing.outcome }
    }
    this.records.set(command.commandId, {
      commandId: command.commandId,
      completedAt: null,
      outcome: null,
      path: command.path,
      receivedAt,
      status: 'running',
      tool: command.tool,
    })
    return { kind: 'started' }
  }

  async complete(commandId: string, outcome: CommandOutcome, completedAt: string): Promise<void> {
    const existing = this.records.get(commandId)
    if (existing === undefined || existing.status !== 'running') {
      throw new Error('命令终态写入失败或已存在终态')
    }
    this.records.set(commandId, {
      ...existing,
      completedAt,
      outcome,
      status: statusForOutcome(outcome),
    })
    this.#terminalCount += 1
    this.#pruneToHardLimit(commandId, LOCAL_COMMAND_RETENTION_LIMIT)
  }

  async recoverInterrupted(recoveredAt: string): Promise<number> {
    let recovered = 0
    for (const [commandId, record] of this.records) {
      if (record.status !== 'running') continue
      const outcome: CommandOutcome = {
        error: {
          code: 'result_unknown',
          message: 'App 在命令执行期间中断；为避免重复副作用，命令不会自动重放',
          retryable: false,
        },
        ok: false,
      }
      this.records.set(commandId, {
        ...record,
        completedAt: recoveredAt,
        outcome,
        status: 'unknown_after_crash',
      })
      this.#terminalCount += 1
      recovered += 1
    }
    return recovered
  }

  async pruneTerminal(retainCount: number): Promise<number> {
    return this.#pruneToHardLimit(null, Math.max(1, retainCount))
  }

  #pruneToHardLimit(protectedCommandId: string | null, retainCount: number): number {
    const deleteCount = Math.max(0, this.#terminalCount - retainCount)
    if (deleteCount === 0) return 0
    const recordsToDelete = [...this.records.values()]
      .filter(record => (
        record.status !== 'running' && record.commandId !== protectedCommandId
      ))
      .sort((left, right) => (
        left.receivedAt.localeCompare(right.receivedAt)
        || left.commandId.localeCompare(right.commandId)
      ))
      .slice(0, deleteCount)
    for (const record of recordsToDelete) this.records.delete(record.commandId)
    this.#terminalCount -= recordsToDelete.length
    return recordsToDelete.length
  }
}

export class MemoryAuditRepository implements AuditRepository {
  readonly records: AuditRecord[] = []

  async add(record: AuditRecord): Promise<void> {
    this.records.unshift(record)
    this.records.splice(LOCAL_AUDIT_RETENTION_LIMIT)
  }

  async clear(): Promise<number> {
    const deleted = this.records.length
    this.records.splice(0)
    return deleted
  }

  async listRecent(limit: number): Promise<readonly AuditRecord[]> {
    return this.records.slice(0, limit)
  }

  async prune(retainCount: number): Promise<number> {
    const boundedRetainCount = Math.max(1, retainCount)
    const deleted = Math.max(0, this.records.length - boundedRetainCount)
    this.records.splice(boundedRetainCount)
    return deleted
  }
}

export class MemoryControlModeRepository implements ControlModeRepository {
  constructor(private mode: ControlMode = 'ask_every_time') {}

  async get(): Promise<ControlMode> {
    return this.mode
  }

  async set(mode: ControlMode): Promise<void> {
    this.mode = mode
  }
}
