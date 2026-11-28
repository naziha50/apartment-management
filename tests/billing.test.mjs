/**
 * Billing (FR-09 to FR-15) and dashboard (FR-27 to FR-30) API tests.
 *
 * The real Express app over HTTP, against its own test database
 * (DATABASE_URL + "_billing_test"), which is wiped, migrated and seeded on
 * every run, so your development data is never touched. Without PostgreSQL
 * the tests are skipped.
 *
 * The tests run in order and build on each other (a bill made in one test is
 * paid in the next), like an admin working through the billing pages.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.join(import.meta.dirname, '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });

// A separate database, so this file never clashes with the development data or the other test files.
const devUrl = process.env.DATABASE_URL || 'postgres://localhost:5432/apartment_maintenance';
const testUrl = new URL(devUrl);
testUrl.pathname += '_billing_test';
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

// ---------- helpers ----------

/** The id of a seeded user, found by email. */
async function userId(email) {
  const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  return Number(rows[0].id);
}

/** Calls the API as a user. Returns the status code and the JSON body. */
async function call(method, url, user, body) {
  const headers = { 'X-User-Id': String(user) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

/** The id of a unit, found by its number (1A, 2B, ...). */
async function unitId(admin, unitNumber) {
  const { body } = await call('GET', '/billing/units', admin);
  return body.items.find((u) => u.unitNumber === unitNumber).id;
}

let admin, staff, rahima, tanvir;
if (!skip) {
  admin = await userId('admin@example.com');
  staff = await userId('staff@example.com');
  rahima = await userId('resident1@example.com'); // lives in 1A and 3B
  tanvir = await userId('resident2@example.com'); // lives in 2A
}

// A bill made in "create one bill" and used by the charge and payment tests below.
let billId;

// ---------- FR-09: generate and create bills ----------

test('generate: one bill for every apartment, vacant ones included (FR-09)', { skip }, async () => {
  const month = { month: '2098-01', billType: 'rent', dueDate: '2098-01-10', amount: 4000, description: 'Rent' };
  const first = await call('POST', '/bills/generate', admin, month);

  assert.equal(first.status, 201);
  assert.equal(first.body.created, 6); // 6 units, including vacant 1B and 3A
  assert.deepEqual(first.body.skipped, []);
});

test('generate: the same month again adds no duplicates and reports them as skipped (FR-09)', { skip }, async () => {
  const month = { month: '2098-01', billType: 'rent', dueDate: '2098-01-10', amount: 4000, description: 'Rent' };
  const again = await call('POST', '/bills/generate', admin, month);

  assert.equal(again.status, 201);
  assert.equal(again.body.created, 0);
  assert.equal(again.body.skipped.length, 6);
});

test('generate: missing or wrong fields are refused with a message for each one', { skip }, async () => {
  const res = await call('POST', '/bills/generate', admin, {
    month: '2098-13', billType: 'parking', dueDate: '2098-02-30', amount: 0, description: '  ',
  });

  assert.equal(res.status, 400);
  assert.deepEqual(Object.keys(res.body.error.fields).sort(), ['amount', 'billType', 'description', 'dueDate', 'month']);
});

test('create one bill: total, balance and status are worked out from the charge (FR-09)', { skip }, async () => {
  const res = await call('POST', '/bills', admin, {
    unitId: await unitId(admin, '1B'), month: '2098-02', billType: 'utility', dueDate: '2098-02-10',
    amount: 1000, description: 'Electricity',
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.bill.unitNumber, '1B');
  assert.equal(res.body.bill.total, 1000);
  assert.equal(res.body.bill.balance, 1000);
  assert.equal(res.body.bill.status, 'unpaid');
  billId = res.body.bill.id;
});

test('create one bill: a second bill of the same type and month for the same unit is refused (FR-09)', { skip }, async () => {
  const res = await call('POST', '/bills', admin, {
    unitId: await unitId(admin, '1B'), month: '2098-02', billType: 'utility', dueDate: '2098-02-10',
    amount: 500, description: 'Electricity again',
  });

  assert.equal(res.status, 409);
});

test('create one bill: a unit that does not exist is refused', { skip }, async () => {
  const res = await call('POST', '/bills', admin, {
    unitId: 999999, month: '2098-02', billType: 'rent', dueDate: '2098-02-10', amount: 500, description: 'Rent',
  });

  assert.equal(res.status, 400);
  assert.ok(res.body.error.fields.unitId);
});

// ---------- FR-10: charges ----------

test('charges: adding, changing and removing a charge updates the total (FR-10)', { skip }, async () => {
  const added = await call('POST', `/bills/${billId}/charges`, admin, { chargeType: 'other', description: 'Lift fee', amount: 300 });
  assert.equal(added.status, 201);
  assert.equal(added.body.bill.total, 1300);

  const { body } = await call('GET', `/bills/${billId}`, admin);
  const liftFee = body.charges.find((c) => c.description === 'Lift fee');

  const changed = await call('PATCH', `/bills/${billId}/charges/${liftFee.id}`, admin, { chargeType: 'other', description: 'Lift fee', amount: 500 });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.bill.total, 1500);

  const removed = await call('DELETE', `/bills/${billId}/charges/${liftFee.id}`, admin);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.bill.total, 1000);
});

test('charges: a wrong charge is refused, and a charge on another bill is not found', { skip }, async () => {
  const bad = await call('POST', `/bills/${billId}/charges`, admin, { chargeType: 'gift', description: '', amount: -5 });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.body.error.fields).sort(), ['amount', 'chargeType', 'description']);

  const missing = await call('DELETE', `/bills/${billId}/charges/999999`, admin);
  assert.equal(missing.status, 404);

  const noBill = await call('POST', '/bills/999999/charges', admin, { chargeType: 'other', description: 'Fee', amount: 10 });
  assert.equal(noBill.status, 404);
});

