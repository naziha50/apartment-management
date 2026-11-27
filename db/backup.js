'use strict';
/**
 * NFR-09: makes a backup copy of the whole database.
 *
 *   npm run db:backup
 *
 * Saves a file like backups/backup-2026-11-28-1530.sql using PostgreSQL's own
 * backup tool, pg_dump. The backups/ folder is git-ignored (it holds real data).
 *
 * To restore a backup into an empty database:
 *   psql "<DATABASE_URL>" -f backups/backup-2026-11-28-1530.sql
 *
 * For regular backups, run this command on a schedule, for example every night
 * with Windows Task Scheduler or cron.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const config = require('../server/config');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');

/** Finds pg_dump: first on the PATH, then in the usual Windows install folder. */
function findPgDump() {
  try {
    execFileSync('pg_dump', ['--version'], { stdio: 'ignore' });
    return 'pg_dump';
  } catch {
    // Not on the PATH. On Windows, look in C:\Program Files\PostgreSQL\<version>\bin.
  }
  const windowsDir = 'C:\\Program Files\\PostgreSQL';
  if (fs.existsSync(windowsDir)) {
    const versions = fs.readdirSync(windowsDir).sort((a, b) => Number(b) - Number(a)); // newest first
    for (const version of versions) {
      const file = path.join(windowsDir, version, 'bin', 'pg_dump.exe');
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

/** Date and time as YYYY-MM-DD-HHMM, used in the file name. */
function timestamp() {
  const now = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
}

function backup() {
  const pgDump = findPgDump();
  if (!pgDump) {
    throw new Error('Could not find pg_dump. Install PostgreSQL or add its bin folder to your PATH.');
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `backup-${timestamp()}.sql`);

  // --clean adds "drop table" lines, so restoring replaces the old tables cleanly.
  execFileSync(pgDump, ['--clean', '--if-exists', '--no-owner', '--file', file, config.databaseUrl], { stdio: 'inherit' });

  const sizeKb = Math.round(fs.statSync(file).size / 1024);
  console.log(`Backup saved: ${path.relative(process.cwd(), file)} (${sizeKb} KB)`);
}

try {
  backup();
} catch (err) {
  console.error(`Backup failed: ${err.message}`);
  process.exit(1);
}
