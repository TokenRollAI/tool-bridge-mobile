import { LOCAL_COMMAND_RETENTION_LIMIT } from '@/commands/repository'

import { SqliteCommandRepository } from '../commandRepository'

import type { MobileDatabase } from '../database'

describe('SqliteCommandRepository retention', () => {
  test('终态写入与硬上限裁剪在同一 exclusive transaction', async () => {
    const transaction = {
      runAsync: jest.fn(async (..._arguments: unknown[]) => ({ changes: 1 })),
    }
    const raw = {
      withExclusiveTransactionAsync: jest.fn(async (
        callback: (value: typeof transaction) => Promise<void>,
      ) => callback(transaction)),
    }
    const repository = new SqliteCommandRepository({ raw } as unknown as MobileDatabase)

    await repository.complete(
      'command_current',
      { ok: true, value: { status: 'done' } },
      '2026-08-19T00:00:01.000Z',
    )

    expect(raw.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1)
    expect(transaction.runAsync).toHaveBeenCalledTimes(2)
    expect(transaction.runAsync.mock.calls[0]?.[0]).toContain('UPDATE commands')
    const pruneCall = transaction.runAsync.mock.calls[1]
    const pruneSql = pruneCall?.[0]
    expect(pruneSql).toContain("status <> 'running'")
    expect(pruneSql).toContain('command_id <> ?')
    expect(pruneSql).toContain('SELECT source_command_id FROM timers')
    expect(pruneSql).toContain("'preparing', 'scheduled', 'cancelling', 'status_unknown'")
    expect(pruneSql).toContain('ORDER BY received_at ASC, command_id ASC')
    expect(pruneCall?.slice(1)).toEqual([
      'command_current',
      LOCAL_COMMAND_RETENTION_LIMIT,
      LOCAL_COMMAND_RETENTION_LIMIT,
    ])
  })

  test('终态 UPDATE 失败时不会继续裁剪且事务拒绝', async () => {
    const transaction = {
      runAsync: jest.fn(async (..._arguments: unknown[]) => ({ changes: 0 })),
    }
    const raw = {
      withExclusiveTransactionAsync: jest.fn(async (
        callback: (value: typeof transaction) => Promise<void>,
      ) => callback(transaction)),
    }
    const repository = new SqliteCommandRepository({ raw } as unknown as MobileDatabase)

    await expect(repository.complete(
      'command_missing',
      { ok: true, value: null },
      '2026-08-19T00:00:01.000Z',
    )).rejects.toThrow('终态写入失败')
    expect(transaction.runAsync).toHaveBeenCalledTimes(1)
  })

  test('显式 prune 使用同一保护规则并返回真实删除数', async () => {
    const raw = { runAsync: jest.fn(async (..._arguments: unknown[]) => ({ changes: 3 })) }
    const repository = new SqliteCommandRepository({ raw } as unknown as MobileDatabase)

    await expect(repository.pruneTerminal(LOCAL_COMMAND_RETENTION_LIMIT)).resolves.toBe(3)
    const call = raw.runAsync.mock.calls[0]
    expect(call?.[0]).toContain('SELECT source_command_id FROM timers')
    expect(call?.slice(1)).toEqual([
      '',
      LOCAL_COMMAND_RETENTION_LIMIT,
      LOCAL_COMMAND_RETENTION_LIMIT,
    ])
  })
})
