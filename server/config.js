'use strict';
/**
 * Central configuration. Every value comes from the environment (.env), so the
 * same code runs on Windows, macOS and Linux (NFR-27) without edits.
 */
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
// The app's one time zone. The server process, every database session and the database's
// default all use it (see db/pool.js and db/migrate.js), so no other code names a time zone.
// Not read from .env on purpose: the computer's own zone must never leak in.
const TIME_ZONE = 'Asia/Dhaka';
process.env.TZ = TIME_ZONE;

const int = (name, fallback) => {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
};

module.exports = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  port: int('PORT', 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://localhost:5432/apartment_maintenance',
  timezone: TIME_ZONE,
  // NFR-03: a login session ends after this many minutes without a request.
  sessionIdleMinutes: int('SESSION_IDLE_MINUTES', 30),
  // BR-19: request photos are kept on disk, outside /public.
  uploads: {
    dir: path.resolve(__dirname, '..', process.env.UPLOAD_DIR || './storage/uploads'),
    maxFiles: 3,
    maxBytes: 5 * 1024 * 1024,
  },
});
