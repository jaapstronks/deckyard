/**
 * Storage layer for magic link (passwordless login) functionality.
 * Uses shared secure-tokens utility for token generation/hashing.
 */

import crypto from 'node:crypto';
import { getOrgId } from '../utils/context.js';
import { nowIso, isoAfter, isoBefore, normalizeEmail } from '../utils/normalize.js';
import { generateSecureToken, hashToken, isValidEmail } from '../utils/secure-tokens.js';
import { withDbGuard } from './utils/db-guard.js';

// ============================================================
// CONSTANTS
// ============================================================

const MAGIC_LINK_EXPIRY_MINUTES = 15;
const RATE_LIMIT_PER_EMAIL = 5; // per hour
const RATE_LIMIT_PER_IP = 15; // per hour

// ============================================================
// RATE LIMITING
// ============================================================

/**
 * Check if a magic link request is rate limited by email.
 * @param {string} email - The email address
 * @returns {Promise<boolean>} - True if rate limited
 */
export async function isRateLimitedByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  return withDbGuard(false, async (db) => {
    const oneHourAgo = isoBefore(60 * 60 * 1000);

    const result = await db
      .selectFrom('magic_link_tokens')
      .select(db.fn.count('id').as('count'))
      .where('user_email', '=', normalized)
      .where('created_at', '>=', oneHourAgo)
      .executeTakeFirst();

    return Number(result?.count || 0) >= RATE_LIMIT_PER_EMAIL;
  });
}

/**
 * Check if a magic link request is rate limited by IP.
 * @param {string} ipAddress - The IP address
 * @returns {Promise<boolean>} - True if rate limited
 */
export async function isRateLimitedByIp(ipAddress) {
  if (!ipAddress) return false;

  return withDbGuard(false, async (db) => {
    const oneHourAgo = isoBefore(60 * 60 * 1000);

    const result = await db
      .selectFrom('magic_link_tokens')
      .select(db.fn.count('id').as('count'))
      .where('ip_address', '=', ipAddress)
      .where('created_at', '>=', oneHourAgo)
      .executeTakeFirst();

    return Number(result?.count || 0) >= RATE_LIMIT_PER_IP;
  });
}

// ============================================================
// TOKEN MANAGEMENT
// ============================================================

/**
 * Create a magic link token for a user.
 * @param {string} email - The user's email
 * @param {Object} [info] - Request info
 * @param {string} [info.ipAddress] - Client IP
 * @param {string} [info.userAgent] - Client user agent
 * @returns {Promise<Object>} - Result with raw token (for email) and expiration
 */
export async function createMagicToken(email, info) {
  const normalized = normalizeEmail(email);
  if (!normalized || !isValidEmail(normalized)) {
    return { ok: false, reason: 'invalid_email' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    // Generate token and hash
    const rawToken = generateSecureToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = isoAfter(MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000);

    // Insert token record
    await db
      .insertInto('magic_link_tokens')
      .values({
        user_email: normalized,
        token_hash: tokenHash,
        expires_at: expiresAt,
        ip_address: info?.ipAddress || null,
        user_agent: info?.userAgent || null,
      })
      .execute();

    return {
      ok: true,
      token: rawToken,
      expiresAt,
    };
  });
}

/**
 * Validate a magic link token without consuming it.
 * @param {string} rawToken - The raw token from the URL
 * @returns {Promise<Object>} - Validation result with email
 */
export async function validateMagicToken(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const tokenHash = hashToken(token);

    const row = await db
      .selectFrom('magic_link_tokens')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .where('used_at', 'is', null)
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'invalid' };
    }

    // Check expiration
    if (new Date(row.expires_at) < new Date()) {
      return { ok: false, reason: 'expired' };
    }

    return {
      ok: true,
      email: row.user_email,
      expiresAt: row.expires_at,
    };
  });
}

/**
 * Consume a magic link token and mark it as used.
 * @param {string} rawToken - The raw token from the URL
 * @returns {Promise<Object>} - Result with user email
 */
export async function consumeMagicToken(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const tokenHash = hashToken(token);
    const now = nowIso();

    // Find and mark as used in a single atomic operation
    const row = await db
      .updateTable('magic_link_tokens')
      .set({ used_at: now })
      .where('token_hash', '=', tokenHash)
      .where('used_at', 'is', null)
      .where('expires_at', '>', now)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'invalid_or_expired' };
    }

    return {
      ok: true,
      email: row.user_email,
    };
  });
}

// ============================================================
// USER MANAGEMENT
// ============================================================

/**
 * Get or create a user for magic link login.
 * If user doesn't exist, create them with magic_link auth source.
 * @param {string} email - The user's email
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - User object with session version
 */
export async function getOrCreateMagicLinkUser(email, ctx) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'invalid_email' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const now = nowIso();

    // Check if user exists
    let user = await db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', normalized)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (!user) {
      // Create new user with magic_link auth source
      const inserted = await db
        .insertInto('users')
        .values({
          organization_id: orgId,
          email: normalized,
          auth_source: 'magic_link',
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirst();
      user = inserted;
    }

    // Generate a session version based on updated_at
    const versionSource = user.password_changed_at || user.updated_at || now;
    const v = crypto
      .createHash('sha256')
      .update(String(versionSource))
      .digest('base64url')
      .slice(0, 12);

    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || '',
        role: user.role || 'user',
        v,
      },
    };
  });
}

// ============================================================
// CLEANUP
// ============================================================

/**
 * Cleanup expired magic link tokens.
 * @returns {Promise<number>} - Number of tokens cleaned up
 */
export async function cleanupExpiredTokens() {
  return withDbGuard(0, async (db) => {
    const now = nowIso();

    const result = await db
      .deleteFrom('magic_link_tokens')
      .where('expires_at', '<', now)
      .executeTakeFirst();

    return Number(result.numDeletedRows) || 0;
  });
}