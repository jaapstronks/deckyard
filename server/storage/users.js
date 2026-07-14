/**
 * Storage layer for user management.
 * Handles CRUD operations for database users and invitation flows.
 */

import { getOrgId } from '../utils/context.js';
import { nowIso, isoAfter, normalizeEmail } from '../utils/normalize.js';
import { withDbGuard } from './utils/db-guard.js';
import { generateSecureToken, hashToken } from '../utils/secure-tokens.js';
import { hashPassword } from './password-reset.js';

// ============================================================
// USER CRUD
// ============================================================

/**
 * List all users in the organization with status information.
 * @param {Object} ctx - Context object
 * @returns {Promise<Array>} - List of users with status fields
 */
export async function listUsers(ctx) {
  return withDbGuard([], async (db) => {
    const orgId = getOrgId(ctx);

    const rows = await db
      .selectFrom('users')
      .select([
        'id',
        'email',
        'name',
        'role',
        'auth_source',
        'password_hash',
        'created_at',
        'updated_at',
      ])
      .where('organization_id', '=', orgId)
      .orderBy('created_at', 'desc')
      .execute();

    // Fetch last login times for all users (successful logins only)
    // Include both password logins and magic link logins
    const loginEvents = await db
      .selectFrom('auth_audit_log')
      .select(['user_email', 'created_at'])
      .where((eb) =>
        eb.or([
          eb('event_type', '=', 'login'),
          eb('event_type', '=', 'magic_link_login'),
        ])
      )
      .where('success', '=', true)
      .orderBy('created_at', 'desc')
      .execute();

    // Build a map of email -> last login time
    const lastLoginMap = new Map();
    for (const event of loginEvents) {
      if (!lastLoginMap.has(event.user_email)) {
        lastLoginMap.set(event.user_email, event.created_at);
      }
    }

    // Fetch active invitation tokens (unused and not expired)
    const now = nowIso();
    const invitationTokens = await db
      .selectFrom('password_reset_tokens')
      .select(['user_email', 'expires_at'])
      .where('used_at', 'is', null)
      .orderBy('expires_at', 'desc')
      .execute();

    // Build a map of email -> invitation expiry
    const invitationMap = new Map();
    for (const token of invitationTokens) {
      if (!invitationMap.has(token.user_email)) {
        invitationMap.set(token.user_email, token.expires_at);
      }
    }

    return rows.map((row) => formatUserWithStatus(row, lastLoginMap, invitationMap, now));
  });
}

/**
 * Get a user by ID.
 * @param {string} userId - The user ID
 * @param {Object} ctx - Context object
 * @returns {Promise<Object|null>} - User object or null
 */
export async function getUserById(userId, ctx) {
  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .selectFrom('users')
      .select([
        'id',
        'email',
        'name',
        'role',
        'auth_source',
        'created_at',
        'updated_at',
      ])
      .where('id', '=', userId)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    return row ? formatUser(row) : null;
  });
}

/**
 * Get a user by email.
 * @param {string} email - The user's email
 * @param {Object} ctx - Context object
 * @returns {Promise<Object|null>} - User object or null
 */
export async function getUserByEmail(email, ctx) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .selectFrom('users')
      .select([
        'id',
        'email',
        'name',
        'role',
        'auth_source',
        'created_at',
        'updated_at',
      ])
      .where('email', '=', normalized)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    return row ? formatUser(row) : null;
  });
}

/**
 * Create a new user.
 * @param {Object} userData - User data
 * @param {string} userData.email - User's email
 * @param {string} [userData.name] - User's name
 * @param {string} [userData.role] - User's role (user/admin)
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result with user and invitation token
 */
export async function createUser(userData, ctx) {
  const email = normalizeEmail(userData?.email);
  if (!email || !email.includes('@')) {
    return { ok: false, reason: 'invalid_email' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    // Check if user already exists
    const existing = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', email)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (existing) {
      return { ok: false, reason: 'already_exists' };
    }

    const now = nowIso();
    const role = userData?.role === 'admin' ? 'admin' : 'user';

    // Create user without password (will be set via invitation)
    const row = await db
      .insertInto('users')
      .values({
        organization_id: orgId,
        email,
        name: userData?.name || null,
        role,
        auth_source: 'database',
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirst();

    // Generate invitation token (same as password reset token)
    const invitationToken = generateSecureToken();
    const tokenHash = hashToken(invitationToken);
    const expiresAt = isoAfter(7 * 24 * 60 * 60 * 1000); // 7 days

    // Store invitation token in password_reset_tokens
    await db
      .insertInto('password_reset_tokens')
      .values({
        user_email: email,
        token_hash: tokenHash,
        expires_at: expiresAt,
      })
      .execute();

    return {
      ok: true,
      user: formatUser(row),
      invitationToken,
      invitationExpiresAt: expiresAt,
    };
  });
}

/**
 * Update a user.
 * @param {string} userId - The user ID
 * @param {Object} updates - Fields to update
 * @param {string} [updates.name] - User's name
 * @param {string} [updates.role] - User's role
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Update result
 */
export async function updateUser(userId, updates, ctx) {
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    const updateData = {
      updated_at: nowIso(),
    };

    if ('name' in updates) {
      updateData.name = updates.name || null;
    }

    if ('role' in updates) {
      updateData.role = updates.role === 'admin' ? 'admin' : 'user';
    }

    const row = await db
      .updateTable('users')
      .set(updateData)
      .where('id', '=', userId)
      .where('organization_id', '=', orgId)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    return {
      ok: true,
      user: formatUser(row),
    };
  });
}

