import { LOCAL_INBOX_RETENTION_LIMIT } from '@/inbox/types'

import { MemoryInboxRepository, SqliteInboxRepository } from '../inboxRepository'

import type { MobileDatabase } from '../database'

const row = {
  body: '三条更新',
  caller_display_name: 'Daily Agent',
  caller_subject_id: 'caller_daily',
  category: 'subscription' as const,
  format: 'markdown' as const,
  message_id: `inbox_${'a'.repeat(64)}`,
  read_at: null,
  received_at: '2026-08-23T10:00:00.000Z',
  sent_at: '2026-08-23T09:55:00.000Z',
  source_command_id: 'inbox_command_01',
  source_label: 'Daily Brief',
  title: '今日订阅摘要',
  urgency: 'high' as const,
}

describe('SqliteInboxRepository', () => {
  test('消息写入、source command 查询与硬上限裁剪在同一事务', async () => {
    const transaction = {
      getFirstAsync: jest.fn(async (..._arguments: unknown[]) => row),
      runAsync: jest.fn(async (..._arguments: unknown[]) => ({ changes: 1 })),
    }
    const raw = {
      withExclusiveTransactionAsync: jest.fn(async (
        callback: (value: typeof transaction) => Promise<void>,
      ) => callback(transaction)),
    }
    const repository = new SqliteInboxRepository({ raw } as unknown as MobileDatabase)

    await expect(repository.add({
      body: row.body,
      callerDisplayName: row.caller_display_name,
      callerSubjectId: row.caller_subject_id,
      category: row.category,
      format: row.format,
      messageId: row.message_id,
      receivedAt: row.received_at,
      sentAt: row.sent_at,
      sourceCommandId: row.source_command_id,
      sourceLabel: row.source_label,
      title: row.title,
      urgency: row.urgency,
    })).resolves.toMatchObject({ messageId: row.message_id, readAt: null })

    expect(raw.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1)
    expect(transaction.runAsync.mock.calls[0]?.[0]).toContain('INSERT OR IGNORE INTO inbox_messages')
    expect(transaction.getFirstAsync.mock.calls[0]?.[0]).toContain('source_command_id = ?')
    expect(transaction.runAsync.mock.calls[1]?.[0]).toContain('DELETE FROM inbox_messages')
    expect(transaction.runAsync.mock.calls[1]?.slice(1)).toEqual([
      row.message_id,
      LOCAL_INBOX_RETENTION_LIMIT,
      LOCAL_INBOX_RETENTION_LIMIT,
    ])
  })

  test('mark read 只更新未读项；clear 只删除信箱表', async () => {
    const raw = { runAsync: jest.fn(async (..._arguments: unknown[]) => ({ changes: 1 })) }
    const repository = new SqliteInboxRepository({ raw } as unknown as MobileDatabase)

    await expect(repository.markRead(row.message_id, '2026-08-23T10:01:00.000Z')).resolves.toBe(true)
    expect(raw.runAsync.mock.calls[0]?.[0]).toContain('read_at IS NULL')
    await expect(repository.clear()).resolves.toBe(1)
    expect(raw.runAsync).toHaveBeenLastCalledWith('DELETE FROM inbox_messages')
  })

  test('搜索使用参数化 LIKE 并转义通配符，排序 SQL 只来自本地枚举', async () => {
    const raw = {
      getAllAsync: jest.fn(async (..._arguments: unknown[]) => [row]),
    }
    const repository = new SqliteInboxRepository({ raw } as unknown as MobileDatabase)

    await expect(repository.list({ searchQuery: 'Daily%_!', sort: 'unread_first' }, 100))
      .resolves.toHaveLength(1)
    expect(raw.getAllAsync.mock.calls[0]?.[0]).toContain("LIKE ? ESCAPE '!'")
    expect(raw.getAllAsync.mock.calls[0]?.[0]).toContain('CASE WHEN read_at IS NULL THEN 0')
    expect(raw.getAllAsync.mock.calls[0]?.slice(1, 6)).toEqual(Array(5).fill('%Daily!%!_!!%'))
  })

  test('全部已读只更新未读项并返回 SQLite 实际 changes', async () => {
    const raw = { runAsync: jest.fn(async (..._arguments: unknown[]) => ({ changes: 7 })) }
    const repository = new SqliteInboxRepository({ raw } as unknown as MobileDatabase)
    await expect(repository.markAllRead('2026-08-23T10:05:00.000Z')).resolves.toBe(7)
    expect(raw.runAsync).toHaveBeenCalledWith(
      'UPDATE inbox_messages SET read_at = ? WHERE read_at IS NULL',
      '2026-08-23T10:05:00.000Z',
    )
  })

  test('内存契约同样按 source command 幂等并保留刚写入项的 1,000 条硬上限', async () => {
    const repository = new MemoryInboxRepository()
    for (let index = 0; index <= LOCAL_INBOX_RETENTION_LIMIT; index += 1) {
      const suffix = index.toString().padStart(4, '0')
      await repository.add({
        body: `body ${suffix}`,
        callerDisplayName: null,
        callerSubjectId: 'caller',
        category: 'message',
        format: 'markdown',
        messageId: `inbox_${suffix}`,
        receivedAt: '2026-08-23T10:00:00.000Z',
        sentAt: null,
        sourceCommandId: `command_${suffix}`,
        sourceLabel: null,
        title: `title ${suffix}`,
        urgency: 'normal',
      })
    }
    expect(repository.records.size).toBe(LOCAL_INBOX_RETENTION_LIMIT)
    expect(repository.records.has('inbox_1000')).toBe(true)
    const before = repository.records.size
    await repository.add({
      body: 'ignored duplicate body',
      callerDisplayName: null,
      callerSubjectId: 'caller',
      category: 'message',
      format: 'markdown',
      messageId: 'inbox_1000',
      receivedAt: '2026-08-23T10:00:01.000Z',
      sentAt: null,
      sourceCommandId: 'command_1000',
      sourceLabel: null,
      title: 'ignored duplicate title',
      urgency: 'normal',
    })
    expect(repository.records.size).toBe(before)
    expect(repository.records.get('inbox_1000')?.title).toBe('title 1000')
  })

  test('内存契约搜索全部字段、按发送时间 fallback，并幂等全部已读', async () => {
    const repository = new MemoryInboxRepository()
    await repository.add({
      body: '包含 Alpha 关键词',
      callerDisplayName: 'Agent One',
      callerSubjectId: 'caller_one',
      category: 'news',
      format: 'markdown',
      messageId: 'inbox_first',
      receivedAt: '2026-08-23T10:00:00.000Z',
      sentAt: null,
      sourceCommandId: 'command_first',
      sourceLabel: null,
      title: '第一条',
      urgency: 'normal',
    })
    await repository.add({
      body: '第二条正文',
      callerDisplayName: null,
      callerSubjectId: 'caller_two',
      category: 'message',
      format: 'markdown',
      messageId: 'inbox_second',
      receivedAt: '2026-08-23T10:01:00.000Z',
      sentAt: '2026-08-23T09:00:00.000Z',
      sourceCommandId: 'command_second',
      sourceLabel: 'Alpha Brief',
      title: '第二条',
      urgency: 'critical',
    })

    await expect(repository.list({ searchQuery: 'alpha', sort: 'sent_desc' }, 100))
      .resolves.toEqual([
        expect.objectContaining({ messageId: 'inbox_first' }),
        expect.objectContaining({ messageId: 'inbox_second' }),
      ])
    await expect(repository.markAllRead('2026-08-23T10:02:00.000Z')).resolves.toBe(2)
    await expect(repository.markAllRead('2026-08-23T10:03:00.000Z')).resolves.toBe(0)
    await expect(repository.list({ searchQuery: '', sort: 'read_first' }, 100))
      .resolves.toHaveLength(2)
  })
})