// ---------- FR-11, FR-12: payments and status ----------

test('payments: a partial payment lowers the balance and the bill stays unpaid (FR-11, FR-12)', { skip }, async () => {
  const res = await call('POST', `/bills/${billId}/payment`, admin, { amount: 600, method: 'bkash' });

  assert.equal(res.status, 201);
  assert.equal(res.body.bill.paid, 600);
  assert.equal(res.body.bill.balance, 400);
  assert.equal(res.body.bill.status, 'unpaid');
});

test('payments: zero, too much, a future date or an unknown method are refused and nothing is saved (FR-11)', { skip }, async () => {
  const tries = [
    { amount: 0, method: 'cash' },
    { amount: 401, method: 'cash' }, // 1 taka more than the balance
    { amount: 100, method: 'cash', paidOn: '2999-01-01' },
    { amount: 100, method: 'cheque' },
    { amount: 10.5, method: 'cash' },
  ];
  for (const body of tries) {
    const res = await call('POST', `/bills/${billId}/payment`, admin, body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }

  const { body } = await call('GET', `/bills/${billId}`, admin);
  assert.equal(body.payments.length, 1);
  assert.equal(body.bill.balance, 400);
});

test('charges: a change that would make the bill cost less than what was paid is refused (FR-10)', { skip }, async () => {
  const { body } = await call('GET', `/bills/${billId}`, admin);
  const charge = body.charges[0]; // 1000, with 600 paid

  const lower = await call('PATCH', `/bills/${billId}/charges/${charge.id}`, admin, { chargeType: 'utility', description: 'Electricity', amount: 500 });
  assert.equal(lower.status, 400);

  const remove = await call('DELETE', `/bills/${billId}/charges/${charge.id}`, admin);
  assert.equal(remove.status, 409);
});

test('payments: paying the rest marks the bill paid, and a paid bill takes no more payments (FR-12)', { skip }, async () => {
  const rest = await call('POST', `/bills/${billId}/payment`, admin, { amount: 400, method: 'cash' });
  assert.equal(rest.status, 201);
  assert.equal(rest.body.bill.balance, 0);
  assert.equal(rest.body.bill.status, 'paid');

  const more = await call('POST', `/bills/${billId}/payment`, admin, { amount: 1, method: 'cash' });
  assert.equal(more.status, 400);
});

test('status: an unpaid bill past its due date is overdue (FR-12)', { skip }, async () => {
  const { body } = await call('GET', '/bills', admin);
  const october2B = body.items.find((b) => b.unitNumber === '2B' && b.billMonth.startsWith('2026-10'));

  assert.equal(october2B.status, 'overdue'); // seeded with no payment, due 2026-10-10
});

// ---------- FR-13, FR-14: residents and receipts ----------

test('residents see only the bills and payments of their own apartments (FR-13, NFR-16)', { skip }, async () => {
  const bills = await call('GET', '/bills', tanvir);
  assert.equal(bills.status, 200);
  assert.ok(bills.body.items.length > 0);
  assert.ok(bills.body.items.every((b) => b.unitNumber === '2A'));

  const payments = await call('GET', '/payments', tanvir);
  assert.ok(payments.body.items.every((p) => p.unitNumber === '2A'));
});

test('a resident gets "not found" for another resident\'s bill or receipt (FR-13, NFR-16)', { skip }, async () => {
  const all = await call('GET', '/bills', admin);
  const rahimasBill = all.body.items.find((b) => b.unitNumber === '1A');
  const payments = await call('GET', '/payments', admin);
  const rahimasPayment = payments.body.items.find((p) => p.unitNumber === '1A');

  assert.equal((await call('GET', `/bills/${rahimasBill.id}`, tanvir)).status, 404);
  assert.equal((await call('GET', `/payments/${rahimasPayment.id}`, tanvir)).status, 404);
});

test('receipt: shows the resident, apartment, amount, date and method (FR-14)', { skip }, async () => {
  const payments = await call('GET', '/payments', rahima);
  const res = await call('GET', `/payments/${payments.body.items[0].id}`, rahima);

  assert.equal(res.status, 200);
  const p = res.body.payment;
  assert.match(p.residentNames, /Rahima Rahman/);
  assert.ok(['1A', '3B'].includes(p.unitNumber));
  assert.ok(p.amount > 0);
  assert.match(p.paidOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(['cash', 'bkash', 'bank'].includes(p.method));
});

test('staff have no access to billing, and residents cannot change bills (FR-02)', { skip }, async () => {
  assert.equal((await call('GET', '/bills', staff)).status, 403);
  assert.equal((await call('GET', '/payments', staff)).status, 403);
  assert.equal((await call('POST', '/bills/generate', rahima, {})).status, 403);
  assert.equal((await call('POST', `/bills/${billId}/payment`, rahima, { amount: 1, method: 'cash' })).status, 403);
  assert.equal((await call('GET', '/billing/report', rahima)).status, 403);
});

test('ids that are not whole numbers are simply not found', { skip }, async () => {
  assert.equal((await call('GET', '/bills/abc', admin)).status, 404);
  assert.equal((await call('GET', '/payments/-1', admin)).status, 404);
});

// ---------- FR-15: report ----------

test('report: the totals match the recorded bills and payments (FR-15)', { skip }, async () => {
  const report = await call('GET', '/billing/report', admin);
  assert.equal(report.status, 200);

  const bills = (await call('GET', '/bills', admin)).body.items;
  const payments = (await call('GET', '/payments', admin)).body.items;
  const owed = bills.filter((b) => b.status !== 'paid').reduce((sum, b) => sum + b.balance, 0);
  const paid = payments.reduce((sum, p) => sum + p.amount, 0);

  assert.equal(report.body.outstanding, owed);
  assert.equal(report.body.collected, paid);
  // Each unit with dues owes exactly the balance of its unpaid bills.
  assert.ok(report.body.unitsWithDues.length > 0);
  for (const unit of report.body.unitsWithDues) {
    const unpaid = bills.filter((b) => b.unitNumber === unit.unitNumber && b.status !== 'paid');
    assert.equal(unit.amountOwed, unpaid.reduce((sum, b) => sum + b.balance, 0), unit.unitNumber);
    assert.equal(unit.unpaidBills, unpaid.length, unit.unitNumber);
  }
});

test('report: a month range only counts bills in those months (FR-15)', { skip }, async () => {
  const res = await call('GET', '/billing/report?from=2026-10&to=2026-10', admin);

  assert.equal(res.status, 200);
  assert.equal(res.body.billed, 8500); // October: 3000 + 3000 + 2500
  assert.equal(res.body.outstanding, 2500); // only 2B is unpaid
});

test('report: a wrong month or a range that ends before it starts is refused', { skip }, async () => {
  assert.equal((await call('GET', '/billing/report?from=2026-13', admin)).status, 400);
  assert.equal((await call('GET', '/billing/report?from=2026-12&to=2026-01', admin)).status, 400);
});

// ---------- FR-27 to FR-30: dashboard ----------

test('dashboard: building counts are correct (FR-27)', { skip }, async () => {
  const res = await call('GET', '/dashboard', admin);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.occupancy, { totalUnits: 6, occupiedUnits: 4, vacantUnits: 2, residents: 3 });
});

test('dashboard: the billing summary matches the billing report (FR-28)', { skip }, async () => {
  const dash = (await call('GET', '/dashboard', admin)).body;
  const report = (await call('GET', '/billing/report', admin)).body;

  assert.equal(dash.billing.collected, report.collected);
  assert.equal(dash.billing.outstanding, report.outstanding);
  assert.ok(dash.billing.overdueBills >= 2); // 2B October and 3B November are overdue
});

test('dashboard: maintenance counts and recent activity are shown (FR-29, FR-30)', { skip }, async () => {
  const res = await call('GET', '/dashboard', admin);

  assert.equal(typeof res.body.maintenance.overdue, 'number');
  assert.equal(typeof res.body.maintenance.byStatus, 'object');
  assert.ok(res.body.recentActivity.length > 0);
  assert.ok(res.body.recentActivity.length <= 10);
  const times = res.body.recentActivity.map((a) => new Date(a.at).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a)); // newest first
});

