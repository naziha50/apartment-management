/**
 * Login, logout and sessions (FR-01, FR-02, NFR-01, NFR-03).
 *
 * The real Express app over HTTP, against its own test database
 * (DATABASE_URL + "_auth_test"), which is wiped, migrated and seeded on every
 * run. These tests use only the session cookie, never the X-User-Id header.
 * Without PostgreSQL the tests are skipped.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.join(import.meta.dirname, '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });

const devUrl = process.env.DATABASE_URL || 'postgres://localhost:5432/apartment_maintenance';
const testUrl = new URL(devUrl);
testUrl.pathname += '_auth_test';
process.env.DATABASE_URL = testUrl.toString(); // must be set before the app code is loaded

let skip = false;
try {
  const quiet = () => {};
  await require('../db/create-db').createDatabase(testUrl.toString());
  await require('../db/migrate').migrate({ databaseUrl: testUrl.toString(), reset: true, log: quiet });
  await require('../db/seed').seed({ databaseUrl: testUrl.toString(), log: quiet });
} catch (err) {
  skip = `PostgreSQL test database not available: ${err.message || err.code || err}`;
}

const { hashPassword, verifyPassword } = require('../server/lib/passwords');
const db = skip ? null : require('../server/db/pool');
const { createApp } = require('../server/app');
let server;
let base;
if (!skip) {
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
}
after(async () => {
  if (server) server.close();
  if (db) await db.pool.end();
});

const DEMO_PASSWORD = 'demo1234'; // set for every demo user by db/seed.js

// ---------- helpers ----------

/** Logs in. Returns the status, the JSON body and the cookie to send back ("am_session=..."). */
async function login(loginText, password) {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginText, password }),
  });
  const setCookie = res.headers.getSetCookie()[0] || '';
  return { status: res.status, body: await res.json(), setCookie, cookie: setCookie.split(';')[0] };
}

/** GET with a cookie (or none). Returns the status and the JSON body. */
async function getWith(cookie, url) {
  const res = await fetch(base + url, { headers: cookie ? { Cookie: cookie } : {} });
  return { status: res.status, body: await res.json() };
}

// ---------- NFR-01: passwords ----------

test('passwords are stored as a salted hash, never as the password itself (NFR-01)', { skip }, async () => {
  const first = await hashPassword('secret-pass');
  const second = await hashPassword('secret-pass');

  assert.match(first, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.ok(!first.includes('secret-pass'));
  assert.notEqual(first, second); // a new salt every time
  assert.equal(await verifyPassword('secret-pass', first), true);
  assert.equal(await verifyPassword('Secret-pass', first), false);
  assert.equal(await verifyPassword('secret-pass', 'not a hash'), false);
  assert.equal(await verifyPassword(undefined, first), false);

  const { rows } = await db.query("SELECT password_hash FROM users WHERE email = 'admin@example.com'");
  assert.match(rows[0].password_hash, /^scrypt\$/);
});

// ---------- FR-01: log in ----------

test('the right email and password log in and set a safe session cookie (FR-01)', { skip }, async () => {
  const res = await login('admin@example.com', DEMO_PASSWORD);

  assert.equal(res.status, 200);
  assert.equal(res.body.user.role, 'admin');
  assert.match(res.setCookie, /^am_session=[0-9a-f]{64};/);
  assert.match(res.setCookie, /HttpOnly/);
  assert.match(res.setCookie, /SameSite=Lax/);

  const me = await getWith(res.cookie, '/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'admin@example.com');
});

test('the email can be typed in any letter case, and the phone as 01XXXXXXXXX (FR-01)', { skip }, async () => {
  assert.equal((await login('ADMIN@Example.com', DEMO_PASSWORD)).status, 200);

  const byPhone = await login('01711000011', DEMO_PASSWORD); // stored as +8801711000011
  assert.equal(byPhone.status, 200);
  assert.equal(byPhone.body.user.fullName, 'Rahima Rahman');
});

test('a wrong password and an unknown email get the same message and no cookie (FR-01)', { skip }, async () => {
  const wrongPassword = await login('admin@example.com', 'wrong-password');
  const unknownEmail = await login('nobody@example.com', DEMO_PASSWORD);

  for (const res of [wrongPassword, unknownEmail]) {
    assert.equal(res.status, 401);
    assert.equal(res.setCookie, '');
  }
  assert.equal(wrongPassword.body.error.message, unknownEmail.body.error.message);
});

test('missing email or password is refused with a message for each field', { skip }, async () => {
  const res = await login('', '');

  assert.equal(res.status, 400);
  assert.deepEqual(Object.keys(res.body.error.fields).sort(), ['login', 'password']);
});

test('nobody is logged in without a cookie, or with a made-up one (NFR-03)', { skip }, async () => {
  assert.equal((await getWith(null, '/me')).status, 401);
  assert.equal((await getWith(`am_session=${'0'.repeat(64)}`, '/me')).status, 401);
  assert.equal((await getWith(null, '/bills')).status, 401);
});

test('only a hash of the session token is stored, not the token from the cookie', { skip }, async () => {
  const res = await login('staff@example.com', DEMO_PASSWORD);
  const token = res.cookie.split('=')[1];

  const { rows } = await db.query('SELECT token_hash FROM sessions');
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.token_hash !== token));
});

