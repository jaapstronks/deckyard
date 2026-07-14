/**
 * Storage layer for password reset functionality.
 * Handles token generation, validation, rate limiting, and user password management.
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

const TOKEN_EXPIRY_HOURS = 1;
const RATE_LIMIT_PER_EMAIL = 3; // per hour
const RATE_LIMIT_PER_IP = 10; // per hour
const MIN_PASSWORD_LENGTH = 8;

// ============================================================
// PASSWORD HASHING
// ============================================================

/**
 * Hash a password using scrypt with a random salt.
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
 * Verify a password against a stored hash using timing-safe comparison.
 * @param {string} password - The plaintext password
 * @param {string} hash - The stored hash in format salt:hash
 * @returns {Promise<boolean>} - True if password matches
 */
export async function verifyPassword(password, hash) {
  return new Promise((resolve, reject) => {
    const [salt, key] = String(hash || '').split(':');
    if (!salt || !key) {
      resolve(false);
      return;
    }
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      try {
        resolve(crypto.timingSafeEqual(Buffer.from(key, 'hex'), derivedKey));
      } catch {
        resolve(false);
      }
    });
  });
}

/**
 * Validate password meets minimum requirements.
 * @param {string} password - The password to validate
 * @returns {{ok: boolean, reason?: string}} - Validation result
 */
export function validatePassword(password) {
  const pw = String(password || '');
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: 'too_short' };
  }
  return { ok: true };
}

// ============================================================
// RATE LIMITING
// ============================================================

/**
 * Check if a password reset request is rate limited by email.
 * @param {string} email - The email address
 * @returns {Promise<boolean>} - True if rate limited
 */
export async function isRateLimitedByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  return withDbGuard(false, async (db) => {
    const oneHourAgo = isoBefore(60 * 60 * 1000);

    const result = await db
      .selectFrom('password_reset_tokens')
      .select(db.fn.count('id').as('count'))
      .where('user_email', '=', normalized)
      .where('created_at', '>=', oneHourAgo)
      .executeTakeFirst();

    return Number(result?.count || 0) >= RATE_LIMIT_PER_EMAIL;
  });
}

/**
 * Check if a password reset request is rate limited by IP.
 * @param {string} ipAddress - The IP address
 * @returns {Promise<boolean>} - True if rate limited
 */
export async function isRateLimitedByIp(ipAddress) {
  if (!ipAddress) return false;

  return withDbGuard(false, async (db) => {
    const oneHourAgo = isoBefore(60 * 60 * 1000);

    const result = await db
      .selectFrom('password_reset_tokens')
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
 * Create a password reset token for a user.
 * @param {string} email - The user's email
 * @param {Object} [info] - Request info
 * @param {string} [info.ipAddress] - Client IP
 * @param {string} [info.userAgent] - Client user agent
 * @returns {Promise<Object>} - Result with raw token (for email) and expiration
 */
export async function createResetToken(email, info) {
  const normalized = normalizeEmail(email);
  if (!normalized || !isValidEmail(normalized)) {
    return { ok: false, reason: 'invalid_email' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    // Generate token and hash
    const rawToken = generateSecureToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = isoAfter(TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    // Insert token record
    await db
      .insertInto('password_reset_tokens')
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
 * Validate a password reset token without consuming it.
 * @param {string} rawToken - The raw token from the URL
 * @returns {Promise<Object>} - Validation result with masked email
 */
export async function validateResetToken(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const tokenHash = hashToken(token);

    const row = await db
      .selectFrom('password_reset_tokens')
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

    // Mask email for display (show first 2 chars, then ***, then domain)
    const email = row.user_email;
    const [localPart, domain] = email.split('@');
    const maskedLocal = localPart.length > 2
      ? localPart.slice(0, 2) + '***'
      : '***';
    const maskedEmail = `${maskedLocal}@${domain}`;

    return {
      ok: true,
      email: row.user_email,
      maskedEmail,
      expiresAt: row.expires_at,
    };
  });
}

/**
 * Consume a password reset token and mark it as used.
 * @param {string} rawToken - The raw token from the URL
 * @returns {Promise<Object>} - Result with user email
 */
export async function consumeResetToken(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const tokenHash = hashToken(token);
    const now = nowIso();

    // Find and mark as used in a single atomic operation
    const row = await db
      .updateTable('password_reset_tokens')
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
// USER PASSWORD MANAGEMENT
// ============================================================

/**
 * Get a database user by email (with password hash).
 * @param {string} email - The user's email
 * @param {Object} ctx - Context object
 * @returns {Promise<Object|null>} - User record or null
 */
export async function getDatabaseUser(email, ctx) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', normalized)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    return row || null;
  });
}

/**
 * Check if a user exists in the database with a password hash.
 * @param {string} email - The user's email
 * @param {Object} ctx - Context object
 * @returns {Promise<boolean>} - True if user has database credentials
 */
export async function hasDatabaseCredentials(email, ctx) {
  const user = await getDatabaseUser(email, ctx);
  return !!(user?.password_hash && user?.auth_source === 'database');
}

/**
 * Create or update a user with database credentials.
 * Used when an ENV user migrates to database auth or sets a new password.
 * @param {string} email - The user's email
 * @param {string} password - The new password
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result
 */
export async function setUserPassword(email, password, ctx) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'invalid_email' };
  }

  const validation = validatePassword(password);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const passwordHash = await hashPassword(password);
    const now = nowIso();

    // Check if user exists
    const existingUser = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', normalized)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (existingUser) {
      // Update existing user
      await db
        .updateTable('users')
        .set({
          password_hash: passwordHash,
          password_changed_at: now,
          auth_source: 'database',
          updated_at: now,
        })
        .where('id', '=', existingUser.id)
        .execute();
    } else {
      // Create new user
      await db
        .insertInto('users')
        .values({
          organization_id: orgId,
          email: normalized,
          password_hash: passwordHash,
          password_changed_at: now,
          auth_source: 'database',
          created_at: now,
          updated_at: now,
        })
        .execute();
    }

    return { ok: true };
  });
}

