export const DEVICE_MAILBOX_JOURNAL_SCHEMA_VERSION = 5

// Mailbox 执行日志只保存 SDK 恢复幂等所需的最小状态；原始调用载荷与凭证不入库。
export const DEVICE_MAILBOX_JOURNAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS device_operation_journal (
  operation_id TEXT PRIMARY KEY NOT NULL CHECK (length(operation_id) > 0),
  state TEXT NOT NULL CHECK (state IN ('discovered', 'executing', 'terminal')),
  completion_json TEXT,
  expires_at TEXT NOT NULL CHECK (length(expires_at) > 0),
  updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
  CHECK (
    (state = 'terminal' AND completion_json IS NOT NULL)
    OR (state IN ('discovered', 'executing') AND completion_json IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS device_operation_journal_expires_at_idx
  ON device_operation_journal(expires_at, operation_id);

PRAGMA user_version = ${DEVICE_MAILBOX_JOURNAL_SCHEMA_VERSION};
`
