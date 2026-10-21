/**
 * Storage layer for API key management.
 * Handles key generation, validation, revocation, and listing.
 */

import { getOrgId } from '../utils/context.js';
import { toStorageContext } from './scope.js';
import { nowIso } from '../utils/normalize.js';
import { normalizeEmail } from '../../shared/email.js';
import {
  generateSecureToken,
  hashToken,
  isValidEmail,
} from '../utils/secure-tokens.js';
import { withDbGuard } from '../db/client.js';

/**
 * Normalized owner email for the acting user, used to scope key
 * list/read/revoke queries to the caller. Returns '' when absent, which the
 * `owner_email = ''` filter turns into an empty result set (fail closed) —
 * never a cross-user match. Keep the org filter alongside this.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope ({ actorEmail })
 * @returns {string} Normalized owner email, or '' if unavailable
 */
export function getOwnerEmail(scope) {
  return normalizeEmail(scope?.actorEmail) || '';
}

// ============================================================
// CONSTANTS
// ============================================================

const KEY_PREFIX = 'dk_live_';
const KEY_PREFIX_LENGTH = 8; // Store first 8 chars after prefix for identification

// Tier rate limits
export const TIER_LIMITS = {
  free: {
    requestsPerMinute: 60,
    aiCallsPerDay: 10,
    exportsPerDay: 50,
  },
  pro: {
    requestsPerMinute: 300,
    aiCallsPerDay: 100,
    exportsPerDay: 500,
  },
  enterprise: {
    requestsPerMinute: 1000,
    aiCallsPerDay: -1, // Unlimited
    exportsPerDay: -1, // Unlimited
  },
};

// Available permissions
export const AVAILABLE_PERMISSIONS = [
  'read', // Read presentations, themes, slide types
  'write', // Create, update, delete presentations
  'export', // Export presentations
  'ai', // Use AI generation features
  'comments:read', // Read comments on accessible presentations
  'comments:write', // Create comments/replies and change comment status
  'collaborators:read', // See who has access to presentations the key's owner manages
  'collaborators:write', // Grant organization members access to those presentations
];

/**
 * Validate a requested permission list: a non-empty array whose every entry is
 * one of {@link AVAILABLE_PERMISSIONS}. The one check behind both creating a
 * key and changing an existing key's permissions, so the two cannot drift.
 * Duplicates are dropped, order is kept.
 *
 * @param {unknown} permissions - The permissions as the caller sent them
 * @returns {{ ok: true, permissions: string[] } | { ok: false, reason: 'invalid', field: 'permissions', invalidPermissions: unknown[] }}
 */
export function validatePermissions(permissions) {
  if (!Array.isArray(permissions) || permissions.length === 0) {
    return {
      ok: false,
      reason: 'invalid',
      field: 'permissions',
      invalidPermissions: [],
    };
  }
  const invalidPermissions = permissions.filter(
    (s) => !AVAILABLE_PERMISSIONS.includes(s),
  );
  if (invalidPermissions.length > 0) {
    return {
      ok: false,
      reason: 'invalid',
      field: 'permissions',
      invalidPermissions,
    };
  }
  return { ok: true, permissions: [...new Set(permissions)] };
}

/**
 * Read the stored `permissions` column (jsonb, or a JSON string from older
 * rows) back into an array, falling back to the creation default.
 *
 * @param {unknown} raw - The stored column value
 * @returns {string[]}
 */
function parseStoredPermissions(raw) {
  try {
    if (raw) {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    }
  } catch {
    // Use default permissions on parse error
  }
  return ['read', 'write'];
}

/**
 * The listed shape of a stored key: what {@link listApiKeys} returns per key
 * and {@link updateApiKeyPermissions} returns for the changed one. Never the
 * hash.
 *
 * @param {Object} row - An `api_keys` row
 * @returns {Object}
 */
