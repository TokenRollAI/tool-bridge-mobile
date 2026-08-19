import { LOCAL_COMMAND_RETENTION_LIMIT } from '@/commands/repository'
import { commandOutcomeSchema } from '@/commands/types'

import type { MobileDatabase } from './database'
import type { CommandRepository, CommandClaim } from '@/commands/repository'
import type {
  CommandOutcome,
  CommandStatus,
  LocalCommand,
  StoredCommand,
} from '@/commands/types'


type CommandRow = Readonly<{
  command_id: string
  completed_at: string | null
  outcome_json: string | null
  path: string
  received_at: string
  status: CommandStatus
  tool: string
}>

const PRUNE_TERMINAL_SQL = `DELETE FROM commands WHERE command_id IN (
  SELECT command_id FROM commands
  WHERE status <> 'running'
    AND command_id <> ?
    AND command_id NOT IN (
      SELECT source_command_id FROM timers
      WHERE state IN ('preparing', 'scheduled', 'cancelling', 'status_unknown')
    )
  ORDER BY received_at ASC, command_id ASC
  LIMIT (
    SELECT CASE WHEN COUNT(*) > ? THEN COUNT(*) - ? ELSE 0 END
    FROM commands WHERE status <> 'running'
  )
)`

function parseOutcome(source: string | null): CommandOutcome | null {
  if (source === null) return null
  const parsed: unknown = JSON.parse(source)
  const outcome = commandOutcomeSchema.safeParse(parsed)
  if (!outcome.success) throw new Error('命令终态 JSON 无效')
  return outcome.data
}

function toStoredCommand(row: CommandRow): StoredCommand {
  return {
    commandId: row.command_id,
    completedAt: row.completed_at,
    outcome: parseOutcome(row.outcome_json),
    path: row.path,
    receivedAt: row.received_at,
    status: row.status,
    tool: row.tool,
  }
}

function outcomeStatus(outcome: CommandOutcome): CommandStatus {
  if (outcome.ok) return 'succeeded'
  if (outcome.error.code === 'cancelled') return 'cancelled'
  if (outcome.error.code === 'expired') return 'expired'
  if (
    outcome.error.code === 'confirmation_required'
    || outcome.error.code === 'disabled'
    || outcome.error.code === 'permission_denied'
  ) return 'rejected'
  if (outcome.error.code === 'result_unknown') return 'unknown_after_crash'
  return 'failed'
}

export class SqliteCommandRepository implements CommandRepository {
  constructor(private readonly database: MobileDatabase) {}

  async get(commandId: string): Promise<StoredCommand | null> {
    const row = await this.database.raw.getFirstAsync<CommandRow>(
      `SELECT command_id, path, tool, status, outcome_json, received_at, completed_at
       FROM commands WHERE command_id = ?`,
      commandId,
    )
    return row === null ? null : toStoredCommand(row)
  }

  async claim(command: LocalCommand, receivedAt: string): Promise<CommandClaim> {
    let claim: CommandClaim | null = null
    await this.database.raw.withExclusiveTransactionAsync(async transaction => {
      const insertion = await transaction.runAsync(
        `INSERT OR IGNORE INTO commands(
          command_id, path, tool, status, outcome_json, received_at, completed_at
        ) VALUES (?, ?, ?, 'running', NULL, ?, NULL)`,
        command.commandId,
        command.path,
        command.tool,
        receivedAt,
      )
      if (insertion.changes === 1) {
        claim = { kind: 'started' }
        return
      }

      const existing = await transaction.getFirstAsync<CommandRow>(
        `SELECT command_id, path, tool, status, outcome_json, received_at, completed_at
         FROM commands WHERE command_id = ?`,
        command.commandId,
      )
      if (existing === null) throw new Error('命令 claim 冲突后未找到记录')
      const stored = toStoredCommand(existing)
      claim = stored.outcome === null
        ? { kind: 'in_progress' }
        : { kind: 'replay', outcome: stored.outcome }
    })
    if (claim === null) throw new Error('命令 claim 事务没有结果')
    return claim
  }

  async complete(commandId: string, outcome: CommandOutcome, completedAt: string): Promise<void> {
    await this.database.raw.withExclusiveTransactionAsync(async transaction => {
      const update = await transaction.runAsync(
        `UPDATE commands
         SET status = ?, outcome_json = ?, completed_at = ?
         WHERE command_id = ? AND status = 'running'`,
        outcomeStatus(outcome),
        JSON.stringify(outcome),
        completedAt,
        commandId,
      )
      if (update.changes !== 1) throw new Error('命令终态写入失败或已存在终态')
      await transaction.runAsync(
        PRUNE_TERMINAL_SQL,
        commandId,
        LOCAL_COMMAND_RETENTION_LIMIT,
        LOCAL_COMMAND_RETENTION_LIMIT,
      )
    })
  }

  async recoverInterrupted(recoveredAt: string): Promise<number> {
    const outcome: CommandOutcome = {
      error: {
        code: 'result_unknown',
        message: 'App 在命令执行期间中断；为避免重复副作用，命令不会自动重放',
        retryable: false,
      },
      ok: false,
    }
    const update = await this.database.raw.runAsync(
      `UPDATE commands
       SET status = 'unknown_after_crash', outcome_json = ?, completed_at = ?
       WHERE status = 'running'`,
      JSON.stringify(outcome),
      recoveredAt,
    )
    return update.changes
  }

  async pruneTerminal(retainCount: number): Promise<number> {
    const boundedRetainCount = Math.max(1, Math.min(retainCount, 20_000))
    const deletion = await this.database.raw.runAsync(
      PRUNE_TERMINAL_SQL,
      '',
      boundedRetainCount,
      boundedRetainCount,
    )
    return deletion.changes
  }
}
