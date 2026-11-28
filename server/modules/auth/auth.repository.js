'use strict';
/** Database access for login and sessions (FR-01, NFR-03). SQL only — no business rules here. */
const db = require('../../db/pool');

/** The user with this email (any letter case) or phone, with their password hash, or null. */
async function findByLogin(login) {
  const { rows } = await db.query(
    `SELECT id, password_hash, is_active FROM users
      WHERE lower(email) = lower($1) OR phone = $1
      LIMIT 1`,
    [login],
  );
  return rows[0] || null;
}

/** Starts a session for a user. */
async function createSession(tokenHash, userId) {
  await db.query('INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)', [tokenHash, userId]);
}

/**
 * The user id of a session that is still alive, or null.
 * Alive = used within the last `idleMinutes`, and its user is still active.
 * A live session is marked as used now, so the idle time starts again, unless `touch` is
 * false (an automatic background check, which is not the person doing something).
 */
async function useSession(tokenHash, idleMinutes, touch = true) {
  const { rows } = await db.query(
    `UPDATE sessions s SET last_seen_at = CASE WHEN $3 THEN now() ELSE s.last_seen_at END
       FROM users u
      WHERE s.token_hash = $1
        AND u.id = s.user_id AND u.is_active
        AND s.last_seen_at > now() - make_interval(mins => $2)
      RETURNING s.user_id`,
    [tokenHash, idleMinutes, touch],
  );
  return rows[0] ? Number(rows[0].user_id) : null;
}

/** Ends one session (logout). */
async function deleteSession(tokenHash) {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

/** Removes sessions nobody has used for `idleMinutes`, so the table does not grow forever. */
async function deleteIdleSessions(idleMinutes) {
  await db.query('DELETE FROM sessions WHERE last_seen_at <= now() - make_interval(mins => $1)', [idleMinutes]);
}

/** Sets a user's password hash. Returns false if no user has this email or phone. */
async function setPasswordHash(login, passwordHash) {
  const { rowCount } = await db.query(
    'UPDATE users SET password_hash = $2, updated_at = now() WHERE lower(email) = lower($1) OR phone = $1',
    [login, passwordHash],
  );
  return rowCount > 0;
}

module.exports = { findByLogin, createSession, useSession, deleteSession, deleteIdleSessions, setPasswordHash };
