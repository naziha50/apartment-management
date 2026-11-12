'use strict';
/**
 * Who is making this request?
 *
 * ⚠ DEVELOPMENT STAND-IN FOR LOGIN — this is NOT authentication.
 * Login (FR-01/FR-02) is out of scope for now. The page sends the id of the
 * user chosen in the "Viewing as" menu in the `X-User-Id` header, and this
 * middleware turns it into `req.user`.
 *
 * Everything else in the app only ever reads `req.user`. When real login is
 * built, only this file changes (read the session instead of the header).
 */
const users = require('../modules/users/users.repository');
const { unauthorized } = require('../lib/errors');

/** Sets req.user to { id, buildingId, role, fullName, email, phone, permissions } or null. */
async function loadCurrentUser(req, res, next) {
  req.user = null;
  const raw = req.get('X-User-Id');
  if (!raw) return next();
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) return next(unauthorized('The selected user is not valid. Please choose again.'));
  try {
    req.user = await users.findActiveById(id);
    if (!req.user) return next(unauthorized('The selected user no longer exists or is inactive. Please choose again.'));
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

module.exports = { loadCurrentUser, requireUser, can };
