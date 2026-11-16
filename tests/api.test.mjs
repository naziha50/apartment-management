/**
 * API integration tests (NFR-22): the real Express app over HTTP against a
 * real PostgreSQL test database. Run with `npm test`.
 *
 * The test database is TEST_DATABASE_URL, or DATABASE_URL with "_test" added
 * to the database name. It is wiped, migrated and seeded on every run, so it
 * must never be your development database (checked below). Uploaded photos go
 * to a temporary folder that is deleted afterwards.
 *
 * Without a reachable PostgreSQL the tests are skipped with the reason shown.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.join(import.meta.dirname, '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });

// ------------------------------------------------------------------ setup
const devUrl = process.env.DATABASE_URL || 'postgres://localhost:5432/apartment_maintenance';
const testUrl = process.env.TEST_DATABASE_URL || (() => {
  const u = new URL(devUrl);
  u.pathname += '_test';
  return u.toString();
})();
// The tests wipe this database, so it must never be the development one (same host, port and name).
const where = (u) => {
  const url = new URL(u);
  return `${url.hostname}:${url.port || 5432}${url.pathname}`;
};
if (where(testUrl) === where(devUrl)) {
  throw new Error(`Refusing to run: the test database (${where(testUrl)}) is the development database. Set TEST_DATABASE_URL to another database.`);
}
// config.js reads these when the app is loaded, so set them first (dotenv never overrides them).
process.env.DATABASE_URL = testUrl;
const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'am-test-uploads-'));
process.env.UPLOAD_DIR = uploadDir;

let skip = false;
try {
  const { createDatabase } = require('../db/create-db');
  const { migrate } = require('../db/migrate');
  const { seed } = require('../db/seed');
  const quiet = () => {};
  await createDatabase(testUrl);
  await migrate({ databaseUrl: testUrl, reset: true, log: quiet });
  await seed({ databaseUrl: testUrl, log: quiet });
} catch (err) {
  // A refused connection has an empty message and only a code (e.g. ECONNREFUSED).
  skip = `PostgreSQL test database not available: ${err.message || err.code || err}`;
}

let server;
let base;
let pool;
if (!skip) {
  const { createApp } = require('../server/app');
  ({ pool } = require('../server/db/pool'));
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}/api/v1`;
}

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
  await rm(uploadDir, { recursive: true, force: true });
});

/** One API call as a demo user (the "Viewing as" header). Returns { status, body }. */
async function call(userId, method, url, body) {
  const headers = {};
  if (userId) headers['X-User-Id'] = String(userId);
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON (e.g. a photo) */
  }
  return { status: res.status, body: json, type: res.headers.get('content-type') };
}

const it = (name, fn) => test(name, { skip }, fn);

// Demo users by email, so the tests do not depend on id numbers.
const U = {};
const state = {};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

// ------------------------------------------------------------------ tests
it('health check and demo users', async () => {
  const health = await call(null, 'GET', '/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.database, 'connected');

  const { body } = await call(null, 'GET', '/dev/users');
  const byEmail = Object.fromEntries(body.items.map((u) => [u.email, u.id]));
  Object.assign(U, {
    admin: byEmail['admin@example.com'],
    karim: byEmail['staff@example.com'], // staff: view_all + review
    jamal: byEmail['caretaker@example.com'], // staff: assigned requests only
    rahima: byEmail['resident1@example.com'], // two apartments
    tanvir: byEmail['resident2@example.com'], // one apartment
    sadia: byEmail['resident3@example.com'],
  });
  assert.ok(Object.values(U).every(Boolean), 'all demo users are seeded');
});

it('maintenance needs a "Viewing as" user', async () => {
  assert.equal((await call(null, 'GET', '/maintenance/requests')).status, 401);
});

it('a resident submits a request; resident and unit are filled in by the server (FR-16, FR-17)', async () => {
  const bad = await call(U.tanvir, 'POST', '/maintenance/requests', { title: 'x', category: 'nope', location: 'unit', description: '' });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.body.error.fields).sort(), ['category', 'description', 'title']);

  const res = await call(U.tanvir, 'POST', '/maintenance/requests', {
    title: 'Kitchen tap leaking', category: 'plumbing', location: 'unit', description: 'Drips all night', submittedBy: U.admin,
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'submitted');
  assert.match(res.body.requestNumber, /^MR-\d{4}-\d{5}$/);
  assert.equal(res.body.submittedBy.id, U.tanvir, 'the submitter cannot be faked');
  assert.ok(res.body.unit, 'the only apartment is filled in');
  state.id = res.body.id;

  const staffTry = await call(U.jamal, 'POST', '/maintenance/requests', { title: 'Staff test', category: 'other', location: 'unit', description: 'x' });
  assert.equal(staffTry.status, 403);
});

