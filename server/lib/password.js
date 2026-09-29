/**
 * Password hashing for customer accounts.
 *
 * Node's built-in scrypt, deliberately: bcrypt/argon2 are native modules and
 * this image builds on Railway from a plain Dockerfile — a new native
 * dependency is a new way for the deploy to fail. scrypt is memory-hard, ships
 * with Node, and needs no build step.
 *
 * Stored format:  scrypt$N$r$p$<salt base64>$<hash base64>
 * The parameters live inside the string so they can be raised later without
 * invalidating existing passwords.
 */
const crypto = require('node:crypto');

const N = 16384;      // CPU/memory cost
const R = 8;          // block size
const P = 1;          // parallelisation
const KEYLEN = 64;
const SALT_BYTES = 16;

const MIN_LENGTH = 8;
const MAX_LENGTH = 200;   // scrypt on a megabyte of "password" is a free DoS

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SALT_BYTES);
    crypto.scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (err, derived) => {
      if (err) return reject(err);
      resolve(`scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${derived.toString('base64')}`);
    });
  });
}

/** Constant-time check. Returns false for anything unparseable rather than throwing. */
function verifyPassword(password, stored) {
  return new Promise((resolve) => {
    if (typeof stored !== 'string') return resolve(false);
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return resolve(false);
    const n = Number.parseInt(parts[1], 10);
    const r = Number.parseInt(parts[2], 10);
    const p = Number.parseInt(parts[3], 10);
    let salt;
    let expected;
    try {
      salt = Buffer.from(parts[4], 'base64');
      expected = Buffer.from(parts[5], 'base64');
    } catch (e) {
      return resolve(false);
    }
    if (!n || !r || !p || !salt.length || !expected.length) return resolve(false);
    crypto.scrypt(password, salt, expected.length, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, derived) => {
      if (err) return resolve(false);
      resolve(crypto.timingSafeEqual(derived, expected));
    });
  });
}

/**
 * What we refuse, and why each rule exists rather than being decoration:
 *  - under 8 characters is guessable offline in minutes
 *  - over 200 characters is a way to make the server do scrypt work for free
 *  - a password identical to the email address is the most common reuse
 */
function validatePassword(password, email) {
  const value = typeof password === 'string' ? password : '';
  if (value.length < MIN_LENGTH) return `Password must be at least ${MIN_LENGTH} characters`;
  if (value.length > MAX_LENGTH) return 'Password is too long';
  if (email && value.trim().toLowerCase() === String(email).trim().toLowerCase()) {
    return 'Password cannot be your email address';
  }
  return null;
}

module.exports = { hashPassword, verifyPassword, validatePassword, MIN_LENGTH };
