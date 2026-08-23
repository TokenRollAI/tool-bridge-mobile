export const INBOX_SCHEMA_VERSION = 3

export const INBOX_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS inbox_messages (
  message_id TEXT PRIMARY KEY NOT NULL,
  source_command_id TEXT NOT NULL UNIQUE,
  caller_subject_id TEXT NOT NULL,
  caller_display_name TEXT,
  category TEXT NOT NULL CHECK (
    category IN ('message', 'subscription', 'news', 'update')
  ),
  source_label TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  received_at TEXT NOT NULL,
  read_at TEXT
);

CREATE INDEX IF NOT EXISTS inbox_messages_received_at_idx
  ON inbox_messages(received_at DESC, message_id DESC);

CREATE INDEX IF NOT EXISTS inbox_messages_unread_idx
  ON inbox_messages(read_at, received_at DESC);

PRAGMA user_version = ${INBOX_SCHEMA_VERSION};
`
