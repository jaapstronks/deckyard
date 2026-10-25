/**
 * Storage layer for user management.
 * Handles CRUD operations for database users and invitation flows.
 */

import { getOrgId } from '../utils/context.js';
import { toStorageContext } from './scope.js';
import { nowIso, isoAfter } from '../utils/normalize.js';
import { normalizeEmail } from '../../shared/email.js';
import { withDbGuard } from '../db/client.js';
import { keysetPage, keysetRows } from './keyset.js';
import { escapeLikePattern } from './utils/index.js';
import {
  generateSecureToken,
  hashToken,
  isValidEmail,
} from '../utils/secure-tokens.js';
import { getUserByEmailGlobal } from './identity.js';
import { invalidateDisplayNames } from './display-identity.js';

/**
 * Resolve an instance-wide email identity, creating it in the supplied organization.
 * Existing identities keep their organization, role and credentials. A concurrent
 * insert wins unchanged; login-specific updates remain the caller's policy.
 * @param {import('./scope.js').StorageScope} scope
 * @param {{email: string, role: 'user'|'admin', authSource: string, name?: string,
 *   passwordHash?: string, passwordChangedAt?: string, autoProvision?: boolean}} options
 * @returns {Promise<{user: object|null, created: boolean}|null>} null if unavailable
 */
export async function ensureUserByEmail(scope, options) {
  const { organizationId } = toStorageContext(scope, 'ensureUserByEmail');
  const email = normalizeEmail(options.email);
  if (
    !email ||
    !['user', 'admin'].includes(options.role) ||
    !options.authSource
  ) {
    throw new TypeError(
      'ensureUserByEmail requires email, role and authSource',
    );
  }
  return withDbGuard(null, async (db) => {
    const lookup = () => getUserByEmailGlobal(scope, email);
    const existing = await lookup();
    if (existing) return { user: existing, created: false };
    if (options.autoProvision === false) return { user: null, created: false };
    const now = nowIso();
    const values = {
      organization_id: organizationId,
      email,
      role: options.role,
      auth_source: options.authSource,
      created_at: now,
      updated_at: now,
    };
    if (options.name !== undefined) values.name = options.name || null;
    if (options.passwordHash !== undefined)
      values.password_hash = options.passwordHash;
    if (options.passwordChangedAt !== undefined)
      values.password_changed_at = options.passwordChangedAt;
    const inserted = await db
      .insertInto('users')
      .values(values)
      .onConflict((oc) => oc.column('email').doNothing())
      .returningAll()
      .executeTakeFirst();
    return {
      user: inserted || (await lookup()) || null,
      created: Boolean(inserted),
    };
  });
}

/**
 * Create the instance's first user, an admin without a password, but only
 * while the `users` table is empty. This is the boot-time bootstrap for
 * `AUTH_ADMIN_EMAIL` (D192): once anyone exists, users come from the admin UI,
 * SSO or the other login paths, and this never writes again. The first session
 * is set up through magic link or password reset, which need an existing row.
 *
 * Two instances booting together race on the same address; the unique
 * `users.email` turns the loser into a no-op.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} email - The configured admin address
 * @returns {Promise<{created: boolean, user: object|null, reason?: 'invalid'|'not_empty'|'unavailable'}>}
 */
export async function createFirstAdmin(scope, email) {
  const { organizationId } = toStorageContext(scope, 'createFirstAdmin');
  const normalized = normalizeEmail(email);
  if (!normalized || !isValidEmail(normalized)) {
    return { created: false, user: null, reason: 'invalid' };
  }
  return withDbGuard(
    { created: false, user: null, reason: 'unavailable' },
    async (db) => {
      const any = await db.selectFrom('users').select('id').limit(1).execute();
      if (any.length > 0) {
        return { created: false, user: null, reason: 'not_empty' };
      }
      const now = nowIso();
      const inserted = await db
        .insertInto('users')
        .values({
          organization_id: organizationId,
          email: normalized,
          role: 'admin',
          auth_source: 'database',
          created_at: now,
          updated_at: now,
        })
        .onConflict((oc) => oc.column('email').doNothing())
        .returningAll()
        .executeTakeFirst();
      return inserted
        ? { created: true, user: inserted }
        : { created: false, user: null, reason: 'not_empty' };
    },
  );
}

// ============================================================
// USER CRUD
// ============================================================

/**
 * One page of the organization's users with status information (B825,
 * D358): order `(created_at desc, id desc)`, newest account first. Last login
 * and an open invitation are read for this page's addresses only.
 *
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {{limit: number, after?: {value: string, id: string}|null}} page
 * @returns {Promise<{items: Object[], next: {value: string, id: string}|null}>}
 */