function toListedKey(row) {
  return {
    id: row.id,
    ownerEmail: row.owner_email,
    name: row.name,
    prefix: row.key_prefix,
    tier: row.tier || 'free',
    permissions: parseStoredPermissions(row.permissions),
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

// ============================================================
// KEY GENERATION
// ============================================================

/**
 * Generate a new API key with prefix.
 * Format: dk_live_<random>
 * @returns {{ key: string, prefix: string, hash: string }}
 */
function generateApiKey() {
  const randomPart = generateSecureToken();
  const fullKey = `${KEY_PREFIX}${randomPart}`;
  const prefix = `${KEY_PREFIX}${randomPart.slice(0, KEY_PREFIX_LENGTH)}`;
  const hash = hashToken(fullKey);

  return { key: fullKey, prefix, hash };
}

/**
 * Extract the prefix from a full API key for display.
 * @param {string} key - The full API key
 * @returns {string} - The prefix portion
 */
export function getKeyPrefix(key) {
  if (!key?.startsWith(KEY_PREFIX)) return '';
  const randomPart = key.slice(KEY_PREFIX.length);
  return `${KEY_PREFIX}${randomPart.slice(0, KEY_PREFIX_LENGTH)}`;
}

// ============================================================
// KEY MANAGEMENT
// ============================================================

/**
 * Create a new API key.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {Object} params - Key parameters
 * @param {string} params.name - Display name for the key
 * @param {string} params.ownerEmail - Email of the key owner
 * @param {string[]} [params.permissions] - Permissions for the key (defaults to read, write)
 * @returns {Promise<Object>} - Result with the raw key (only returned once)
 */
export async function createApiKey(scope, { name, ownerEmail, permissions }) {
  toStorageContext(scope, 'createApiKey');
  const normalizedEmail = normalizeEmail(ownerEmail);
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    return { ok: false, reason: 'invalid', field: 'email' };
  }

  if (!name?.trim()) {
    return { ok: false, reason: 'name_required' };
  }

  // Validate permissions if provided
  const checked = validatePermissions(permissions || ['read', 'write']);
  if (!checked.ok) return checked;
  const keyPermissions = checked.permissions;

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);
    const { key, prefix, hash } = generateApiKey();

    const row = await db
      .insertInto('api_keys')
      .values({
        organization_id: orgId,
        owner_email: normalizedEmail,
        name: name.trim(),
        key_prefix: prefix,
        key_hash: hash,
        permissions: JSON.stringify(keyPermissions),
      })
      .returningAll()
      .executeTakeFirst();

    return {
      ok: true,
      key, // Only returned on creation - never stored
      id: row.id,
      name: row.name,
      prefix: row.key_prefix,
      permissions: keyPermissions,
      createdAt: row.created_at,
    };
  });
}

/**
 * How many unrevoked API keys the instance holds, across organizations. Read
 * once at boot when the public API cluster is off, so the operator learns the
 * keys are still there and refused for now (D261).
 *
 * @param {import('./scope.js').StorageScope} scope - Cross-organization.
 * @returns {Promise<number>} Zero without a database.
 */
export async function countActiveApiKeys(scope) {
  toStorageContext(
    scope,
    'countActiveApiKeys',
    {},
    { allowCrossOrganization: true },
  );
  return withDbGuard(0, async (db) => {
    const row = await db
      .selectFrom('api_keys')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    return Number(row?.n) || 0;
  });
}

/**
 * Validate an API key and return the associated data.
 * Also updates last_used_at timestamp.
 * @param {string} rawKey - The raw API key from the request
 * @returns {Promise<Object>} - Validation result with key data
 */
export async function validateApiKey(rawKey) {
  const key = String(rawKey || '').trim();

  if (!key || !key.startsWith(KEY_PREFIX)) {
    return { ok: false, reason: 'invalid', field: 'key' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const keyHash = hashToken(key);
    const now = nowIso();

    // Find the key and update last_used_at
    const row = await db
      .updateTable('api_keys')
      .set({ last_used_at: now })
      .where('key_hash', '=', keyHash)
      .where('revoked_at', 'is', null)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'invalid_or_revoked' };
    }

    const permissions = parseStoredPermissions(row.permissions);

    return {
      ok: true,
      id: row.id,
      organizationId: row.organization_id,
      ownerEmail: row.owner_email,
      name: row.name,
      prefix: row.key_prefix,
      tier: row.tier || 'free',
      permissions,
      createdAt: row.created_at,
    };
  });
}

/**
 * Revoke an API key.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} keyId - The key ID to revoke
 * @param {string} revokerEmail - Email of the user revoking the key
 * @returns {Promise<Object>} - Result
 */
export async function revokeApiKey(scope, keyId, revokerEmail) {
  toStorageContext(scope, 'revokeApiKey');
  if (!keyId) {
    return { ok: false, reason: 'api_key_id_required' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);
    const now = nowIso();

    // Only allow revoking the caller's own keys within their organization.
    const row = await db
      .updateTable('api_keys')
      .set({ revoked_at: now })
      .where('id', '=', keyId)
      .where('organization_id', '=', orgId)
      .where('owner_email', '=', getOwnerEmail(scope))
      .where('revoked_at', 'is', null)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found_or_already_revoked' };
    }

    return { ok: true, revokedAt: now };
  });
}

