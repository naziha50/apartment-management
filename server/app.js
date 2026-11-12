'use strict';
/**
 * Builds the Express application. Kept separate from server.js so that tests
 * can start the app on any port without opening the real one.
 *
 *   Browser (HTML/CSS/JS) ──fetch JSON──► /api/v1/* ──SQL──► PostgreSQL
 *
 * So far: health check, "Viewing as" user switcher (stand-in for login),
 * security headers, the static frontend and the maintenance API.
 */
const path = require('node:path');
const express = require('express');
const db = require('./db/pool');
const { loadCurrentUser } = require('./middleware/current-user');
const { errorHandler, apiNotFound } = require('./middleware/error-handler');
const { securityHeaders, noStore } = require('./middleware/security');
const usersRoutes = require('./modules/users/users.routes');
const maintenanceRoutes = require('./modules/maintenance/maintenance.routes');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

// Browser builds of the animation libraries, served from node_modules so the
// pages need no CDN (the security policy only allows scripts from this server).
const VENDOR_FILES = {
  'motion.js': path.join(ROOT, 'node_modules', 'motion', 'dist', 'motion.js'),
  'anime.esm.min.js': path.join(ROOT, 'node_modules', 'animejs', 'dist', 'bundles', 'anime.esm.min.js'),
};

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.json({ limit: '100kb' }));

  // All endpoints live under a versioned prefix so the API can evolve safely.
  const api = express.Router();
  api.use(noStore);
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
  api.use('/maintenance', maintenanceRoutes);

  api.use(apiNotFound);
  app.use('/api/v1', api);

  app.get('/vendor/:file', (req, res, next) => {
    const file = VENDOR_FILES[req.params.file];
    if (!file) return next();
    res.set('Cache-Control', 'public, max-age=86400');
    return res.sendFile(file);
  });

  // HTML, CSS and JS pages.
  app.use(express.static(PUBLIC_DIR));

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
