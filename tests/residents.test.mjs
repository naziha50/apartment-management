/**
 * Resident API tests over HTTP against a real PostgreSQL database. They use
 * their own database ("..._residents_test") because test files run at the same
 * time. It is wiped on every run. Skipped when PostgreSQL is not reachable.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
require('dotenv').config({ path: path.join(import.meta.dirname, '..', '.env'), quiet: true });

const url = new URL(process.env.DATABASE_URL || 'postgres://localhost:5432/apartment_maintenance');
url.pathname += '_residents_test';
process.env.DATABASE_URL = url.toString();

let skip = false;
try {
  const { createDatabase } = require('../db/create-db');
  const { migrate } = require('../db/migrate');
  const { seed } = require('../db/seed');
  await createDatabase(url.toString());
  await migrate({ databaseUrl: url.toString(), reset: true, log: () => {} });
  await seed({ databaseUrl: url.toString(), log: () => {} });
} catch (err) {
  skip = `PostgreSQL test database not available: ${err.message || err.code || err}`;
}

let server;
let base;
let pool;
const ids = {};
if (!skip) {
  const { createApp } = require('../server/app');
  ({ pool } = require('../server/db/pool'));
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}/api/v1`;
  for (const row of (await pool.query('SELECT id, email FROM users')).rows) ids[row.email] = Number(row.id);
}

after(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function call(email, method, route, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (email) headers['X-User-Id'] = String(ids[email]);
  const res = await fetch(base + route, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

const admin = 'admin@example.com';
const it = (name, fn) => test(name, { skip }, fn);
const person = { fullName: 'Nusrat Jahan', email: 'Nusrat@Example.com', phone: '01711-999999' };

it('only the admin can use the resident API', async () => {
  assert.equal((await call(null, 'GET', '/residents')).status, 401);
  assert.equal((await call('staff@example.com', 'GET', '/residents')).status, 403);
  assert.equal((await call('resident1@example.com', 'POST', '/residents', person)).status, 403);
});

it('lists residents only, with their units, and searches', async () => {
  const all = await call(admin, 'GET', '/residents');
  assert.equal(all.body.total, 3);
  const byUnit = await call(admin, 'GET', '/residents?q=3B');
  assert.deepEqual(byUnit.body.items.map((r) => r.units), [['1A', '3B']]);
  assert.equal((await call(admin, 'GET', '/residents?q=%25')).body.total, 0);
});

it('adds a resident, storing phone and email in one form', async () => {
  const added = await call(admin, 'POST', '/residents', person);
  assert.equal(added.status, 201);
  assert.equal(added.body.resident.phone, '+8801711999999');
  assert.equal(added.body.resident.email, 'nusrat@example.com');
  ids.added = added.body.resident.id;
});

it('names every wrong or duplicate field', async () => {
  const bad = await call(admin, 'POST', '/residents', { fullName: ' ', email: 'x', phone: '123' });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.body.error.fields).sort(), ['email', 'fullName', 'phone']);
  const sameEmail = await call(admin, 'POST', '/residents', { ...person, phone: '01711999998' });
  assert.ok(sameEmail.body.error.fields.email);
  const samePhone = await call(admin, 'POST', '/residents', { ...person, email: 'other@example.com' });
  assert.ok(samePhone.body.error.fields.phone);
});

it('edits one field and leaves the rest', async () => {
  const res = await call(admin, 'PATCH', `/residents/${ids.added}`, { fullName: 'Nusrat J.' });
  assert.equal(res.status, 200);
  assert.equal(res.body.resident.fullName, 'Nusrat J.');
  assert.equal(res.body.resident.phone, '+8801711999999');
});

it('deactivates and reactivates without deleting', async () => {
  assert.equal((await call(admin, 'POST', `/residents/${ids.added}/deactivate`)).body.resident.active, false);
  assert.equal((await call(admin, 'GET', '/residents?status=inactive')).body.total, 1);
  ids['nusrat'] = ids.added;
  assert.equal((await call('nusrat', 'GET', '/me')).status, 401);
  assert.equal((await call(admin, 'POST', `/residents/${ids.added}/reactivate`)).body.resident.active, true);
  assert.equal((await call('nusrat', 'GET', '/me')).status, 200);
});

it('answers 404 for unknown ids and for people who are not residents', async () => {
  for (const id of ['abc', 999999, ids[admin]]) {
    assert.equal((await call(admin, 'POST', `/residents/${id}/deactivate`)).status, 404);
  }
});
