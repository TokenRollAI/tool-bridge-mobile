export const INBOX_METADATA_SCHEMA_VERSION = 4

// 在单一 exclusive transaction 中重建内容表；旧消息没有可信的 Agent 发送时间，保留为 NULL，
// 不能拿本机 received_at 冒充远端事实。格式与紧急度取兼容默认值。
export const INBOX_METADATA_SCHEMA_SQL = `
BEGIN EXCLUSIVE TRANSACTION;

CREATE TABLE inbox_messages_v4 (
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
  format TEXT NOT NULL CHECK (format = 'markdown'),
  urgency TEXT NOT NULL CHECK (urgency IN ('low', 'normal', 'high', 'critical')),
  sent_at TEXT,
  received_at TEXT NOT NULL,
  read_at TEXT
);

INSERT INTO inbox_messages_v4(
  message_id, source_command_id, caller_subject_id, caller_display_name,
  category, source_label, title, body, format, urgency, sent_at, received_at, read_at
)
SELECT
  message_id, source_command_id, caller_subject_id, caller_display_name,
  category, source_label, title, body, 'markdown', 'normal', NULL, received_at, read_at
FROM inbox_messages;

DROP TABLE inbox_messages;
ALTER TABLE inbox_messages_v4 RENAME TO inbox_messages;

CREATE INDEX inbox_messages_received_at_idx
  ON inbox_messages(received_at DESC, message_id DESC);
CREATE INDEX inbox_messages_sent_at_idx
  ON inbox_messages(sent_at DESC, message_id DESC);
CREATE INDEX inbox_messages_unread_idx
  ON inbox_messages(read_at, received_at DESC);

PRAGMA user_version = ${INBOX_METADATA_SCHEMA_VERSION};
COMMIT;
`