/**
 * Replace the permissions of an existing, unrevoked API key.
 *
 * Scoped exactly like {@link revokeApiKey}: the caller's own key, in the
 * caller's organization, not revoked. Anything else — another organization,
 * another user's key, a revoked key, an unknown id — is the same
 * `not_found_or_already_revoked`, so the answer never confirms a key the caller
 * may not touch. The new list is validated by {@link validatePermissions}, the
 * check creation uses.
 *
 * Takes effect on the key's next request: the MCP and public-API gates read the
 * key per request through {@link validateApiKey}, nothing caches it.
 *
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} keyId - The key to change
 * @param {unknown} permissions - The complete new permission list
 * @returns {Promise<{ ok: true, key: Object, before: string[] } | { ok: false, reason: string, field?: string }>}
 *   `key` has the shape {@link listApiKeys} returns; `before` is the list it replaced.
 */
export async function updateApiKeyPermissions(scope, keyId, permissions) {
  toStorageContext(scope, 'updateApiKeyPermissions');
  if (!keyId) {
    return { ok: false, reason: 'api_key_id_required' };
  }
  const checked = validatePermissions(permissions);
  if (!checked.ok) return checked;

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);
    const current = await db
      .selectFrom('api_keys')
      .select(['id', 'permissions'])
      .where('id', '=', keyId)
      .where('organization_id', '=', orgId)
      .where('owner_email', '=', getOwnerEmail(scope))
      .where('revoked_at', 'is', null)
      .executeTakeFirst();

    if (!current) {
      return { ok: false, reason: 'not_found_or_already_revoked' };
    }

    // The same filters again: a revoke landing between the read and this
    // write leaves the key revoked and the update a no-op, never the reverse.
    const row = await db
      .updateTable('api_keys')
      .set({ permissions: JSON.stringify(checked.permissions) })
      .where('id', '=', keyId)
      .where('organization_id', '=', orgId)
      .where('owner_email', '=', getOwnerEmail(scope))
      .where('revoked_at', 'is', null)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found_or_already_revoked' };
    }

    return {
      ok: true,
      before: parseStoredPermissions(current.permissions),
      key: toListedKey(row),
    };
  });
}

/**
 * List API keys for an organization.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {Object} options - List options
 * @param {boolean} [options.includeRevoked] - Include revoked keys
 * @returns {Promise<Object>} - Result with key list
 */
export async function listApiKeys(scope, options = {}) {
  toStorageContext(scope, 'listApiKeys');
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);
    const { includeRevoked = false } = options;

    let query = db
      .selectFrom('api_keys')
      .select([
        'id',
        'owner_email',
        'name',
        'key_prefix',
        'tier',
        'permissions',
        'last_used_at',
        'revoked_at',
        'created_at',
      ])
      .where('organization_id', '=', orgId)
      .where('owner_email', '=', getOwnerEmail(scope))
      .orderBy('created_at', 'desc');

    if (!includeRevoked) {
      query = query.where('revoked_at', 'is', null);
    }

    const rows = await query.execute();

    const keys = rows.map(toListedKey);

    return { ok: true, keys };
  });
}

/**
 * Get an API key by ID.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} keyId - The key ID
 * @returns {Promise<Object>} - Result with key data
 */
export async function getApiKeyById(scope, keyId) {
  toStorageContext(scope, 'getApiKeyById');
  if (!keyId) {
    return { ok: false, reason: 'api_key_id_required' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);

    const row = await db
      .selectFrom('api_keys')
      .selectAll()
      .where('id', '=', keyId)
      .where('organization_id', '=', orgId)
      .where('owner_email', '=', getOwnerEmail(scope))
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    const permissions = parseStoredPermissions(row.permissions);

    return {
      ok: true,
      id: row.id,
      ownerEmail: row.owner_email,
      name: row.name,
      prefix: row.key_prefix,
      tier: row.tier || 'free',
      permissions,
      lastUsedAt: row.last_used_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
    };
  });
}

// ============================================================
// SCOPE CHECKING
// ============================================================

/**
 * Check if an API key has a specific permission.
 * @param {string[]} keyPermissions - The key's permissions
 * @param {string} requiredPermission - The required permission
 * @returns {boolean}
 */
export function hasPermission(keyPermissions, requiredPermission) {
  return (
    Array.isArray(keyPermissions) && keyPermissions.includes(requiredPermission)
  );
}
