import * as SQLite from 'expo-sqlite'

import { MobileDatabase } from '../database'
import { TIMER_SCHEMA_SQL, TIMER_SCHEMA_VERSION } from '../migrations/0002_timers'

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }))

function database(version: number) {
  return {
    closeAsync: jest.fn(async () => undefined),
    execAsync: jest.fn(async (_sql: string) => undefined),
    getFirstAsync: jest.fn(async () => ({ user_version: version })),
  }
}

describe('timer schema migration', () => {
  const openDatabase = SQLite.openDatabaseAsync as jest.MockedFunction<typeof SQLite.openDatabaseAsync>

  afterEach(() => { jest.clearAllMocks() })

  test('v2 表不持久化 purpose，且约束状态、唯一键和查询索引', () => {
    expect(TIMER_SCHEMA_VERSION).toBe(2)
    expect(TIMER_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS timers')
    expect(TIMER_SCHEMA_SQL).toContain('source_command_id TEXT NOT NULL UNIQUE')
    expect(TIMER_SCHEMA_SQL).toContain('notification_id TEXT NOT NULL UNIQUE')
    expect(TIMER_SCHEMA_SQL).toContain('timers_owner_state_idx')
    expect(TIMER_SCHEMA_SQL).toContain('status_unknown')
    expect(TIMER_SCHEMA_SQL).not.toContain('purpose')
  })

  test('fresh v0 顺序执行 v1/v2，v1 升级只执行 v2', async () => {
    const fresh = database(0)
    openDatabase.mockResolvedValueOnce(fresh as never)
    await MobileDatabase.open()
    expect(fresh.execAsync).toHaveBeenCalledTimes(2)
    expect(fresh.execAsync.mock.calls[1]?.[0]).toBe(TIMER_SCHEMA_SQL)

    const v1 = database(1)
    openDatabase.mockResolvedValueOnce(v1 as never)
    await MobileDatabase.open()
    expect(v1.execAsync).toHaveBeenCalledTimes(1)
    expect(v1.execAsync).toHaveBeenCalledWith(TIMER_SCHEMA_SQL)
  })

  test('未来版本先关闭数据库再拒绝打开', async () => {
    const future = database(3)
    openDatabase.mockResolvedValueOnce(future as never)
    await expect(MobileDatabase.open()).rejects.toThrow('高于客户端支持的 2')
    expect(future.closeAsync).toHaveBeenCalledTimes(1)
    expect(future.execAsync).not.toHaveBeenCalled()
  })
})
