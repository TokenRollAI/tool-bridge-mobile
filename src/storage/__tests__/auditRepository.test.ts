import { LOCAL_AUDIT_RETENTION_LIMIT } from '@/audit/types'

import { SqliteAuditRepository } from '../auditRepository'

import type { MobileDatabase } from '../database'
import type { AuditRecord } from '@/audit/types'

const record: AuditRecord = {
  callerSubjectId: 'caller_01',
  clientVersion: '0.1.0',
  commandId: 'command_01',
  decision: 'allowed',
  effect: 'write',
  id: 'audit_01',
  occurredAt: '2026-08-19T00:00:01.000Z',
  outcomeCode: 'succeeded',
  path: 'phone/productivity',
  risk: 'medium',
  tool: 'notify',
}

describe('SqliteAuditRepository', () => {
  test('每次新增都在同一事务裁剪到本地硬上限', async () => {
    const transaction = {
      runAsync: jest.fn(async (..._arguments: unknown[]) => ({ changes: 1 })),
    }
    const raw = {
      withExclusiveTransactionAsync: jest.fn(async (
        callback: (value: typeof transaction) => Promise<void>,
      ) => callback(transaction)),
    }
    const repository = new SqliteAuditRepository({ raw } as unknown as MobileDatabase)

    await repository.add(record)

    expect(raw.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1)
    expect(transaction.runAsync).toHaveBeenCalledTimes(2)
    expect(transaction.runAsync.mock.calls[0]?.[0]).toContain('INSERT INTO audit_records')
    expect(transaction.runAsync.mock.calls[1]?.[0]).toContain('DELETE FROM audit_records')
    expect(transaction.runAsync.mock.calls[1]?.[1]).toBe(LOCAL_AUDIT_RETENTION_LIMIT)
  })

  test('clear 只删除 audit_records 并返回数据库真实删除数', async () => {
    const raw = { runAsync: jest.fn(async () => ({ changes: 7 })) }
    const repository = new SqliteAuditRepository({ raw } as unknown as MobileDatabase)

    await expect(repository.clear()).resolves.toBe(7)
    expect(raw.runAsync).toHaveBeenCalledWith('DELETE FROM audit_records')
  })
})
