export const TIMER_SCHEMA_VERSION = 2

export const TIMER_SCHEMA_SQL = `
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

PRAGMA user_version = ${TIMER_SCHEMA_VERSION};
`
