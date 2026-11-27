/**
 * Apartment and occupancy API tests over HTTP against a real PostgreSQL
 * database. They use their own database ("..._units_test") because test files
 * run at the same time. It is wiped on every run. Skipped when PostgreSQL is not reachable.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
require('dotenv').config({ path: path.join(import.meta.dirname, '..', '.env'), quiet: true });

const url = new URL(process.env.DATABASE_URL || 'postgres://localhost:5432/apartment_maintenance');
url.pathname += '_units_test';
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
const { dayOf, addDays } = require('../server/lib/dates');
const tenant = 'resident2@example.com';

it('only the admin can use the apartment API', async () => {
  assert.equal((await call(null, 'GET', '/units')).status, 401);
  assert.equal((await call('staff@example.com', 'GET', '/units')).status, 403);
  assert.equal((await call(tenant, 'POST', '/units', {})).status, 403);
});

it('lists units with their current residents', async () => {
  const { body } = await call(admin, 'GET', '/units');
  assert.equal(body.items.length, 6);
  assert.deepEqual(body.items.find((u) => u.unitNumber === '1B').residents, []);
  assert.equal(body.items.find((u) => u.unitNumber === '2A').residents[0].type, 'tenant');
});

it('adds a unit and refuses bad or repeated numbers', async () => {
  const added = await call(admin, 'POST', '/units', { unitNumber: '4b', floor: '4', sizeSqft: '', bedrooms: '2' });
  assert.equal(added.status, 201);
  assert.equal(added.body.unit.unitNumber, '4B');
  assert.equal(added.body.unit.sizeSqft, null);
  ids.unit = added.body.unit.id;
  const again = await call(admin, 'POST', '/units', { unitNumber: '4B', floor: 4 });
  assert.ok(again.body.error.fields.unitNumber);
  const bad = await call(admin, 'POST', '/units', { unitNumber: 'a b', floor: '-1', bedrooms: '1.5' });
  assert.deepEqual(Object.keys(bad.body.error.fields).sort(), ['bedrooms', 'floor', 'unitNumber']);
});

it('assigns a resident, but not twice and not in the future', async () => {
  const stay = { residentId: ids[tenant], type: 'tenant', startDate: addDays(dayOf(), -10) };
  const url = `/units/${ids.unit}/occupancies`;
  const future = await call(admin, 'POST', url, { ...stay, startDate: addDays(dayOf(), 1) });
  assert.ok(future.body.error.fields.startDate);
  const notResident = await call(admin, 'POST', url, { ...stay, residentId: ids[admin] });
  assert.ok(notResident.body.error.fields.residentId);
  const ok = await call(admin, 'POST', url, stay);
  assert.equal(ok.status, 201);
  ids.stay = ok.body.unit.history[0].id;
  assert.equal((await call(admin, 'POST', url, stay)).status, 409);
});

it('records a move-out once and keeps the history', async () => {
  const url = `/units/occupancies/${ids.stay}/move-out`;
  const early = await call(admin, 'POST', url, { endDate: addDays(dayOf(), -11) });
  assert.ok(early.body.error.fields.endDate);
  const done = await call(admin, 'POST', url, { endDate: addDays(dayOf(), -1) });
  assert.equal(done.status, 200);
  assert.equal(done.body.unit.history.length, 1);
  assert.equal((await call(admin, 'POST', url, { endDate: dayOf() })).status, 409);
  const { body } = await call(admin, 'GET', '/units');
  assert.deepEqual(body.items.find((u) => u.id === ids.unit).residents, []);
});

it('answers 404 for unknown units and stays', async () => {
  assert.equal((await call(admin, 'GET', '/units/999999')).status, 404);
  assert.equal((await call(admin, 'POST', '/units/occupancies/abc/move-out', {})).status, 404);
});
