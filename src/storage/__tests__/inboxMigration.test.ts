import * as SQLite from 'expo-sqlite'

import { MobileDatabase } from '../database'
import { INBOX_SCHEMA_SQL, INBOX_SCHEMA_VERSION } from '../migrations/0003_inbox'
import {
  INBOX_METADATA_SCHEMA_SQL,
  INBOX_METADATA_SCHEMA_VERSION,
} from '../migrations/0004_inbox_metadata'

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }))

describe('inbox schema migration', () => {
  const openDatabase = SQLite.openDatabaseAsync as jest.MockedFunction<typeof SQLite.openDatabaseAsync>

  afterEach(() => { jest.clearAllMocks() })

  test('v3 建立专用内容表、command 幂等键、有界查询索引与固定 category', () => {
    expect(INBOX_SCHEMA_VERSION).toBe(3)
    expect(INBOX_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS inbox_messages')
    expect(INBOX_SCHEMA_SQL).toContain('source_command_id TEXT NOT NULL UNIQUE')
    expect(INBOX_SCHEMA_SQL).toContain("category IN ('message', 'subscription', 'news', 'update')")
    expect(INBOX_SCHEMA_SQL).toContain('inbox_messages_received_at_idx')
    expect(INBOX_SCHEMA_SQL).toContain('inbox_messages_unread_idx')
    expect(INBOX_SCHEMA_SQL).not.toContain('notification_payload')
  })

  test('v4 原子保留旧消息并新增 Markdown、紧急程度、可空发送时间与排序索引', () => {
    expect(INBOX_METADATA_SCHEMA_VERSION).toBe(4)
    expect(INBOX_METADATA_SCHEMA_SQL).toContain('BEGIN EXCLUSIVE TRANSACTION')
    expect(INBOX_METADATA_SCHEMA_SQL).toContain("format TEXT NOT NULL CHECK (format = 'markdown')")
    expect(INBOX_METADATA_SCHEMA_SQL).toContain("urgency IN ('low', 'normal', 'high', 'critical')")
    expect(INBOX_METADATA_SCHEMA_SQL).toContain('sent_at TEXT')
    expect(INBOX_METADATA_SCHEMA_SQL).not.toContain('sent_at TEXT NOT NULL')
    expect(INBOX_METADATA_SCHEMA_SQL).toContain("title, body, 'markdown', 'normal', NULL")
    expect(INBOX_METADATA_SCHEMA_SQL).toContain('inbox_messages_sent_at_idx')
  })

  test('v2 顺序执行 v3/v4，v3 只执行 v4', async () => {
    const database = {
      closeAsync: jest.fn(async () => undefined),
      execAsync: jest.fn(async (_sql: string) => undefined),
      getFirstAsync: jest.fn(async () => ({ user_version: 2 })),
    }
    openDatabase.mockResolvedValueOnce(database as never)

    await MobileDatabase.open()

    expect(database.execAsync).toHaveBeenCalledTimes(2)
    expect(database.execAsync).toHaveBeenCalledWith(INBOX_SCHEMA_SQL)
    expect(database.execAsync).toHaveBeenCalledWith(INBOX_METADATA_SCHEMA_SQL)

    const v3 = {
      closeAsync: jest.fn(async () => undefined),
      execAsync: jest.fn(async (_sql: string) => undefined),
      getFirstAsync: jest.fn(async () => ({ user_version: 3 })),
    }
    openDatabase.mockResolvedValueOnce(v3 as never)
    await MobileDatabase.open()
    expect(v3.execAsync).toHaveBeenCalledTimes(1)
    expect(v3.execAsync).toHaveBeenCalledWith(INBOX_METADATA_SCHEMA_SQL)
  })
})
