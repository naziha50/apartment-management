'use strict';
/**
 * Builds the Express application. Kept separate from server.js so that tests
 * can start the app on any port without opening the real one.
 *
 *   Browser (HTML/CSS/JS) ──fetch JSON──► /api/v1/* ──SQL──► PostgreSQL
 *
 * Sprint 0: health check, "Viewing as" user switcher (stand-in for login) and
 * the static frontend. The maintenance API is added in Sprint 1.
 */
const path = require('node:path');
const express = require('express');
const db = require('./db/pool');
const { loadCurrentUser } = require('./middleware/current-user');
const { errorHandler, apiNotFound } = require('./middleware/error-handler');
const usersRoutes = require('./modules/users/users.routes');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  // All endpoints live under a versioned prefix so the API can evolve safely.
  const api = express.Router();
  api.use(loadCurrentUser); // sets req.user from the "Viewing as" choice

  api.get('/health', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', database: 'connected' });
    } catch (err) {
      console.error('Health check: database unreachable —', err.message);
      res.status(503).json({ status: 'error', database: 'unreachable' });
    }
  });
  api.use(usersRoutes);

  api.use(apiNotFound);
  app.use('/api/v1', api);

  // HTML, CSS and JS pages.
  app.use(express.static(PUBLIC_DIR));

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