export async function listUsers(scope, page) {
  toStorageContext(scope, 'listUsers');
  const empty = { items: [], next: null };
  return withDbGuard(empty, async (db) => {
    const query = db
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
      .where('organization_id', '=', getOrgId(scope));
    const { rows, next } = keysetRows(
      await keysetPage(query, {
        column: 'created_at',
        after: page.after ?? null,
        limit: page.limit,
      }).execute(),
      page.limit,
    );
    const emails = rows.map((row) => row.email);
    if (!emails.length) return empty;

    // Last login per address (successful password and magic-link logins)
    // and the latest unused invitation token, for this page's addresses.
    const loginEvents = await db
      .selectFrom('auth_audit_log')
      .select(['user_email', 'created_at'])
      .where('user_email', 'in', emails)
      .where('event_type', 'in', ['login', 'magic_link_login'])
      .where('success', '=', true)
      .orderBy('created_at', 'desc')
      .execute();
    const lastLoginMap = new Map();
    for (const event of loginEvents) {
      if (!lastLoginMap.has(event.user_email)) {
        lastLoginMap.set(event.user_email, event.created_at);
      }
    }

    const invitationTokens = await db
      .selectFrom('password_reset_tokens')
      .select(['user_email', 'expires_at'])
      .where('user_email', 'in', emails)
      .where('used_at', 'is', null)
      .orderBy('expires_at', 'desc')
      .execute();
    const invitationMap = new Map();
    for (const token of invitationTokens) {
      if (!invitationMap.has(token.user_email)) {
        invitationMap.set(token.user_email, token.expires_at);
      }
    }

    const now = nowIso();
    return {
      items: rows.map((row) =>
        formatUserWithStatus(row, lastLoginMap, invitationMap, now),
      ),
      next,
    };
  });
}

/**
 * The organization's users with these addresses, as a Map address → user.
 * Bounded by its argument: a caller that knows whom it means asks for them,
 * instead of reading the whole user list to look them up.
 *
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string[]} emails - Addresses, normalized or not.
 * @returns {Promise<Map<string, Object>>}
 */
export async function getUsersByEmails(scope, emails) {
  toStorageContext(scope, 'getUsersByEmails');
  const wanted = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  if (!wanted.length) return new Map();
  return withDbGuard(new Map(), async (db) => {
    const rows = await db
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
      .where('organization_id', '=', getOrgId(scope))
      .where('email', 'in', wanted)
      .execute();
    return new Map(rows.map((row) => [row.email, formatUser(row)]));
  });
}

/**
 * Get a user by ID.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} userId - The user ID
 * @returns {Promise<Object|null>} - User object or null
 */
export async function getUserById(scope, userId) {
  toStorageContext(scope, 'getUserById');
  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(scope);

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
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} email - The user's email
 * @returns {Promise<Object|null>} - User object or null
 */
export async function getUserByEmail(scope, email) {
  toStorageContext(scope, 'getUserByEmail');
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(scope);

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
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {Object} userData - User data
 * @param {string} userData.email - User's email
 * @param {string} [userData.name] - User's name
 * @param {string} [userData.role] - User's role (user/admin)
 * @returns {Promise<Object>} - Result with user and invitation token
 */
export async function createUser(scope, userData) {
  toStorageContext(scope, 'createUser');
  const email = normalizeEmail(userData?.email);
  if (!email || !email.includes('@')) {
    return { ok: false, reason: 'invalid', field: 'email' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);

    // Existence is checked instance-wide, not per organization: users.email is
    // globally unique, so an organization-scoped check would report "free" for
    // an email that the insert then rejects.
    const existing = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', email)
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
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} userId - The user ID
 * @param {Object} updates - Fields to update
 * @param {string} [updates.name] - User's name
 * @param {string} [updates.role] - User's role
 * @returns {Promise<Object>} - Update result
 */
export async function updateUser(scope, userId, updates) {
  toStorageContext(scope, 'updateUser');
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);

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

    // `users.name` is the fallback a response's `displayName` is built from,
    // and that is memoized (storage/display-identity.js) — drop the memo so an
    // admin rename lands immediately rather than within the TTL.
    if ('name' in updates) invalidateDisplayNames();

    return {
      ok: true,
      user: formatUser(row),
    };
  });
}

/**
 * Tables of single-use login tokens, keyed on the email address rather than the
 * user id. They outlive the `users` row unless deleted with it, and a magic
 * link redeemed after the delete recreates the account (B546).
 */
const LOGIN_TOKEN_TABLES = ['password_reset_tokens', 'magic_link_tokens'];

/**
 * Delete every pending login token for an email address.
 * @param {import('kysely').Kysely<any>} db - The database handle
 * @param {string} email - The normalized email address
 * @returns {Promise<void>}
 */
async function deleteLoginTokens(db, email) {
  for (const table of LOGIN_TOKEN_TABLES) {
    await db.deleteFrom(table).where('user_email', '=', email).execute();
  }
}

/**
 * Delete a user.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} - Delete result
 */
export async function deleteUser(scope, userId) {
  toStorageContext(scope, 'deleteUser');
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);

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

    await deleteLoginTokens(db, user.email);

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
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} - Result with new invitation token
 */