it('only the people involved can see a request; others get 404 (FR-21, NFR-24)', async () => {
  assert.equal((await call(U.tanvir, 'GET', `/maintenance/requests/${state.id}`)).status, 200);
  assert.equal((await call(U.admin, 'GET', `/maintenance/requests/${state.id}`)).status, 200);
  assert.equal((await call(U.karim, 'GET', `/maintenance/requests/${state.id}`)).status, 200);
  assert.equal((await call(U.sadia, 'GET', `/maintenance/requests/${state.id}`)).status, 404);
  assert.equal((await call(U.jamal, 'GET', `/maintenance/requests/${state.id}`)).status, 404, 'not assigned yet');
  assert.equal((await call(U.sadia, 'GET', '/maintenance/requests')).body.total, 0);
});

it('the whole life of a request: review, assign, work, notes, resolve, confirm', async () => {
  const url = `/maintenance/requests/${state.id}`;
  const move = (user, body) => call(user, 'POST', `${url}/transition`, body);

  assert.equal((await move(U.tanvir, { to: 'under_review', priority: 'high' })).status, 409, 'residents cannot review');
  assert.equal((await move(U.admin, { to: 'under_review' })).status, 400, 'review needs a priority');
  assert.equal((await move(U.admin, { to: 'under_review', priority: 'high' })).body.status, 'under_review');
  assert.equal((await move(U.admin, { to: 'in_progress' })).status, 409, 'nobody assigned yet');

  assert.equal((await call(U.karim, 'POST', `${url}/assign`, { staffId: U.jamal })).status, 403, 'Karim may not assign');
  assert.equal((await call(U.admin, 'POST', `${url}/assign`, { staffId: U.rahima })).status, 400, 'residents cannot be assigned');
  assert.equal((await call(U.admin, 'POST', `${url}/assign`, { staffId: U.jamal })).body.assignedTo.id, U.jamal);
  assert.equal((await call(U.jamal, 'GET', '/maintenance/requests')).body.total, 1, 'now in Jamal\'s tasks');

  assert.equal((await move(U.jamal, { to: 'in_progress' })).body.status, 'in_progress');
  assert.equal((await call(U.admin, 'PATCH', `${url}/priority`, { priority: 'medium' })).body.priority, 'medium');
  assert.equal((await call(U.jamal, 'PATCH', `${url}/priority`, { priority: 'low' })).status, 403);

  assert.equal((await call(U.jamal, 'POST', `${url}/notes`, { note: 'Supplier code 4471', internal: true })).status, 201);
  assert.equal((await call(U.jamal, 'POST', `${url}/notes`, { note: 'Part ordered' })).status, 201);
  assert.equal((await call(U.tanvir, 'POST', `${url}/notes`, { note: 'Hello' })).status, 403);

  assert.equal((await move(U.jamal, { to: 'resolved' })).status, 400, 'resolving needs a note');
  assert.equal((await move(U.jamal, { to: 'resolved', note: 'Washer replaced' })).body.status, 'resolved');

  const asResident = (await call(U.tanvir, 'GET', url)).body;
  assert.deepEqual(asResident.allowed.transitions.map((t) => t.to).sort(), ['closed', 'in_progress']);
  const notes = asResident.updates.filter((u) => u.kind === 'note').map((u) => u.note);
  assert.deepEqual(notes, ['Part ordered'], 'internal notes never reach the resident');
  assert.equal((await call(U.admin, 'GET', url)).body.updates.filter((u) => u.isInternal).length, 1, 'staff still see it');

  const closed = await move(U.tanvir, { to: 'closed' });
  assert.equal(closed.body.status, 'closed');
  // The full history, as staff see it (the resident's copy leaves out the internal note).
  const history = (await call(U.admin, 'GET', url)).body.updates;
  assert.deepEqual(
    history.map((u) => u.kind + (u.toStatus ? `:${u.toStatus}` : '')),
    ['status_change:submitted', 'status_change:under_review', 'assignment', 'status_change:in_progress',
      'priority', 'note', 'note', 'status_change:resolved', 'status_change:closed'],
  );
  assert.equal((await move(U.admin, { to: 'under_review', priority: 'low' })).status, 409, 'closed is final');
  assert.equal((await call(U.admin, 'POST', `${url}/notes`, { note: 'late' })).status, 403);
});

