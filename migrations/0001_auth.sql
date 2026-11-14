-- Module 1: authentication.
-- Conventions for every table in this project:
--   * Timestamps are INTEGER milliseconds since the Unix epoch, UTC.
--   * Tables are STRICT so SQLite rejects values of the wrong type.
--   * Rows that matter for accounts or audit are never hard-deleted.

CREATE TABLE users (
  id                  INTEGER PRIMARY KEY,
  username            TEXT    NOT NULL UNIQUE COLLATE NOCASE
                              CHECK (length(username) BETWEEN 3 AND 32),
  display_name        TEXT    NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  -- Format: pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url>
  password_hash       TEXT    NOT NULL,
  -- 'staff' is reserved so staff accounts can be added later without a table rebuild.
  role                TEXT    NOT NULL CHECK (role IN ('owner', 'staff')),
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  password_changed_at INTEGER NOT NULL,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
) STRICT;

-- The primary key is the SHA-256 of the session token. The raw token exists
-- only in the user's HttpOnly cookie, so a database leak cannot hijack sessions.
CREATE TABLE sessions (
  id           TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  ip           TEXT,
  user_agent   TEXT
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_sessions_user_id    ON sessions (user_id);
CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);

-- Failed sign-ins per client IP, used for throttling brute-force attempts.
CREATE TABLE login_failures (
  id           INTEGER PRIMARY KEY,
  ip           TEXT    NOT NULL,
  attempted_at INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_login_failures_ip_time ON login_failures (ip, attempted_at);
CREATE INDEX idx_login_failures_time    ON login_failures (attempted_at);

-- Append-only record of security-relevant events. Later modules add billing
-- events (bill created, cancelled, edited) to the same table.
CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL,
  user_id    INTEGER REFERENCES users (id),
  action     TEXT    NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  details    TEXT CHECK (details IS NULL OR json_valid(details))
) STRICT;

CREATE INDEX idx_audit_log_created_at   ON audit_log (created_at);
CREATE INDEX idx_audit_log_user_created ON audit_log (user_id, created_at);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
