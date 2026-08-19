import {
  MemoryAuditRepository,
  MemoryCommandRepository,
} from '../memoryRepositories'

import type { AuditRecord } from '@/audit/types'
import type { LocalCommand } from '@/commands/types'

function command(index: number): LocalCommand {
  const timestamp = new Date(index * 1_000).toISOString()
  return {
    arguments: {},
    caller: { subjectId: 'retention_fixture' },
    commandId: `command_${index.toString().padStart(5, '0')}`,
    createdAt: timestamp,
    expiresAt: '2099-01-01T00:00:00.000Z',
    path: 'phone/status',
    tool: 'get',
  }
}

function auditRecord(index: number): AuditRecord {
  return {
    callerSubjectId: 'retention_fixture',
    clientVersion: '0.1.0',
    commandId: `command_${index}`,
    decision: 'allowed',
    effect: 'read',
    id: `audit_${index}`,
    occurredAt: new Date(index * 1_000).toISOString(),
    outcomeCode: 'succeeded',
    path: 'phone/status',
    risk: 'low',
    tool: 'get',
  }
}

describe('bounded local retention', () => {
  test('每次完成后终态都不超过 10,000 条，运行中命令不被清理', async () => {
    const repository = new MemoryCommandRepository()
    for (let index = 0; index < 10_050; index += 1) {
      const item = command(index)
      await repository.claim(item, item.createdAt)
      await repository.complete(item.commandId, { ok: true, value: null }, item.createdAt)
    }
    const running = command(20_000)
    await repository.claim(running, running.createdAt)

    await expect(repository.pruneTerminal(10_000)).resolves.toBe(0)
    expect(repository.records.size).toBe(10_001)
    expect(repository.records.get(running.commandId)?.status).toBe('running')
    expect(repository.records.has('command_00000')).toBe(false)
  })

  test('刚写入的终态不会在自己的完成事务中立刻被淘汰', async () => {
    const repository = new MemoryCommandRepository()
    for (let index = 1; index <= 10_000; index += 1) {
      const item = command(index)
      await repository.claim(item, item.createdAt)
      await repository.complete(item.commandId, { ok: true, value: null }, item.createdAt)
    }
    const lateOldCommand = {
      ...command(0),
      commandId: 'command_late_old',
      createdAt: '1970-01-01T00:00:00.000Z',
    }
    await repository.claim(lateOldCommand, lateOldCommand.createdAt)
    await repository.complete(
      lateOldCommand.commandId,
      { ok: true, value: null },
      lateOldCommand.createdAt,
    )

    expect(repository.records.size).toBe(10_000)
    expect(repository.records.has(lateOldCommand.commandId)).toBe(true)
    expect(repository.records.has('command_00001')).toBe(false)
  })

  test('审计记录在每次写入后都不超过硬上限并保留最新元数据', async () => {
    const repository = new MemoryAuditRepository()
    for (let index = 0; index < 5_010; index += 1) {
      await repository.add(auditRecord(index))
    }

    expect(repository.records).toHaveLength(5_000)
    expect(repository.records[0]?.id).toBe('audit_5009')
    expect(repository.records.at(-1)?.id).toBe('audit_10')
    await expect(repository.prune(5_000)).resolves.toBe(0)
    await expect(repository.clear()).resolves.toBe(5_000)
    await expect(repository.clear()).resolves.toBe(0)
  })
})