it('filters, search and the overview (FR-22, FR-29)', async () => {
  const list = (query) => call(U.admin, 'GET', `/maintenance/requests?${new URLSearchParams(query)}`);
  assert.equal((await list({ status: 'closed' })).body.total, 1);
  assert.equal((await list({ status: 'submitted,under_review' })).body.total, 0);
  assert.equal((await list({ q: 'tap' })).body.total, 1);
  assert.equal((await list({ q: '%' })).body.total, 0, '% is matched literally');
  assert.equal((await list({ status: 'done' })).status, 400);

  const overview = await call(U.admin, 'GET', '/maintenance/overview');
  assert.equal(overview.status, 200);
  assert.equal(overview.body.closed, 1);
  assert.equal(overview.body.submitted, 0);
  assert.equal((await call(U.jamal, 'GET', '/maintenance/overview')).status, 403);
});

it('photos: checked by content, served only to people who may see the request (BR-19)', async () => {
  const form = (files) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ title: 'Door photo', category: 'other', location: 'unit', description: 'See photo' })) f.append(k, v);
    for (const [name, bytes] of files) f.append('photos', new Blob([bytes]), name);
    return f;
  };
  const fake = await call(U.tanvir, 'POST', '/maintenance/requests', form([['virus.jpg', 'MZ not an image']]));
  assert.equal(fake.status, 400);
  assert.match(fake.body.error.fields.photos, /not a JPG, PNG or WEBP/);

  const tooMany = await call(U.tanvir, 'POST', '/maintenance/requests', form([1, 2, 3, 4].map((n) => [`${n}.png`, PNG])));
  assert.equal(tooMany.status, 400);

  const ok = await call(U.tanvir, 'POST', '/maintenance/requests', form([['door.png', PNG]]));
  assert.equal(ok.status, 201);
  const { attachments } = (await call(U.tanvir, 'GET', `/maintenance/requests/${ok.body.id}`)).body;
  assert.equal(attachments.length, 1);
  const photoUrl = attachments[0].url.replace('/api/v1', '');

  const own = await call(U.tanvir, 'GET', photoUrl);
  assert.equal(own.status, 200);
  assert.equal(own.type, 'image/png');
  assert.equal((await call(U.sadia, 'GET', photoUrl)).status, 404);
});

