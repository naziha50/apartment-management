'use strict';
/**
 * Central configuration. Every value comes from the environment (.env), so the
 * same code runs on Windows, macOS and Linux (NFR-27) without edits.
 */
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const int = (name, fallback) => {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
};

module.exports = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  port: int('PORT', 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://localhost:5432/apartment_maintenance',
  timezone: 'Asia/Dhaka', // all dates and times in the SRS are Bangladesh time (§2.6)
});
