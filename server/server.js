'use strict';
/** Entry point: starts the HTTP server (`npm start`). */
const config = require('./config');
const { createApp } = require('./app');
const { pool } = require('./db/pool');

const server = createApp().listen(config.port, () => {
  console.log(`Apartment Management running at http://localhost:${config.port} (${config.env})`);
});

// Close the database pool cleanly on Ctrl+C or when the host stops the app.
function shutdown() {
  server.close(() => pool.end().finally(() => process.exit(0)));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
