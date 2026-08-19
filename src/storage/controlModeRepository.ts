import type { MobileDatabase } from './database'
import type { ControlMode } from '@/commands/types'


const CONTROL_MODE_KEY = 'control_mode'
const DEFAULT_CONTROL_MODE: ControlMode = 'ask_every_time'

function isControlMode(value: string): value is ControlMode {
  return value === 'disabled' || value === 'ask_every_time' || value === 'trusted_session'
}

export interface ControlModeRepository {
  get(): Promise<ControlMode>
  set(mode: ControlMode, updatedAt: string): Promise<void>
}

export class SqliteControlModeRepository implements ControlModeRepository {
  constructor(private readonly database: MobileDatabase) {}

  async get(): Promise<ControlMode> {
    const row = await this.database.raw.getFirstAsync<{ value: string }>(
      'SELECT value FROM settings WHERE key = ?',
      CONTROL_MODE_KEY,
    )
    if (row === null) return DEFAULT_CONTROL_MODE
    if (!isControlMode(row.value)) throw new Error('数据库中的 controlMode 无效')
    return row.value
  }

  async set(mode: ControlMode, updatedAt: string): Promise<void> {
    await this.database.raw.runAsync(
      `INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      CONTROL_MODE_KEY,
      mode,
      updatedAt,
    )
  }
}
