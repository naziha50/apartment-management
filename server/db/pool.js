'use strict';
/**
 * One shared PostgreSQL connection pool for the whole app.
 *
 * - query(): always pass values as parameters ($1, $2 ...), never build SQL
 *   strings from user input (NFR-04).
 * - withTransaction(): runs several queries all-or-nothing (NFR-14).
 */
const { Pool } = require('pg');
const config = require('../config');

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
