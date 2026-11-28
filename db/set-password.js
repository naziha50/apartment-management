'use strict';
/**
 * Sets (or resets) a user's password, for example for a resident the admin
 * has just added (FR-01, FR-03). The password is stored only as a hash (NFR-01).
 *
 *   npm run user:password -- <email or phone> <new password>
 */
const { hashPassword } = require('../server/lib/passwords');
const auth = require('../server/modules/auth/auth.repository');
const db = require('../server/db/pool');

const MIN_LENGTH = 8;

async function main() {
  const [login, password] = process.argv.slice(2);
  if (!login || !password) {
    console.log('Usage: npm run user:password -- <email or phone> <new password>');
    process.exitCode = 1;
    return;
  }
  if (password.length < MIN_LENGTH) {
    console.log(`The password must be at least ${MIN_LENGTH} characters.`);
    process.exitCode = 1;
    return;
  }
  const changed = await auth.setPasswordHash(login, await hashPassword(password));
  console.log(changed ? `Password set for ${login}.` : `No user has the email or phone ${login}.`);
  if (!changed) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('Could not set the password:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
