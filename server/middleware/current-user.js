'use strict';
/**
 * Who is making this request? Sets req.user (FR-01, FR-02, NFR-03).
 *
 * 1. The login session cookie (see server/modules/auth). A session that has
 *    not been used for config.sessionIdleMinutes has ended.
 * 2. Development and tests only: the X-User-Id header, so automated tests can
 *    act as any demo user without logging in. It is ignored on a live server
 *    (NODE_ENV=production), where only a real login counts.
 *
 * Everything else in the app only ever reads `req.user`.
 */
const config = require('../config');
const users = require('../modules/users/users.repository');
const auth = require('../modules/auth/auth.repository');
const { hashToken } = require('../lib/passwords');
const { SESSION_COOKIE, readCookie } = require('../lib/cookies');
const { unauthorized } = require('../lib/errors');

const devStandInEnabled = config.env !== 'production';

/** Sets req.user to { id, buildingId, role, fullName, email, phone, permissions } or null. */
async function loadCurrentUser(req, res, next) {
  req.user = null;
  try {
    // 1. Logged in?
    const token = readCookie(req, SESSION_COOKIE);
    if (token) {
      const userId = await auth.useSession(hashToken(token), config.sessionIdleMinutes);
      if (userId) {
        req.user = await users.findActiveById(userId);
        return next();
      }
    }

    // 2. Development and tests: X-User-Id header.
    const raw = req.get('X-User-Id');
    if (!raw || !devStandInEnabled) return next();
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id <= 0) return next(unauthorized('The selected user is not valid.'));
    req.user = await users.findActiveById(id);
    if (!req.user) return next(unauthorized('The selected user no longer exists or is inactive.'));
    return next();
  } catch (err) {
    return next(err);
  }
}

/** Use on routes that need to know who is acting. */
function requireUser(req, res, next) {
  return req.user ? next() : next(unauthorized());
}

/** Admins always pass; staff only with the named permission (Appendix B). */
function can(user, permission) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return user.role === 'staff' && user.permissions.includes(permission);
}

module.exports = { loadCurrentUser, requireUser, can, devStandInEnabled };
