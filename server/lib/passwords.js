'use strict';
/**
 * Password hashing (NFR-01: passwords are stored only in hashed form).
 *
 * Uses scrypt from Node's built-in crypto module, so no extra package is needed.
 * Each password gets its own random salt, so two people with the same password
 * still get different hashes. The stored text looks like:
 *
 *   scrypt$<salt in hex>$<hash in hex>
 */
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64; // bytes of hash

/** Returns the text to store for a new password. */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** True if the password matches the stored text. Anything malformed is simply false. */
async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [method, saltHex, hashHex] = stored.split('$');
  if (method !== 'scrypt' || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  // timingSafeEqual takes the same time whether the first or last byte differs,
  // so the response time does not reveal how close a guess was.
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** SHA-256 of a session token, as hex. Only this is stored, never the token itself. */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** A new random session token (64 hex characters). */
function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { hashPassword, verifyPassword, hashToken, newToken };