it('resolved requests close by themselves after 7 days, exactly once (BR-18)', async () => {
  const make = async (title) => (await call(U.tanvir, 'POST', '/maintenance/requests', { title, category: 'other', location: 'unit', description: 'x' })).body.id;
  const old = await make('Resolved 8 days ago');
  const recent = await make('Resolved 6 days ago');
  // Jump straight to "resolved" in the past; the full path there is covered by the lifecycle test.
  const resolve = (id, days) => pool.query(
    `UPDATE maintenance_requests SET status = 'resolved', resolution_note = 'Fixed', resolved_at = now() - make_interval(days => $2) WHERE id = $1`,
    [id, days],
  );
  await resolve(old, 8);
  await resolve(recent, 6);

  const recentBefore = (await call(U.tanvir, 'GET', `/maintenance/requests/${recent}`)).body;
  const daysLeft = (new Date(recentBefore.autoCloseAt) - Date.now()) / 86400000;
  assert.ok(daysLeft > 0.9 && daysLeft < 1.1, `closes in about 1 day (got ${daysLeft.toFixed(2)})`);

  const { autoCloseResolved } = require('../server/modules/maintenance/maintenance.service');
  assert.equal(await autoCloseResolved(), 1, 'only the 8-day-old one');
  assert.equal(await autoCloseResolved(), 0, 'running again closes nothing twice');

  const closed = (await call(U.tanvir, 'GET', `/maintenance/requests/${old}`)).body;
  assert.equal(closed.status, 'closed');
  assert.equal(closed.autoCloseAt, null);
  const last = closed.updates.at(-1);
  assert.equal(last.author, 'System');
  assert.equal(last.toStatus, 'closed');
  assert.match(last.note, /Closed automatically/);
  assert.equal((await call(U.tanvir, 'GET', `/maintenance/requests/${recent}`)).body.status, 'resolved');

  // Two server processes running the job at the same moment still close it only once.
  const raced = await make('Resolved 9 days ago');
  await resolve(raced, 9);
  const counts = await Promise.all([autoCloseResolved(), autoCloseResolved()]);
  assert.equal(counts[0] + counts[1], 1, `closed once in total (got ${counts})`);
  const history = (await call(U.admin, 'GET', `/maintenance/requests/${raced}`)).body.updates;
  assert.equal(history.filter((u) => u.toStatus === 'closed').length, 1, 'one history entry, not two');
});

it('the resident rates a closed request once, within 7 days (FR-50, BR-26)', async () => {
  const make = async (title) => (await call(U.tanvir, 'POST', '/maintenance/requests', { title, category: 'other', location: 'unit', description: 'x' })).body.id;
  const setStatus = (id, status, daysAgo) => pool.query(
    `UPDATE maintenance_requests SET status = $2::request_status, resolution_note = 'Fixed',
            resolved_at = now() - make_interval(days => $3 + 1), closed_at = CASE WHEN $2 = 'closed' THEN now() - make_interval(days => $3) END
      WHERE id = $1`,
    [id, status, daysAgo],
  );
  const rate = (user, id, body) => call(user, 'POST', `/maintenance/requests/${id}/rating`, body);

  const id = await make('Rate me');
  await setStatus(id, 'closed', 1);
  assert.equal((await call(U.tanvir, 'GET', `/maintenance/requests/${id}`)).body.allowed.rate, true);

  for (const bad of [0, 6, 2.5, 'five']) assert.equal((await rate(U.tanvir, id, { rating: bad })).status, 400, String(bad));
  assert.equal((await rate(U.tanvir, id, { rating: 4, comment: 'x'.repeat(501) })).status, 400, 'comment too long');
  assert.equal((await rate(U.sadia, id, { rating: 5 })).status, 404, 'cannot see it');
  assert.equal((await rate(U.admin, id, { rating: 5 })).status, 403, 'not the reporter');

  const ok = await rate(U.tanvir, id, { rating: 4, comment: 'Quick and tidy' });
  assert.equal(ok.status, 201);
  assert.deepEqual({ rating: ok.body.rating.rating, comment: ok.body.rating.comment }, { rating: 4, comment: 'Quick and tidy' });
  assert.equal(ok.body.allowed.rate, false);
  assert.equal((await rate(U.tanvir, id, { rating: 1 })).status, 409, 'once only, never changed');
  assert.equal((await call(U.admin, 'GET', `/maintenance/requests/${id}`)).body.rating.rating, 4, 'staff see it too');

  // Two quick clicks at the same moment: exactly one rating is stored.
  const twice = await make('Double click');
  await setStatus(twice, 'closed', 1);
  const results = (await Promise.all([rate(U.tanvir, twice, { rating: 5 }), rate(U.tanvir, twice, { rating: 3 })])).map((r) => r.status).sort();
  assert.deepEqual(results, [201, 409]);

  const late = await make('Closed long ago');
  await setStatus(late, 'closed', 8);
  assert.match((await rate(U.tanvir, late, { rating: 5 })).body.error.message, /within 7 days/);
  const open = await make('Not closed yet');
  await setStatus(open, 'resolved', 1);
  assert.match((await rate(U.tanvir, open, { rating: 5 })).body.error.message, /once it is closed/);
});

