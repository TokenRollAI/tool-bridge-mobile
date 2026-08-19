import type { MobileDatabase } from './database'

const BACKGROUND_RUNTIME_KEY = 'background_runtime_enabled'

export interface BackgroundRuntimeRepository {
  get(): Promise<boolean>
  set(enabled: boolean, updatedAt: string): Promise<void>
}

// 后台运行是否开启的持久化开关。默认关闭：后台常驻会显示常驻通知并保持连接，必须由用户主动选择。
export class SqliteBackgroundRuntimeRepository implements BackgroundRuntimeRepository {
  constructor(private readonly database: MobileDatabase) {}

  async get(): Promise<boolean> {
    const row = await this.database.raw.getFirstAsync<{ value: string }>(
      'SELECT value FROM settings WHERE key = ?',
      BACKGROUND_RUNTIME_KEY,
    )
    return row?.value === 'true'
  }

  async set(enabled: boolean, updatedAt: string): Promise<void> {
    await this.database.raw.runAsync(
      `INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      BACKGROUND_RUNTIME_KEY,
      enabled ? 'true' : 'false',
      updatedAt,
    )
  }
}
