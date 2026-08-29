import { SqliteDeviceOperationJournal } from '../deviceMailboxJournalRepository'

import type { MobileDatabase } from '../database'
import type { DeviceOperationJournalEntry } from '@tool-bridge/sdk/device'

const EXPIRES_AT = '2026-08-29T03:00:00.000Z'
const UPDATED_AT = '2026-08-29T02:00:00.000Z'

function journal(raw: object): SqliteDeviceOperationJournal {
  return new SqliteDeviceOperationJournal({ raw } as unknown as MobileDatabase)
}

describe('SqliteDeviceOperationJournal', () => {
  test('put 等待 SQLite upsert 完成并且只写入最小恢复状态', async () => {
    const raw = { runAsync: jest.fn(async (..._arguments: unknown[]) => ({ changes: 1 })) }
    const repository = journal(raw)
    const entry: DeviceOperationJournalEntry = {
      completion: {
        outcome: 'succeeded',
        result: { messageId: 'message_1', stored: true },
      },
      expiresAt: EXPIRES_AT,
      operationId: 'operation_1',
      state: 'terminal',
      updatedAt: UPDATED_AT,
    }

    await repository.put(entry)

    expect(raw.runAsync).toHaveBeenCalledTimes(1)
    const call = raw.runAsync.mock.calls[0]
    expect(call?.[0]).toContain('INSERT INTO device_operation_journal')
    expect(call?.[0]).toContain('ON CONFLICT(operation_id) DO UPDATE')
    expect(call?.slice(1)).toEqual([
      'operation_1',
      'terminal',
      JSON.stringify(entry.completion),
      EXPIRES_AT,
      UPDATED_AT,
    ])
  })

  test('get 严格解析 terminal completion', async () => {
    const raw = {
      getFirstAsync: jest.fn(async (..._arguments: unknown[]) => ({
        completion_json: JSON.stringify({
          error: { code: 'unavailable', message: 'execution interrupted', retryable: false },
          outcome: 'result_unknown',
        }),
        expires_at: EXPIRES_AT,
        operation_id: 'operation_2',
        state: 'terminal',
        updated_at: UPDATED_AT,
      })),
    }

    await expect(journal(raw).get('operation_2')).resolves.toEqual({
      completion: {
        error: { code: 'unavailable', message: 'execution interrupted', retryable: false },
        outcome: 'result_unknown',
      },
      expiresAt: EXPIRES_AT,
      operationId: 'operation_2',
      state: 'terminal',
      updatedAt: UPDATED_AT,
    })
    expect(raw.getFirstAsync.mock.calls[0]?.slice(1)).toEqual(['operation_2'])
  })

  test('get 恢复非终态时不伪造 completion，缺失记录返回 null', async () => {
    const getFirstAsync = jest.fn()
      .mockResolvedValueOnce({
        completion_json: null,
        expires_at: EXPIRES_AT,
        operation_id: 'operation_3',
        state: 'executing',
        updated_at: UPDATED_AT,
      })
      .mockResolvedValueOnce(null)
    const repository = journal({ getFirstAsync })

    await expect(repository.get('operation_3')).resolves.toEqual({
      expiresAt: EXPIRES_AT,
      operationId: 'operation_3',
      state: 'executing',
      updatedAt: UPDATED_AT,
    })
    await expect(repository.get('missing')).resolves.toBeNull()
  })

  test.each([
    ['非终态却有 completion', {
      completion_json: '{"outcome":"result_unknown"}',
      expires_at: EXPIRES_AT,
      operation_id: 'operation_bad',
      state: 'executing',
      updated_at: UPDATED_AT,
    }],
    ['终态 completion JSON 损坏', {
      completion_json: '{',
      expires_at: EXPIRES_AT,
      operation_id: 'operation_bad',
      state: 'terminal',
      updated_at: UPDATED_AT,
    }],
    ['completion 存在多余字段', {
      completion_json: '{"outcome":"succeeded","result":null,"extra":true}',
      expires_at: EXPIRES_AT,
      operation_id: 'operation_bad',
      state: 'terminal',
      updated_at: UPDATED_AT,
    }],
    ['error code 越出公开契约', {
      completion_json: '{"outcome":"failed","error":{"code":"cancelled","message":"bad","retryable":false}}',
      expires_at: EXPIRES_AT,
      operation_id: 'operation_bad',
      state: 'terminal',
      updated_at: UPDATED_AT,
    }],
    ['operation identity 不匹配', {
      completion_json: null,
      expires_at: EXPIRES_AT,
      operation_id: 'operation_other',
      state: 'discovered',
      updated_at: UPDATED_AT,
    }],
    ['失效时间戳', {
      completion_json: null,
      expires_at: 'not-a-timestamp',
      operation_id: 'operation_bad',
      state: 'discovered',
      updated_at: UPDATED_AT,
    }],
  ])('数据库状态无效时 fail closed：%s', async (_name, row) => {
    const repository = journal({
      getFirstAsync: jest.fn(async (..._arguments: unknown[]) => row),
    })

    await expect(repository.get('operation_bad')).rejects.toThrow(
      '数据库中的 device mailbox journal 状态无效',
    )
  })

  test('put 拒绝 state/completion 不一致与非 JSON 安全终态', async () => {
    const raw = { runAsync: jest.fn(async (..._arguments: unknown[]) => ({ changes: 1 })) }
    const repository = journal(raw)
    const missingCompletion = {
      expiresAt: EXPIRES_AT,
      operationId: 'operation_4',
      state: 'terminal',
      updatedAt: UPDATED_AT,
    } as DeviceOperationJournalEntry
    const missingResult = {
      completion: { outcome: 'succeeded', result: undefined },
      expiresAt: EXPIRES_AT,
      operationId: 'operation_5',
      state: 'terminal',
      updatedAt: UPDATED_AT,
    } as DeviceOperationJournalEntry

    await expect(repository.put(missingCompletion)).rejects.toThrow('journal 状态无效')
    await expect(repository.put(missingResult)).rejects.toThrow('journal 状态无效')
    expect(raw.runAsync).not.toHaveBeenCalled()
  })

  test('remove 幂等删除，GC 按 expiresAt 比较并返回真实删除数', async () => {
    const raw = {
      runAsync: jest.fn()
        .mockResolvedValueOnce({ changes: 0 })
        .mockResolvedValueOnce({ changes: 3 }),
    }
    const repository = journal(raw)

    await expect(repository.remove('operation_missing')).resolves.toBeUndefined()
    await expect(repository.garbageCollectExpired(UPDATED_AT)).resolves.toBe(3)

    expect(raw.runAsync.mock.calls[0]?.slice(1)).toEqual(['operation_missing'])
    expect(raw.runAsync.mock.calls[1]?.[0]).toContain('julianday(expires_at) <= julianday(?)')
    expect(raw.runAsync.mock.calls[1]?.slice(1)).toEqual([UPDATED_AT])
  })
})
