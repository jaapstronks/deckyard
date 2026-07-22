/**
 * Shared password-hashing utility (scrypt).
 *
 * One implementation for every stored password in Deckyard: database user
 * credentials (via storage/password-reset.js) and share-link passwords (via
 * storage/share-links). Previously two byte-identical copies existed; they are
 * unified here.
 *
 * ## Versioned hash format (backward compatible)
 *
 * New hashes are written as:
 *
 *     scrypt$<N>$<r>$<p>$<saltHex>$<keyHex>
 *
 * The `scrypt$` prefix lets verifyPassword() recover the exact cost parameters
 * a hash was produced with, so the work factor can be raised over time without
 * breaking existing hashes. Legacy hashes have no prefix and use the shape:
 *
 *     <saltHex>:<keyHex>
 *
 * These were produced with Node's scrypt defaults (N=16384, r=8, p=1) and are
 * still verified with those parameters. A legacy hash keeps verifying after a
 * cost bump; only newly written hashes get the higher cost.
 *
 * ## Cost
 *
 * New hashes use N=2^17 (131072), r=8, p=1 per the OWASP 2024 scrypt guidance.
 * That raises scrypt's memory footprint to 128*N*r ≈ 128 MiB, which exceeds
 * Node's default 32 MiB `maxmem`, so an explicit maxmem is always supplied.
 *
 * ## DoS bound
 *
 * scrypt cost scales with input, so an unbounded password length is a CPU/memory
 * DoS vector. Passwords longer than MAX_PASSWORD_LENGTH are rejected before any
 * scrypt work runs (hashPassword throws; verifyPassword returns false — no
 * stored hash was ever produced from an over-length password, so it cannot
 * match anyway).
 */

import crypto from 'node:crypto';

// Derived-key length in bytes (unchanged from the legacy implementation, so
// legacy "salt:hash" values round-trip).
export const KEY_LENGTH = 64;

// Current cost parameters for newly written hashes (OWASP 2024: N=2^17).
export const SCRYPT_PARAMS = { N: 131072, r: 8, p: 1 };

// Node's historical scrypt defaults — the parameters legacy "salt:hash" values
// were produced with, and the ones we must verify them against.
export const LEGACY_PARAMS = { N: 16384, r: 8, p: 1 };

// Upper bound on password length. With expensive scrypt an unbounded length is
// a denial-of-service vector; 1024 is far above any legitimate passphrase.
export const MAX_PASSWORD_LENGTH = 1024;

const VERSION_PREFIX = 'scrypt$';

/**
 * Build the scrypt options object, sizing maxmem so scrypt never throws.
 * Node enforces `128 * N * r <= maxmem`; we allow 2x headroom above a 32 MiB
 * floor. This is a ceiling, not a reservation — actual use stays ~128*N*r.
 * @param {{N: number, r: number, p: number}} params
 * @returns {crypto.ScryptOptions}
 */
function scryptOptions({ N, r, p }) {
  const maxmem = Math.max(32 * 1024 * 1024, 128 * N * r * 2);
  return { cost: N, blockSize: r, parallelization: p, maxmem };
}

/**
 * Derive a key and timing-safe compare it against a stored hex hash.
 * @param {string} password
 * @param {string} salt - hex salt
 * @param {string} keyHex - stored derived key, hex
 * @param {{N: number, r: number, p: number}} params
 * @returns {Promise<boolean>}
 */
function scryptCompare(password, salt, keyHex, params) {
  return new Promise((resolve) => {
    const expected = Buffer.from(keyHex, 'hex');
    // Derive to the stored key's length so timingSafeEqual sees equal-size
    // buffers when the password is correct; a malformed hex length just fails.
    const keyLen = expected.length || KEY_LENGTH;
    crypto.scrypt(password, salt, keyLen, scryptOptions(params), (err, derivedKey) => {
      if (err) {
        resolve(false);
        return;
      }
      try {
        resolve(crypto.timingSafeEqual(expected, derivedKey));
      } catch {
        resolve(false);
      }
    });
  });
}

/**
 * Hash a password using scrypt at the current cost, returning a versioned hash.
 * @param {string} password - The plaintext password
 * @returns {Promise<string>} - `scrypt$N$r$p$salt$hash`
 */
export function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const pw = String(password ?? '');
    if (pw.length > MAX_PASSWORD_LENGTH) {
      reject(new Error('Password exceeds maximum length'));
      return;
    }
    const { N, r, p } = SCRYPT_PARAMS;
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(pw, salt, KEY_LENGTH, scryptOptions(SCRYPT_PARAMS), (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(`${VERSION_PREFIX}${N}$${r}$${p}$${salt}$${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * Verify a password against a stored hash (versioned or legacy) using a
 * timing-safe comparison.
 * @param {string} password - The plaintext password
 * @param {string} stored - The stored hash (`scrypt$...` or legacy `salt:hash`)
 * @returns {Promise<boolean>} - True if password matches
 */
export function verifyPassword(password, stored) {
  const pw = String(password ?? '');
  // An over-length password can never match a stored hash and would only burn
  // CPU; reject it before any scrypt work.
  if (pw.length > MAX_PASSWORD_LENGTH) return Promise.resolve(false);

  const s = String(stored || '');
  if (!s) return Promise.resolve(false);

  if (s.startsWith(VERSION_PREFIX)) {
    // scrypt$N$r$p$salt$hash
    const parts = s.split('$');
    if (parts.length !== 6) return Promise.resolve(false);
    const [, nStr, rStr, pStr, salt, keyHex] = parts;
    const N = Number(nStr);
    const r = Number(rStr);
    const p = Number(pStr);
    if (
      !Number.isInteger(N) ||
      !Number.isInteger(r) ||
      !Number.isInteger(p) ||
      N < 2 ||
      r < 1 ||
      p < 1 ||
      !salt ||
      !keyHex
    ) {
      return Promise.resolve(false);
    }
    return scryptCompare(pw, salt, keyHex, { N, r, p });
  }

  // Legacy "salt:hash" — Node scrypt defaults.
  const [salt, keyHex] = s.split(':');
  if (!salt || !keyHex) return Promise.resolve(false);
  return scryptCompare(pw, salt, keyHex, LEGACY_PARAMS);
}

/**
 * Whether a stored hash was produced below the current cost and would benefit
 * from re-hashing on next successful login. Kept as a pure helper; callers may
 * opt to transparently upgrade, but must not do so in a way that rotates the
 * session-invalidation version (which would log the user out).
 * @param {string} stored
 * @returns {boolean}
 */
export function needsRehash(stored) {
  const s = String(stored || '');
  if (!s.startsWith(VERSION_PREFIX)) return true; // legacy hash
  const parts = s.split('$');
  if (parts.length !== 6) return true;
  const N = Number(parts[1]);
  return !Number.isInteger(N) || N < SCRYPT_PARAMS.N;
}
