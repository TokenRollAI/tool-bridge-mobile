import * as SQLite from 'expo-sqlite'

import { MobileDatabase } from '../database'
import {
  DEVICE_MAILBOX_JOURNAL_SCHEMA_SQL,
  DEVICE_MAILBOX_JOURNAL_SCHEMA_VERSION,
} from '../migrations/0005_device_mailbox_journal'

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }))

describe('device mailbox journal schema migration', () => {
  const openDatabase = SQLite.openDatabaseAsync as jest.MockedFunction<typeof SQLite.openDatabaseAsync>

  afterEach(() => { jest.clearAllMocks() })

  test('v5 只持久化恢复幂等所需状态并约束 terminal completion', () => {
    expect(DEVICE_MAILBOX_JOURNAL_SCHEMA_VERSION).toBe(5)
    expect(DEVICE_MAILBOX_JOURNAL_SCHEMA_SQL)
      .toContain('CREATE TABLE IF NOT EXISTS device_operation_journal')
    expect(DEVICE_MAILBOX_JOURNAL_SCHEMA_SQL)
      .toContain("state IN ('discovered', 'executing', 'terminal')")
    expect(DEVICE_MAILBOX_JOURNAL_SCHEMA_SQL)
      .toContain("state = 'terminal' AND completion_json IS NOT NULL")
    expect(DEVICE_MAILBOX_JOURNAL_SCHEMA_SQL)
      .toContain("state IN ('discovered', 'executing') AND completion_json IS NULL")
    expect(DEVICE_MAILBOX_JOURNAL_SCHEMA_SQL)
      .toContain('device_operation_journal_expires_at_idx')
    expect(DEVICE_MAILBOX_JOURNAL_SCHEMA_SQL).not.toMatch(/arguments|body|credential|secret/i)
  })

  test('v4 只执行 v5', async () => {
    const database = {
      closeAsync: jest.fn(async () => undefined),
      execAsync: jest.fn(async (_sql: string) => undefined),
      getFirstAsync: jest.fn(async () => ({ user_version: 4 })),
    }
    openDatabase.mockResolvedValueOnce(database as never)

    await MobileDatabase.open()

    expect(database.execAsync).toHaveBeenCalledTimes(1)
    expect(database.execAsync).toHaveBeenCalledWith(DEVICE_MAILBOX_JOURNAL_SCHEMA_SQL)
  })
})
