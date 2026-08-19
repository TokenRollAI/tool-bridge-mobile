import { INITIAL_SCHEMA_SQL, INITIAL_SCHEMA_VERSION } from '../migrations/0001_initial'

describe('initial SQLite migration', () => {
  test('启用 WAL 并持久化幂等终态与脱敏审计', () => {
    expect(INITIAL_SCHEMA_VERSION).toBe(1)
    expect(INITIAL_SCHEMA_SQL).toContain('PRAGMA journal_mode = WAL')
    expect(INITIAL_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS commands')
    expect(INITIAL_SCHEMA_SQL).toContain('unknown_after_crash')
    expect(INITIAL_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS audit_records')
    expect(INITIAL_SCHEMA_SQL).not.toContain('arguments_json')
  })
})
