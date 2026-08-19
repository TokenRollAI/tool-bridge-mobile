export const INITIAL_SCHEMA_VERSION = 1

export const INITIAL_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commands (
  command_id TEXT PRIMARY KEY NOT NULL,
  path TEXT NOT NULL,
  tool TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'running', 'succeeded', 'failed', 'rejected', 'expired', 'cancelled',
      'unknown_after_crash'
    )
  ),
  outcome_json TEXT,
  received_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS commands_received_at_idx
  ON commands(received_at DESC);

CREATE TABLE IF NOT EXISTS audit_records (
  id TEXT PRIMARY KEY NOT NULL,
  command_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  caller_subject_id TEXT NOT NULL,
  path TEXT NOT NULL,
  tool TEXT NOT NULL,
  effect TEXT NOT NULL,
  risk TEXT NOT NULL,
  decision TEXT NOT NULL,
  outcome_code TEXT NOT NULL,
  client_version TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_records_occurred_at_idx
  ON audit_records(occurred_at DESC);

PRAGMA user_version = ${INITIAL_SCHEMA_VERSION};
`
