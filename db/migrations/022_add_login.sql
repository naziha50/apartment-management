-- 022_add_login.sql
-- Login (FR-01, NFR-01, NFR-03).
--
-- Passwords are never stored, only a salted scrypt hash (server/lib/passwords.js).
-- A user with no password_hash cannot log in until one is set (npm run user:password).
--
-- One row in sessions per logged-in browser. The cookie holds a random token;
-- only its SHA-256 hash is stored here, so a copy of this table cannot be used
-- to log in. A session ends at logout, or after a period with no requests
-- (config.sessionIdleMinutes), checked against last_seen_at.

ALTER TABLE users ADD COLUMN password_hash TEXT;

CREATE TABLE sessions (
  token_hash    TEXT PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_idx ON sessions (user_id);
