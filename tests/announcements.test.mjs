/**
 * Announcement API tests over HTTP against a real PostgreSQL
 * database. They use their own database ("..._announcements_test") because test files
 * run at the same time. It is wiped on every run. Skipped when PostgreSQL is not reachable.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
require('dotenv').config({ path: path.join(import.meta.dirname, '..', '.env'), quiet: true });

const url = new URL(process.env.DATABASE_URL || 'postgres://localhost:5432/apartment_maintenance');
url.pathname += '_announcements_test';
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
const reader = 'resident1@example.com';
const notice = { title: 'Water off', body: 'Tank cleaning.\nSunday 10 am.', category: 'service' };
const mine = async (email) => (await call(email, 'GET', '/announcements')).body;
const send = async (email, method, route) => {
  const res = await fetch(base + route, { method, headers: { 'X-User-Id': String(ids[email]) } });
  return res.status;
};

it('lets only the admin publish, and keeps staff out', async () => {
  assert.equal((await call(null, 'GET', '/announcements')).status, 401);
  assert.equal((await call('staff@example.com', 'GET', '/announcements')).status, 403);
  assert.equal((await call(reader, 'POST', '/announcements', notice)).status, 403);
});

it('names every missing field', async () => {
  const bad = await call(admin, 'POST', '/announcements', { category: 'party' });
  assert.deepEqual(Object.keys(bad.body.error.fields).sort(), ['body', 'category', 'title']);
});

it('publishes to every active resident and notifies them', async () => {
  const res = await call(admin, 'POST', '/announcements', notice);
  assert.equal(res.status, 201);
  assert.equal(res.body.sentTo, 3);
  ids.news = res.body.announcement.id;
  const feed = await mine(reader);
  assert.equal(feed.unread, 1);
  assert.equal(feed.items[0].body, notice.body);
  const inbox = (await call(reader, 'GET', '/notifications')).body.items;
  assert.equal(inbox[0].announcementId, ids.news);
  assert.equal(inbox[0].message, 'New announcement: Water off');
});

it('tracks who has read it', async () => {
  const [item] = (await mine(reader)).items;
  assert.equal(await send(reader, 'POST', `/notifications/${item.notificationId}/read`), 204);
  assert.equal((await mine(reader)).unread, 0);
  assert.equal((await mine(admin)).items[0].readBy, 1);
  assert.equal(await send('resident2@example.com', 'POST', '/announcements/read-all'), 204);
  assert.equal((await mine(admin)).items[0].readBy, 2);
});

it('edits it and keeps the read state', async () => {
  const res = await call(admin, 'PATCH', `/announcements/${ids.news}`, { title: 'Water off Monday' });
  assert.equal(res.body.announcement.body, notice.body);
  const feed = await mine(reader);
  assert.equal(feed.items[0].title, 'Water off Monday');
  assert.equal(feed.items[0].read, true);
});

it('deletes it along with its notifications', async () => {
  assert.equal(await send(admin, 'DELETE', `/announcements/${ids.news}`), 204);
  assert.equal((await mine(reader)).total, 0);
  assert.equal((await call(reader, 'GET', '/notifications')).body.total, 0);
  assert.equal(await send(admin, 'DELETE', `/announcements/${ids.news}`), 404);
});
