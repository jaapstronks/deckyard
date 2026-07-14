/**
 * Storage layer for token-based share links.
 * Enables external access to presentations without requiring user accounts.
 *
 * This module re-exports all share link functionality from sub-modules.
 */

import crypto from 'node:crypto';
import { nowIso } from '../../utils/normalize.js';
import { withDbGuard } from '../utils/db-guard.js';

// ============================================================
// TOKEN GENERATION
// ============================================================

/**
 * Generate a cryptographically secure share token.
 * Uses 32 bytes (256 bits) of randomness, URL-safe base64 encoded.
 * @returns {string} - 43-character URL-safe token
 */
export function generateShareToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generate a cryptographically secure verification/session token.
 * Uses 32 bytes (256 bits) of randomness, URL-safe base64 encoded.
 * @returns {string} - 43-character URL-safe token
 */
export function generateGuestToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// ============================================================
// PASSWORD HASHING
// ============================================================

/**
 * Hash a password for share link protection.
 * Uses scrypt with a random salt.
 * @param {string} password - The plaintext password
 * @returns {Promise<string>} - The hashed password in format salt:hash
 */
export async function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * Verify a password against a hash.
 * @param {string} password - The plaintext password
 * @param {string} hash - The stored hash in format salt:hash
 * @returns {Promise<boolean>} - True if password matches
 */
export async function verifyPassword(password, hash) {
  return new Promise((resolve, reject) => {
    const [salt, key] = hash.split(':');
    if (!salt || !key) {
      resolve(false);
      return;
    }
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(crypto.timingSafeEqual(Buffer.from(key, 'hex'), derivedKey));
    });
  });
}

// ============================================================
// CLEANUP
// ============================================================

/**
 * Cleanup expired share links (background task).
 * Marks expired links as revoked.
 * @param {Object} ctx - Context object
 * @returns {Promise<number>} - Number of links cleaned up
 */
export async function cleanupExpiredShareLinks(ctx) {
  return withDbGuard(0, async (db) => {
    const now = nowIso();

    const result = await db
      .updateTable('presentation_share_links')
      .set({
        revoked_at: now,
        revoked_by: 'system:expired',
      })
      .where('expires_at', '<=', now)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) || 0;
  });
}

// ============================================================
// RE-EXPORTS
// ============================================================

// CRUD operations
export {
  createShareLink,
  getShareLinkByToken,
  validateShareLink,
  verifyShareLinkAccess,
  listShareLinks,
  updateShareLink,
  revokeShareLink,
  revokeAllShareLinks,
  formatShareLink,
} from './crud.js';

// Access logging
export {
  logShareLinkAccess,
  getShareLinkAccessLog,
} from './access-log.js';

// Guest management
export {
  requestGuestVerification,
  verifyGuestEmail,
  getGuestBySessionToken,
  getGuestByEmail,
  extendGuestSession,
  invalidateGuestSessions,
  preRegisterGuest,
  listGuestsForShareLink,
  removeGuest,
  markInvitationSent,
  formatGuest,
} from './guests.js';