/**
 * Verify a user's current password.
 * @param {string} email - The user's email
 * @param {string} password - The password to verify
 * @param {Object} ctx - Context object
 * @returns {Promise<boolean>} - True if password is correct
 */
export async function verifyUserPassword(email, password, ctx) {
  const user = await getDatabaseUser(email, ctx);
  if (!user?.password_hash) return false;

  return verifyPassword(password, user.password_hash);
}

/**
 * Get the timestamp when a user's password was last changed.
 * Used for session invalidation checks.
 * @param {string} email - The user's email
 * @param {Object} ctx - Context object
 * @returns {Promise<Date|null>} - Password changed timestamp or null
 */
export async function getPasswordChangedAt(email, ctx) {
  const user = await getDatabaseUser(email, ctx);
  if (!user?.password_changed_at) return null;
  return new Date(user.password_changed_at);
}

// ============================================================
// AUDIT LOGGING
// ============================================================

/**
 * Log an authentication-related event.
 * @param {Object} event - Event details
 * @param {string} event.type - Event type (login, logout, password_reset_request, etc.)
 * @param {string} [event.email] - User email
 * @param {boolean} [event.success] - Whether the event was successful
 * @param {string} [event.ipAddress] - Client IP
 * @param {string} [event.userAgent] - Client user agent
 * @param {Object} [event.metadata] - Additional metadata
 * @returns {Promise<void>}
 */
export async function logAuthEvent(event) {
  return withDbGuard(undefined, async (db) => {
    await db
      .insertInto('auth_audit_log')
      .values({
        user_email: event.email || null,
        event_type: event.type,
        success: event.success ?? false,
        ip_address: event.ipAddress || null,
        user_agent: event.userAgent || null,
        metadata: event.metadata || {},
      })
      .execute();
  });
}

// ============================================================
// CLEANUP
// ============================================================

/**
 * Cleanup expired password reset tokens.
 * Should be run periodically as a background task.
 * @returns {Promise<number>} - Number of tokens cleaned up
 */
export async function cleanupExpiredTokens() {
  return withDbGuard(0, async (db) => {
    const now = nowIso();

    const result = await db
      .deleteFrom('password_reset_tokens')
      .where('expires_at', '<', now)
      .executeTakeFirst();

    return Number(result.numDeletedRows) || 0;
  });
}

/**
 * Cleanup old audit log entries (older than 90 days).
 * @returns {Promise<number>} - Number of entries cleaned up
 */
export async function cleanupOldAuditLogs() {
  return withDbGuard(0, async (db) => {
    const ninetyDaysAgo = isoBefore(90 * 24 * 60 * 60 * 1000);

    const result = await db
      .deleteFrom('auth_audit_log')
      .where('created_at', '<', ninetyDaysAgo)
      .executeTakeFirst();

    return Number(result.numDeletedRows) || 0;
  });
}