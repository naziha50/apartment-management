'use strict';
/** Entry point: starts the HTTP server (`npm start`). */
const config = require('./config');
const { createApp } = require('./app');
const { pool } = require('./db/pool');

const maintenance = require('./modules/maintenance/maintenance.service');
const scheduledTasks = require('./modules/maintenance/scheduled-tasks.service');

const server = createApp().listen(config.port, () => {
  console.log(`Apartment Management running at http://localhost:${config.port} (${config.env})`);
});

// Hourly jobs, once at start-up (catches what came due while the server was off), then every hour:
// - BR-18: close resolved requests nobody reopened in time;
// - BR-25: create the requests for scheduled tasks due within 7 days.
// Both are safe with several server processes: the database does each one only once
// (see autoCloseResolved and scheduled-tasks lockNextDue). One failing does not stop the other.
const HOURLY_MS = 60 * 60 * 1000;
async function hourlyJobs() {
  try {
    const closed = await maintenance.autoCloseResolved();
    if (closed) console.log(`Auto-closed ${closed} resolved request(s) (BR-18).`);
  } catch (err) {
    console.error('Auto-close failed; trying again in an hour:', err.message);
  }
  try {
    const created = await scheduledTasks.createDueRequests();
    if (created) console.log(`Created ${created} request(s) from scheduled tasks (BR-25).`);
  } catch (err) {
    console.error('Scheduled tasks failed; trying again in an hour:', err.message);
  }
}
hourlyJobs();
const hourlyTimer = setInterval(hourlyJobs, HOURLY_MS);
hourlyTimer.unref();

// Graceful stop on Ctrl+C or when the host stops the app: no new connections,
// requests already running may finish, then the database pool is closed.
// Browsers open spare connections without sending anything on them, and
// server.close() would wait for those forever, so after a short grace period
// every remaining connection is closed. A last-resort timer guarantees exit.
const GRACE_MS = 5000;
const FORCE_EXIT_MS = 10000;
let stopping = false;

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, shutting down…`);
  clearInterval(hourlyTimer);
  server.close(() => pool.end().finally(() => process.exit(0)));
  server.closeIdleConnections();
  setTimeout(() => server.closeAllConnections(), GRACE_MS).unref();
  setTimeout(() => {
    console.error('Shutdown took too long; exiting anyway.');
    process.exit(1);
  }, FORCE_EXIT_MS).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
