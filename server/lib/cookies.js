'use strict';
/**
 * The login session cookie (FR-01, NFR-03).
 *
 *   HttpOnly  page scripts cannot read it, so injected script cannot steal it
 *   SameSite  other websites cannot make the browser send it with their forms
 *   Secure    on the live server it is only sent over HTTPS
 *   no Max-Age: the browser forgets it when it closes; the server also ends
 *   the session after config.sessionIdleMinutes without a request.
 */
const config = require('../config');

const SESSION_COOKIE = 'am_session';

/** The value of one cookie from the request, or null. */
function readCookie(req, name) {
  const header = req.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

/** Set-Cookie text that stores the session token in the browser. */
function sessionCookie(token) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (config.env === 'production') parts.push('Secure');
  return parts.join('; ');
}

/** Set-Cookie text that deletes the session cookie. */
function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

module.exports = { SESSION_COOKIE, readCookie, sessionCookie, clearSessionCookie };
