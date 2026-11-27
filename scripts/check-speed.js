'use strict';
/**
 * NFR-10 and NFR-11: checks that common actions answer within 3 seconds.
 *
 *   npm run check:speed
 *
 * Starts the app on a free port, runs each action 5 times as the admin or a
 * resident, and prints the average and slowest time. Uses your development
 * database with the demo data (the "expected demonstration workload").
 * The one save it does (a test bill) is deleted again at the end.
 */
const { createApp } = require('../server/app');
const db = require('../server/db/pool');

const LIMIT_MS = 3000; // NFR-10: "within about 3 seconds"
const RUNS = 5;

/** Times one request in milliseconds. Fails if the server answers with an error. */
async function timeRequest(base, { path, userId, method = 'GET', body }) {
  const headers = { 'X-User-Id': String(userId) };
  if (body) headers['Content-Type'] = 'application/json';

  const start = performance.now();
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  await res.text(); // wait for the whole answer, not just the first byte
  const ms = performance.now() - start;

  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}`);
  return ms;
}

async function main() {
  // Look up the demo users and one unit so the script works after any db:reset.
  const admin = (await db.query("SELECT id FROM users WHERE role = 'admin' AND is_active LIMIT 1")).rows[0];
  const resident = (await db.query("SELECT id FROM users WHERE role = 'resident' AND is_active LIMIT 1")).rows[0];
  const unit = (await db.query('SELECT id FROM units ORDER BY id LIMIT 1')).rows[0];
  if (!admin || !resident || !unit) throw new Error('No demo data found. Run "npm run db:seed" first.');

  const server = createApp().listen(0);
  const base = `http://localhost:${server.address().port}`;

  const actions = [
    { name: 'Open the bills page', path: '/bills.html', userId: admin.id },
    { name: 'Open the dashboard page', path: '/dashboard.html', userId: admin.id },
    { name: 'Load all bills (admin)', path: '/api/v1/bills', userId: admin.id },
    { name: 'Load my bills (resident)', path: '/api/v1/bills', userId: resident.id },
    { name: 'Load payments', path: '/api/v1/payments', userId: admin.id },
    { name: 'Billing report', path: '/api/v1/billing/report', userId: admin.id },
    { name: 'Dashboard numbers', path: '/api/v1/dashboard', userId: admin.id },
    { name: 'Search "ra" (NFR-11)', path: '/api/v1/dashboard/search?q=ra', userId: admin.id },
    { name: 'Search unit "1A" (NFR-11)', path: '/api/v1/dashboard/search?q=1A', userId: admin.id },
  ];

  const results = [];
  try {
    for (const action of actions) {
      const times = [];
      for (let i = 0; i < RUNS; i += 1) times.push(await timeRequest(base, action));
      results.push({ name: action.name, times });
    }

    // Saving a record: create a bill for a far-away month, then delete it again.
    const times = [];
    for (let i = 0; i < RUNS; i += 1) {
      const body = {
        unitId: Number(unit.id), billType: 'other', month: `2099-${String(i + 1).padStart(2, '0')}`,
        dueDate: '2099-12-31', amount: 100, description: 'Speed check (deleted afterwards)',
      };
      times.push(await timeRequest(base, { path: '/api/v1/bills', userId: admin.id, method: 'POST', body }));
    }
    results.push({ name: 'Save a new bill', times });
  } finally {
    // Remove the test bills, whatever happened above.
    await db.query(`DELETE FROM bill_charges WHERE bill_id IN (SELECT id FROM bills WHERE bill_month >= '2099-01-01')`);
    await db.query(`DELETE FROM bills WHERE bill_month >= '2099-01-01'`);
    server.close();
  }

  // Print the results as a table.
  let allFast = true;
  const rows = results.map(({ name, times }) => {
    const average = times.reduce((a, b) => a + b, 0) / times.length;
    const slowest = Math.max(...times);
    const ok = slowest < LIMIT_MS;
    if (!ok) allFast = false;
    return { Action: name, 'Average (ms)': Math.round(average), 'Slowest (ms)': Math.round(slowest), 'Under 3 s?': ok ? 'yes' : 'NO' };
  });
  console.table(rows);
  console.log(allFast ? 'All actions answered within 3 seconds (NFR-10, NFR-11).' : 'Some actions were slower than 3 seconds.');
  return allFast;
}

main()
  .then((allFast) => { process.exitCode = allFast ? 0 : 1; })
  .catch((err) => {
    console.error(`Speed check failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