/**
 * Delete a user.
 * @param {string} userId - The user ID
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Delete result
 */
export async function deleteUser(userId, ctx) {
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    // Get user email before deleting (for audit)
    const user = await db
      .selectFrom('users')
      .select(['email'])
      .where('id', '=', userId)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (!user) {
      return { ok: false, reason: 'not_found' };
    }

    // Delete any pending reset tokens
    await db
      .deleteFrom('password_reset_tokens')
      .where('user_email', '=', user.email)
      .execute();

    // Delete the user
    await db
      .deleteFrom('users')
      .where('id', '=', userId)
      .where('organization_id', '=', orgId)
      .execute();

    return { ok: true };
  });
}

/**
 * Resend invitation email for a user.
 * @param {string} userId - The user ID
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result with new invitation token
 */
export async function resendInvitation(userId, ctx) {
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    // Get the user
    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'password_hash'])
      .where('id', '=', userId)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (!user) {
      return { ok: false, reason: 'not_found' };
    }

    // Only allow resending if user hasn't set a password yet
    if (user.password_hash) {
      return { ok: false, reason: 'already_activated' };
    }

    // Delete existing tokens for this user
    await db
      .deleteFrom('password_reset_tokens')
      .where('user_email', '=', user.email)
      .execute();

    // Generate new invitation token
    const invitationToken = generateSecureToken();
    const tokenHash = hashToken(invitationToken);
    const expiresAt = isoAfter(7 * 24 * 60 * 60 * 1000); // 7 days

    await db
      .insertInto('password_reset_tokens')
      .values({
        user_email: user.email,
        token_hash: tokenHash,
        expires_at: expiresAt,
      })
      .execute();

    return {
      ok: true,
      invitationToken,
      invitationExpiresAt: expiresAt,
    };
  });
}

// ============================================================
// SEARCH
// ============================================================

/**
 * Search users by email or name (case-insensitive partial match).
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {number} [options.limit=10] - Maximum results
 * @param {string[]} [options.exclude=[]] - Email addresses to exclude
 * @param {Object} ctx - Context object
 * @returns {Promise<Array>} - List of matching users
 */
export async function searchUsers(query, options = {}, ctx) {
  const searchTerm = String(query || '').toLowerCase().trim();
  if (!searchTerm) return [];

  return withDbGuard([], async (db) => {
    const orgId = getOrgId(ctx);
    const limit = Math.min(Math.max(1, options.limit || 10), 50);
    const exclude = Array.isArray(options.exclude) ? options.exclude.map((e) => String(e).toLowerCase().trim()) : [];

    let qb = db
      .selectFrom('users')
      .select(['id', 'email', 'name', 'role', 'auth_source', 'created_at', 'updated_at'])
      .where('organization_id', '=', orgId)
      .where((eb) =>
        eb.or([
          eb('email', 'ilike', `%${searchTerm}%`),
          eb('name', 'ilike', `%${searchTerm}%`),
        ])
      );

    // Exclude specific emails
    if (exclude.length > 0) {
      qb = qb.where('email', 'not in', exclude);
    }

    const rows = await qb.orderBy('name', 'asc').limit(limit).execute();

    return rows.map(formatUser);
  });
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Format a database row into a user object.
 * @param {Object} row - Database row
 * @returns {Object} - Formatted user
 */
function formatUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    authSource: row.auth_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Format a database row into a user object with status information.
 * @param {Object} row - Database row (includes password_hash)
 * @param {Map} lastLoginMap - Map of email -> last login timestamp
 * @param {Map} invitationMap - Map of email -> invitation expiry timestamp
 * @param {string} now - Current ISO timestamp
 * @returns {Object} - Formatted user with status fields
 */
function formatUserWithStatus(row, lastLoginMap, invitationMap, now) {
  const hasPassword = Boolean(row.password_hash);
  const lastLoginAt = lastLoginMap.get(row.email) || null;
  const invitationExpiresAt = invitationMap.get(row.email) || null;

  // Determine invitation status: null, 'active', or 'expired'
  // Only show invitation status for users who have NEVER logged in and have no password
  // Once a user has logged in (via any method), they're active - invitation status is irrelevant
  let invitationStatus = null;
  if (!lastLoginAt && !hasPassword && invitationExpiresAt) {
    // ISO strings are lexicographically comparable
    invitationStatus = invitationExpiresAt > now ? 'active' : 'expired';
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    authSource: row.auth_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Status fields
    hasPassword,
    lastLoginAt,
    invitationStatus,
    invitationExpiresAt,
  };
}