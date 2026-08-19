import * as SQLite from 'expo-sqlite'

import { INITIAL_SCHEMA_SQL, INITIAL_SCHEMA_VERSION } from './migrations/0001_initial'
import { TIMER_SCHEMA_SQL, TIMER_SCHEMA_VERSION } from './migrations/0002_timers'

const DATABASE_NAME = 'tool-bridge-mobile.db'
const LATEST_SCHEMA_VERSION = TIMER_SCHEMA_VERSION

const MIGRATIONS = [{
  sql: INITIAL_SCHEMA_SQL,
  version: INITIAL_SCHEMA_VERSION,
}, {
  sql: TIMER_SCHEMA_SQL,
  version: TIMER_SCHEMA_VERSION,
}] as const

export class MobileDatabase {
  static async open(): Promise<MobileDatabase> {
    const database = await SQLite.openDatabaseAsync(DATABASE_NAME)
    const currentVersion = await database.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    )
    const version = currentVersion?.user_version ?? 0
    if (version > LATEST_SCHEMA_VERSION) {
      await database.closeAsync()
      throw new Error(`数据库版本 ${version} 高于客户端支持的 ${LATEST_SCHEMA_VERSION}`)
    }
    for (const migration of MIGRATIONS) {
      if (version < migration.version) await database.execAsync(migration.sql)
    }
    return new MobileDatabase(database)
  }

  private constructor(readonly raw: SQLite.SQLiteDatabase) {}

  close(): Promise<void> {
    return this.raw.closeAsync()
  }
}