it('notifications reach the right people, never the actor, and never leak internal notes (FR-25)', async () => {
  const mine = async (user, requestId) => (await call(user, 'GET', '/notifications')).body.items.filter((n) => n.requestId === requestId).map((n) => n.message);
  const unread = async (user) => (await call(user, 'GET', '/notifications/unread-count')).body.unread;

  const id = (await call(U.tanvir, 'POST', '/maintenance/requests', { title: 'Leaking pipe', category: 'plumbing', location: 'unit', description: 'x' })).body.id;
  assert.deepEqual(await mine(U.admin, id), [`New request from Tanvir Ahmed: Leaking pipe`], 'the office hears about it');
  assert.equal((await mine(U.karim, id)).length, 1, 'reviewing staff too');
  assert.deepEqual(await mine(U.jamal, id), [], 'staff who do not review do not');
  assert.deepEqual(await mine(U.tanvir, id), [], 'not about your own action');

  const url = `/maintenance/requests/${id}`;
  await call(U.admin, 'POST', `${url}/transition`, { to: 'under_review', priority: 'high' });
  assert.match((await mine(U.tanvir, id))[0], /is now under review/);
  await call(U.admin, 'POST', `${url}/assign`, { staffId: U.jamal });
  assert.match((await mine(U.jamal, id))[0], /You were assigned request/);

  await call(U.jamal, 'POST', `${url}/notes`, { note: 'Supplier code 4471', internal: true });
  assert.ok((await mine(U.tanvir, id)).every((m) => !m.includes('4471')), 'internal notes never reach the resident');
  await call(U.jamal, 'POST', `${url}/notes`, { note: 'Part ordered' });
  assert.match((await mine(U.tanvir, id))[0], /New note on request .*: Part ordered/);
  assert.ok((await mine(U.jamal, id)).every((m) => !m.includes('Part ordered')), 'not about your own note');

  // Reading: one, then all; someone else's notification is not found.
  const before = await unread(U.tanvir);
  assert.ok(before >= 2);
  const first = (await call(U.tanvir, 'GET', '/notifications')).body.items[0];
  assert.equal((await call(U.sadia, 'POST', `/notifications/${first.id}/read`)).status, 404, 'not yours');
  assert.equal((await call(U.tanvir, 'POST', `/notifications/${first.id}/read`)).status, 204);
  assert.equal(await unread(U.tanvir), before - 1);
  assert.equal((await call(U.tanvir, 'POST', '/notifications/read-all')).status, 204);
  assert.equal(await unread(U.tanvir), 0);

  // The automatic close tells the resident, in the same statement.
  await pool.query(`UPDATE maintenance_requests SET status = 'resolved', resolution_note = 'Fixed', resolved_at = now() - interval '8 days' WHERE id = $1`, [id]);
  const { autoCloseResolved } = require('../server/modules/maintenance/maintenance.service');
  await autoCloseResolved();
  assert.match((await mine(U.tanvir, id))[0], /was closed automatically/);
  assert.equal(await unread(U.tanvir), 1);
});

it('request numbers keep working after 99,999 (migration 004)', async () => {
  // Safe: this file only ever talks to the test database, which is wiped on every run.
  await pool.query("SELECT setval('maintenance_request_number_seq', 99998)");
  const make = () => call(U.tanvir, 'POST', '/maintenance/requests', { title: 'Number check', category: 'other', location: 'unit', description: 'x' });
  const a = await make();
  const b = await make();
  assert.equal(a.status, 201);
  assert.equal(b.status, 201, 'request 100000 must not collide with request 10000');
  assert.match(a.body.requestNumber, /^MR-\d{4}-99999$/);
  assert.match(b.body.requestNumber, /^MR-\d{4}-100000$/);
});