test('dashboard: overdue requests use the same rule as the Requests page (FR-29, BR-17, BR-25)', { skip }, async () => {
  // A scheduled-task request created 5 days ago but due in 2 days is not overdue yet,
  // even though 5 days is past the 72-hour target for Medium.
  const { rows } = await db.query(
    `INSERT INTO scheduled_tasks (title, description, category, interval_months, next_due_date, created_by)
     VALUES ('Clean the water tank', 'Every 6 months', 'water_supply', 6, CURRENT_DATE + 2, $1) RETURNING id`,
    [admin],
  );
  await db.query(
    `INSERT INTO maintenance_requests
       (title, description, category, location, status, priority, submitted_at, reviewed_at, scheduled_task_id, due_date)
     VALUES ('Clean the water tank', 'Every 6 months', 'water_supply', 'common_area', 'under_review', 'medium',
             now() - interval '5 days', now() - interval '5 days', $1, CURRENT_DATE + 2)`,
    [rows[0].id],
  );

  const dash = (await call('GET', '/dashboard', admin)).body;
  const overview = (await call('GET', '/maintenance/overview', admin)).body;
  assert.equal(dash.maintenance.overdue, overview.overdue);
  assert.equal(dash.maintenance.byStatus.under_review, overview.under_review);
});

test('dashboard: a new announcement shows in recent announcements and recent activity (FR-30)', { skip }, async () => {
  const before = (await call('GET', '/dashboard', admin)).body;
  assert.ok(Array.isArray(before.announcements)); // the announcements module is installed

  const published = await call('POST', '/announcements', admin, {
    title: 'Water off on Friday', body: 'The water supply will be off from 10 am to 2 pm.', category: 'service',
  });
  assert.equal(published.status, 201);

  const after = (await call('GET', '/dashboard', admin)).body;
  assert.equal(after.announcements[0].title, 'Water off on Friday'); // newest first
  assert.equal(after.announcements[0].category, 'service');
  assert.ok(after.announcements.length <= 5);
  assert.ok(after.recentActivity.some((a) => a.kind === 'announcement' && a.text.includes('Water off on Friday')));
});

