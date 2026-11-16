-- Fifteen schema. Statements are idempotent so the file can be applied by hand as well.

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  pw_hash        TEXT NOT NULL,
  pw_salt        TEXT NOT NULL,
  recovery_hash  TEXT NOT NULL,
  settings       TEXT NOT NULL,
  track_until    INTEGER,
  next_pulse_at  INTEGER,
  next_report_at INTEGER,
  notice         TEXT,
  failed_logins  INTEGER NOT NULL DEFAULT 0,
  locked_until   INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS users_pulse ON users (next_pulse_at) WHERE next_pulse_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_report ON users (next_report_at) WHERE next_report_at IS NOT NULL;

-- id is the SHA-256 of the session token; the token itself only lives in the cookie.
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS categories (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  color    TEXT NOT NULL,
  kind     TEXT NOT NULL,
  pos      INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS categories_user ON categories (user_id);

-- day is the user's local calendar date, start/dur are minutes.
CREATE TABLE IF NOT EXISTS entries (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day     TEXT NOT NULL,
  start   INTEGER NOT NULL,
  dur     INTEGER NOT NULL,
  cat     INTEGER NOT NULL,
  tag     TEXT,
  at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, day, start)
) WITHOUT ROWID;

-- Manually started tracking sessions. Scheduled workdays are derived from settings.
CREATE TABLE IF NOT EXISTS windows (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day     TEXT NOT NULL,
  start   INTEGER NOT NULL,
  "end"   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS windows_user_day ON windows (user_id, day);

CREATE TABLE IF NOT EXISTS push_subs (
  endpoint   TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  origin     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs (user_id);