// ---------- FR-02: the session decides what you see ----------

test('a logged-in resident sees only their own bills; staff cannot open billing (FR-02, NFR-16)', { skip }, async () => {
  const tanvir = await login('resident2@example.com', DEMO_PASSWORD);
  const bills = await getWith(tanvir.cookie, '/bills');
  assert.equal(bills.status, 200);
  assert.ok(bills.body.items.length > 0);
  assert.ok(bills.body.items.every((b) => b.unitNumber === '2A'));

  const staff = await login('caretaker@example.com', DEMO_PASSWORD);
  assert.equal((await getWith(staff.cookie, '/bills')).status, 403);
});

// ---------- logout and the end of a session ----------

test('logging out ends the session and deletes the cookie (FR-01)', { skip }, async () => {
  const res = await login('resident1@example.com', DEMO_PASSWORD);
  assert.equal((await getWith(res.cookie, '/me')).status, 200);

  const out = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { Cookie: res.cookie } });
  assert.equal(out.status, 204);
  assert.match(out.headers.getSetCookie()[0], /^am_session=;.*Max-Age=0/);

  assert.equal((await getWith(res.cookie, '/me')).status, 401); // the old cookie no longer works
});

test('a session unused for longer than the idle time has ended (NFR-03)', { skip }, async () => {
  const res = await login('resident3@example.com', DEMO_PASSWORD);
  assert.equal((await getWith(res.cookie, '/me')).status, 200);

  // Pretend the last request was 31 minutes ago (the limit is 30).
  await db.query(
    `UPDATE sessions SET last_seen_at = now() - interval '31 minutes'
      WHERE user_id = (SELECT id FROM users WHERE email = 'resident3@example.com')`,
  );
  assert.equal((await getWith(res.cookie, '/me')).status, 401);
});

test('a deactivated user cannot log in, and their open session stops working', { skip }, async () => {
  const res = await login('resident2@example.com', DEMO_PASSWORD);
  assert.equal((await getWith(res.cookie, '/me')).status, 200);

  await db.query("UPDATE users SET is_active = false WHERE email = 'resident2@example.com'");
  try {
    assert.equal((await getWith(res.cookie, '/me')).status, 401);
    assert.equal((await login('resident2@example.com', DEMO_PASSWORD)).status, 401);
  } finally {
    await db.query("UPDATE users SET is_active = true WHERE email = 'resident2@example.com'");
  }
});

// ---------- npm run user:password ----------

test('npm run user:password sets a new password; a short one is refused', { skip }, async () => {
  const run = (...args) => spawnSync(process.execPath, [path.join(root, 'db', 'set-password.js'), ...args], {
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    encoding: 'utf8',
  });

  const short = run('caretaker@example.com', 'short');
  assert.equal(short.status, 1);

  const ok = run('caretaker@example.com', 'new-password-1');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal((await login('caretaker@example.com', DEMO_PASSWORD)).status, 401);
  assert.equal((await login('caretaker@example.com', 'new-password-1')).status, 200);

  const unknown = run('nobody@example.com', 'new-password-1');
  assert.equal(unknown.status, 1);
});
