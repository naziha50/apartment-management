'use strict';
/**
 * Builds the Express application. Kept separate from server.js so that tests
 * can start the app on any port without opening the real one.
 *
 *   Browser (HTML/CSS/JS) ──fetch JSON──► /api/v1/* ──SQL──► PostgreSQL
 *
 * Sprint 0, step 1: only a health check. The maintenance API is added in Sprint 1.
 */
const express = require('express');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  // All endpoints live under a versioned prefix so the API can evolve safely.
  const api = express.Router();
  api.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/v1', api);

  app.get('/', (req, res) => {
    res.type('text').send('Apartment Management — Maintenance module. API health: /api/v1/health');
  });

  return app;
}

module.exports = { createApp };