test('dashboard: only the admin can open it (FR-02)', { skip }, async () => {
  assert.equal((await call('GET', '/dashboard', staff)).status, 403);
  assert.equal((await call('GET', '/dashboard', rahima)).status, 403);
  assert.equal((await call('GET', '/dashboard/search?q=1A', tanvir)).status, 403);
});

test('search: finds residents, apartments and bills (FR-30)', { skip }, async () => {
  const byUnit = await call('GET', '/dashboard/search?q=2B', admin);
  assert.equal(byUnit.status, 200);
  assert.ok(byUnit.body.units.some((u) => u.unitNumber === '2B'));
  assert.ok(byUnit.body.bills.length > 0);
  assert.ok(byUnit.body.bills.every((b) => b.unitNumber === '2B'));

  const byName = await call('GET', '/dashboard/search?q=rahima', admin);
  assert.ok(byName.body.residents.some((r) => r.fullName === 'Rahima Rahman'));
});

test('search: fewer than 2 characters is refused, and % is matched as a plain character (FR-30)', { skip }, async () => {
  assert.equal((await call('GET', '/dashboard/search?q=a', admin)).status, 400);
  assert.equal((await call('GET', '/dashboard/search', admin)).status, 400);

  const percent = await call('GET', `/dashboard/search?q=${encodeURIComponent('%%')}`, admin);
  assert.equal(percent.status, 200);
  assert.equal(percent.body.residents.length + percent.body.units.length + percent.body.bills.length, 0);
});
