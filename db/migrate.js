'use strict';
/**
 * Database migration runner.
 *
 *   npm run db:migrate   apply every migration that has not run yet
 *   npm run db:reset     DEV ONLY: drop all tables, then apply every migration again
 *
 * A migration is a numbered .sql file in db/migrations (001_create_users.sql, ...).
 * Each one runs exactly once, in name order, inside its own transaction: it is
 * either applied completely or not at all (NFR-14). Applied files are recorded
 * in the schema_migrations table.
 */
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const FILE_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  const sqlFiles = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  const badNames = sqlFiles.filter((f) => !FILE_PATTERN.test(f));
  if (badNames.length) {
    throw new Error(`Migration file names must look like 001_create_users.sql. Rename: ${badNames.join(', ')}`);
  }
  return sqlFiles.sort();
}

async function migrate({ databaseUrl, reset = false, log = console.log } = {}) {
  const config = require('../server/config');
  if (reset && config.env === 'production') {
    throw new Error('Refusing to reset the database while NODE_ENV=production.');
  }

  const client = new Client({ connectionString: databaseUrl || config.databaseUrl });
  await client.connect();
  try {
    if (reset) {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      log('Database reset: all tables dropped.');
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));

    const pending = listMigrationFiles().filter((f) => !applied.has(f));
    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        log(`Applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed and was rolled back: ${err.message}`);
      }
    }
    return { applied: pending };
  } finally {
    await client.end();
  }
}

module.exports = { migrate, listMigrationFiles };

if (require.main === module) {
  migrate({ reset: process.argv.includes('--reset') })
    .then(({ applied }) => console.log(applied.length ? `Done: ${applied.length} migration(s) applied.` : 'Database is up to date.'))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
