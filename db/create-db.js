'use strict';
/**
 * Creates the database named in DATABASE_URL if it does not exist yet.
 * Works on every OS, so nobody needs the `createdb` command (NFR-27).
 *
 *   npm run db:create
 */
const { Client } = require('pg');

async function createDatabase(databaseUrl) {
  const url = new URL(databaseUrl || require('../server/config').databaseUrl);
  const dbName = url.pathname.replace(/^\//, '');
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) throw new Error(`Unsafe database name: ${dbName}`);

  url.pathname = '/postgres'; // connect to the default database to create ours
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rowCount > 0) return { created: false, dbName };
    await client.query(`CREATE DATABASE ${dbName} ENCODING 'UTF8'`);
    return { created: true, dbName };
  } finally {
    await client.end();
  }
}

module.exports = { createDatabase };

if (require.main === module) {
  createDatabase()
    .then(({ created, dbName }) => console.log(created ? `Created database ${dbName}.` : `Database ${dbName} already exists.`))
    .catch((err) => {
      console.error(`Could not create the database: ${err.message}`);
      console.error('Check DATABASE_URL in .env and that PostgreSQL is running.');
      process.exit(1);
    });
}
