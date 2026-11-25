package ai.tokenroll.toolbridge.mobile

import android.content.Context
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import android.database.sqlite.SQLiteOpenHelper
import java.io.File

private fun expoDatabasePath(context: Context): String {
    val directory = File(context.filesDir, "SQLite")
    check(directory.isDirectory || directory.mkdirs() || directory.isDirectory) { "无法打开本地数据库目录" }
    return File(directory, "tool-bridge-mobile.db").absolutePath
}

// 原地打开 Expo 的文件，SQLite 也会在同目录恢复原有 WAL。
internal class NativeDatabase(context: Context) : SQLiteOpenHelper(
    context,
    expoDatabasePath(context),
    null,
    5,
    DatabaseErrorHandler { throw SQLiteException("本地数据库损坏") },
) {
    init {
        setWriteAheadLoggingEnabled(true)
    }

    override fun onConfigure(db: SQLiteDatabase) {
        db.setForeignKeyConstraintsEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) = onUpgrade(db, 0, 5)

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // SQLiteOpenHelper 已将所有 DDL、内容复制和 user_version 写入包在同一事务。
        for (version in oldVersion + 1..newVersion) {
            for (sql in migrations[version - 1].split(';')) {
                if (sql.isNotBlank()) db.execSQL(sql.trim())
            }
        }
    }
}

// 对应 src/storage/migrations/0001..0005。事务与 PRAGMA 由 SQLiteOpenHelper 管理。
private val migrations = listOf(
    """
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
    """,
    """
    CREATE TABLE IF NOT EXISTS timers (
      timer_id TEXT PRIMARY KEY NOT NULL,
      source_command_id TEXT NOT NULL UNIQUE,
      owner_subject_id TEXT NOT NULL,
      notification_id TEXT NOT NULL UNIQUE,
      fires_at TEXT NOT NULL,
      state TEXT NOT NULL CHECK (
        state IN (
          'preparing', 'scheduled', 'cancelling', 'cancelled',
          'deadline_elapsed', 'status_unknown'
        )
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      cancelled_at TEXT
    );

    CREATE INDEX IF NOT EXISTS timers_owner_state_idx
      ON timers(owner_subject_id, state, fires_at);

    CREATE INDEX IF NOT EXISTS timers_fires_at_idx
      ON timers(fires_at, timer_id);
    """,
    """
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
    """,
    """
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
    """,
    """
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
    """,
)
