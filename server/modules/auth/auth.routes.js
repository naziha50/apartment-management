'use strict';
/**
 * Login and logout (FR-01, NFR-01, NFR-03).
 *
 * POST /api/v1/auth/login    { login: email or phone, password } → sets the session cookie, returns the user
 * POST /api/v1/auth/logout   ends the session and deletes the cookie
 */
const express = require('express');
const config = require('../../config');
const auth = require('./auth.repository');
const users = require('../users/users.repository');
const { hashPassword, verifyPassword, hashToken, newToken } = require('../../lib/passwords');
const { SESSION_COOKIE, readCookie, sessionCookie, clearSessionCookie } = require('../../lib/cookies');
const { HttpError, badRequest } = require('../../lib/errors');

const router = express.Router();

// The same message for every failure, so it never reveals whether an account exists.
const LOGIN_FAILED = 'The email, phone number or password is not right.';

// Checked when the email or phone is unknown, so a wrong email takes as long as a wrong password.
let dummyHash = null;

/** Phone numbers are stored as +8801XXXXXXXXX; people usually type 01XXXXXXXXX. */
function normaliseLogin(text) {
  if (typeof text !== 'string') return '';
  const login = text.trim();
  if (/^01\d{9}$/.test(login)) return `+88${login}`;
  if (/^8801\d{9}$/.test(login)) return `+${login}`;
  return login;
}

router.post('/auth/login', async (req, res) => {
  const login = normaliseLogin(req.body.login);
  const password = req.body.password;

  const errors = {};
  if (!login) errors.login = 'Enter your email or phone number.';
  if (typeof password !== 'string' || password === '') errors.password = 'Enter your password.';
  if (Object.keys(errors).length) throw badRequest('Please fix the highlighted fields.', errors);

  const found = await auth.findByLogin(login);
  if (!dummyHash) dummyHash = await hashPassword('not a real password');
  const passwordOk = await verifyPassword(password, found?.password_hash || dummyHash);
  // A deactivated user, or one without a password yet, cannot log in (FR-06).
  if (!found || !found.password_hash || !found.is_active || !passwordOk) {
    throw new HttpError(401, 'LOGIN_FAILED', LOGIN_FAILED);
  }

  await auth.deleteIdleSessions(config.sessionIdleMinutes);
  const token = newToken();
  await auth.createSession(hashToken(token), found.id);
  res.set('Set-Cookie', sessionCookie(token));
  res.json({ user: await users.findActiveById(Number(found.id)) });
});

router.post('/auth/logout', async (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await auth.deleteSession(hashToken(token));
  res.set('Set-Cookie', clearSessionCookie());
  res.status(204).end();
});

module.exports = router;
