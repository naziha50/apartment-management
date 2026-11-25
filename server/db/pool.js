'use strict';
/**
 * One shared PostgreSQL connection pool for the whole app.
 *
 * - query(): always pass values as parameters ($1, $2 ...), never build SQL
 *   strings from user input (NFR-04).
 * - withTransaction(): runs several queries all-or-nothing (NFR-14).
 */
const { Pool, types } = require('pg');
const config = require('../config');
const { toIso } = require('../lib/dates');

// DATE columns (e.g. a task's due date) stay 'YYYY-MM-DD' text: a calendar day, not a moment.
// 1082 is PostgreSQL's DATE type.
types.setTypeParser(1082, (value) => value);

// TIMESTAMPTZ columns (created_at, submitted_at …) become ISO text with the time zone's offset,
// which is what the API sends. Code that does arithmetic wraps them in new Date() first.
// 1184 is PostgreSQL's TIMESTAMPTZ type; its default parser reads PostgreSQL's text format.
const parseTimestamp = types.getTypeParser(1184);
types.setTypeParser(1184, (value) => toIso(parseTimestamp(value)));

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  options: `-c timezone=${config.timezone}`,
});

function query(text, params) {
  return pool.query(text, params);
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