export async function resendInvitation(scope, userId) {
  toStorageContext(scope, 'resendInvitation');
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);

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
 *
 * Case folding is PostgreSQL's, once: `ILIKE` folds both sides. Lowercasing
 * the query in JavaScript first put a second folder on the same comparison —
 * the defect B388 names in `searchTags`, in its second location — and the two
 * can differ on input like `'İ'` (U+0130). `ILIKE` rather than `lower()` here
 * because neither `users.email` nor `users.name` carries a `lower()` index to
 * stay consistent with; addresses are normalized on write by `normalizeEmail`.
 *
 * The query is escaped, so a typed `%`, `_` or `\` matches itself instead of
 * acting as a wildcard.
 *
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {number} [options.limit=10] - Maximum results
 * @param {string[]} [options.exclude=[]] - Email addresses to exclude
 * @returns {Promise<Array>} - List of matching users
 */
export async function searchUsers(scope, query, options = {}) {
  toStorageContext(scope, 'searchUsers');
  const searchTerm = String(query || '').trim();
  if (!searchTerm) return [];
  const pattern = `%${escapeLikePattern(searchTerm)}%`;

  return withDbGuard([], async (db) => {
    const orgId = getOrgId(scope);
    const limit = Math.min(Math.max(1, options.limit || 10), 50);
    // `normalizeEmail` is what wrote these addresses, so it is also what reads
    // them back; the open-coded lowercase-and-trim here was a second spelling
    // of the same rule. It answers `null` for an empty entry, and a `null` in
    // a `NOT IN` list makes the whole predicate unknown — hence the filter.
    const exclude = Array.isArray(options.exclude)
      ? options.exclude.map(normalizeEmail).filter(Boolean)
      : [];

    let qb = db
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
      .where('organization_id', '=', orgId)
      .where((eb) =>
        eb.or([eb('email', 'ilike', pattern), eb('name', 'ilike', pattern)]),
      );

    // Exclude specific emails
    if (exclude.length > 0) {
      qb = qb.where('email', 'not in', exclude);
    }

    const rows = await qb.orderBy('name', 'asc').limit(limit).execute();

    return rows.map(formatUser);
  });
}

/**
 * Batch-read the public profile of users, by stable id.
 *
 * The avatar surfaces (deck cards, the notification bell) used to look a
 * profile up by the address the response echoed at them. D22 removed that
 * address, so the key is the `users.id` the response now carries instead —
 * which also means this endpoint no longer takes an address, and can no longer
 * be used to probe whether one exists.
 *
 * Organization-scoped: a profile is only returned for a user in the caller's
 * organization, so an id guessed from elsewhere yields nothing.
 *
 * Reads the profile bag the way `storage/settings.js` does — the row keyed on
 * the stable id leads, the email-keyed row is the fallback for rows the
 * migration-067 backfill could not key — and falls back to `users.name`.
 *
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string[]} userIds - Stable `users.id` values.
 * @returns {Promise<Record<string, {name: string, imageUrl: string}>>} Keyed by
 *   user id. Ids with no user record in this organization are simply absent.
 */
export async function getPublicProfilesByIds(scope, userIds) {
  toStorageContext(scope, 'getPublicProfilesByIds');
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!ids.length) return {};

  return withDbGuard({}, async (db) => {
    const orgId = getOrgId(scope);
    const rows = await db
      .selectFrom('users')
      .leftJoin(
        'user_settings as settings_by_id',
        'settings_by_id.user_id',
        'users.id',
      )
      .leftJoin(
        'user_settings as settings_by_email',
        'settings_by_email.email',
        'users.email',
      )
      .select([
        'users.id as id',
        'users.name as name',
        'settings_by_id.settings as settingsById',
        'settings_by_email.settings as settingsByEmail',
      ])
      .where('users.id', 'in', ids)
      .where('users.organization_id', '=', orgId)
      .execute();

    const out = {};
    for (const row of rows) {
      const byId = profileBag(row.settingsById);
      const byEmail = profileBag(row.settingsByEmail);
      out[row.id] = {
        name: byId.name || byEmail.name || String(row.name || '').trim(),
        imageUrl: byId.imageUrl || byEmail.imageUrl || '',
      };
    }
    return out;
  });
}

/**
 * Read the `profile` object out of a stored user-settings bag.
 * @param {any} settings
 * @returns {{name: string, imageUrl: string}}
 */
function profileBag(settings) {
  const profile =
    settings && typeof settings === 'object' && settings.profile
      ? settings.profile
      : {};
  return {
    name: typeof profile.name === 'string' ? profile.name.trim() : '',
    imageUrl: typeof profile.imageUrl === 'string' ? profile.imageUrl : '',
  };
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
    // The pg driver returns timestamptz columns as Date objects while `now` is
    // an ISO string; a Date-vs-string comparison coerces the string to NaN and
    // is always false. Compare as epoch milliseconds so both shapes order.
    invitationStatus =
      new Date(invitationExpiresAt).getTime() > new Date(now).getTime()
        ? 'active'
        : 'expired';
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
