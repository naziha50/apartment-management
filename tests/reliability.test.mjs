/**
 * NFR-08: "If an operation fails, no partial changes should be saved."
 *
 * Runs against its own test database (DATABASE_URL + "_reliability_test"),
 * which is wiped, migrated and seeded on every run, so your development data
 * is never touched. Without PostgreSQL the tests are skipped.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.join(import.meta.dirname, '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });

// A separate database, so this test never clashes with the development data or with api.test.mjs.
const devUrl = process.env.DATABASE_URL || 'postgres://localhost:5432/apartment_maintenance';
const testUrl = new URL(devUrl);
testUrl.pathname += '_reliability_test';
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
  base = `http://localhost:${server.address().port}`;
}
after(async () => {
  if (server) server.close();
  if (db) await db.pool.end();
});

/** Counts the rows in a table (only table names written in this file are passed in). */
async function count(table) {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0].n;
}

async function adminId() {
  const { rows } = await db.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  return rows[0].id;
}

test('a bill and its charge are saved together or not at all', { skip }, async () => {
  const billsBefore = await count('bills');
  const chargesBefore = await count('bill_charges');
  const admin = await adminId();
  const { rows } = await db.query('SELECT id FROM units ORDER BY id LIMIT 1');

  // Save a bill, then fail before the transaction finishes.
  await assert.rejects(
    db.withTransaction(async (client) => {
      const bill = await client.query(
        `INSERT INTO bills (unit_id, bill_type, bill_month, due_date, created_by)
         VALUES ($1, 'other', '2099-01-01', '2099-01-31', $2) RETURNING id`,
        [rows[0].id, admin],
      );
      await client.query(
        "INSERT INTO bill_charges (bill_id, charge_type, description, amount) VALUES ($1, 'other', 'Test', 100)",
        [bill.rows[0].id],
      );
      throw new Error('Something went wrong halfway');
    }),
    /halfway/,
  );

  // Nothing from the failed transaction was kept.
  assert.equal(await count('bills'), billsBefore);
  assert.equal(await count('bill_charges'), chargesBefore);
});

test('a refused payment saves nothing and leaves the balance unchanged', { skip }, async () => {
  const admin = await adminId();
  const headers = { 'X-User-Id': String(admin), 'Content-Type': 'application/json' };

  // Pick an unpaid bill and try to pay more than it owes.
  const { items } = await (await fetch(`${base}/api/v1/bills`, { headers })).json();
  const bill = items.find((b) => b.status !== 'paid');
  const paymentsBefore = await count('payments');

  const res = await fetch(`${base}/api/v1/bills/${bill.id}/payment`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ amount: bill.balance + 1, method: 'cash' }),
  });
  assert.equal(res.status, 400);

  assert.equal(await count('payments'), paymentsBefore);
  const after = await (await fetch(`${base}/api/v1/bills/${bill.id}`, { headers })).json();
  assert.equal(after.bill.balance, bill.balance);
});

test('generating bills twice for the same month adds no duplicates', { skip }, async () => {
  const admin = await adminId();
  const headers = { 'X-User-Id': String(admin), 'Content-Type': 'application/json' };
  const body = JSON.stringify({
    month: '2099-02', billType: 'rent', dueDate: '2099-02-10', amount: 5000, description: 'Rent',
  });

  const first = await (await fetch(`${base}/api/v1/bills/generate`, { method: 'POST', headers, body })).json();
  const billsAfterFirst = await count('bills');
  const second = await (await fetch(`${base}/api/v1/bills/generate`, { method: 'POST', headers, body })).json();

  assert.ok(first.created > 0);
  assert.equal(second.created, 0);
  assert.equal(await count('bills'), billsAfterFirst);
});
