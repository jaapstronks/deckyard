/**
 * Storage layer for API key management.
 * Handles key generation, validation, revocation, and listing.
 */

import crypto from 'node:crypto';
import { getOrgId } from '../utils/context.js';
import { nowIso, normalizeEmail } from '../utils/normalize.js';
import { generateSecureToken, hashToken, isValidEmail } from '../utils/secure-tokens.js';
import { withDbGuard } from './utils/db-guard.js';

/**
 * Normalized owner email for the acting user, used to scope key
 * list/read/revoke queries to the caller. Returns '' when absent, which the
 * `owner_email = ''` filter turns into an empty result set (fail closed) —
 * never a cross-user match. Keep the org filter alongside this.
 * @param {Object} ctx - Route context ({ actorEmail })
 * @returns {string} Normalized owner email, or '' if unavailable
 */
export function getOwnerEmail(ctx) {
  return normalizeEmail(ctx?.actorEmail) || '';
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

// Available scopes
export const AVAILABLE_SCOPES = [
  'read',           // Read presentations, themes, slide types
  'write',          // Create, update, delete presentations
  'export',         // Export presentations
  'ai',             // Use AI generation features
  'comments:read',  // Read comments on accessible presentations
  'comments:write', // Create comments/replies and change comment status
];

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
 * @param {Object} params - Key parameters
 * @param {string} params.name - Display name for the key
 * @param {string} params.ownerEmail - Email of the key owner
 * @param {string[]} [params.scopes] - Scopes for the key (defaults to read, write)
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result with the raw key (only returned once)
 */
export async function createApiKey({ name, ownerEmail, scopes }, ctx) {
  const normalizedEmail = normalizeEmail(ownerEmail);
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    return { ok: false, reason: 'invalid_email' };
  }

  if (!name?.trim()) {
    return { ok: false, reason: 'name_required' };
  }

  // Validate scopes if provided
  const keyScopes = scopes || ['read', 'write'];
  const invalidScopes = keyScopes.filter(s => !AVAILABLE_SCOPES.includes(s));
  if (invalidScopes.length > 0) {
    return { ok: false, reason: 'invalid_scopes', invalidScopes };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const { key, prefix, hash } = generateApiKey();

    const row = await db
      .insertInto('api_keys')
      .values({
        organization_id: orgId,
        owner_email: normalizedEmail,
        name: name.trim(),
        key_prefix: prefix,
        key_hash: hash,
        scopes: JSON.stringify(keyScopes),
      })
      .returningAll()
      .executeTakeFirst();

    return {
      ok: true,
      key, // Only returned on creation - never stored
      id: row.id,
      name: row.name,
      prefix: row.key_prefix,
      scopes: keyScopes,
      createdAt: row.created_at,
    };
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
    return { ok: false, reason: 'invalid_format' };
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

    // Parse scopes
    let scopes = ['read', 'write'];
    try {
      if (row.scopes) {
        scopes = typeof row.scopes === 'string'
          ? JSON.parse(row.scopes)
          : row.scopes;
      }
    } catch {
      // Use default scopes on parse error
    }

    return {
      ok: true,
      id: row.id,
      organizationId: row.organization_id,
      ownerEmail: row.owner_email,
      name: row.name,
      prefix: row.key_prefix,
      tier: row.tier || 'free',
      scopes,
      createdAt: row.created_at,
    };
  });
}

/**
 * Revoke an API key.
 * @param {string} keyId - The key ID to revoke
 * @param {string} revokerEmail - Email of the user revoking the key
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result
 */
export async function revokeApiKey(keyId, revokerEmail, ctx) {
  if (!keyId) {
    return { ok: false, reason: 'key_id_required' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const now = nowIso();

    // Only allow revoking the caller's own keys within their organization.
    const row = await db
      .updateTable('api_keys')
      .set({ revoked_at: now })
      .where('id', '=', keyId)
      .where('organization_id', '=', orgId)
      .where('owner_email', '=', getOwnerEmail(ctx))
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
 * List API keys for an organization.
 * @param {Object} options - List options
 * @param {boolean} [options.includeRevoked] - Include revoked keys
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result with key list
 */
export async function listApiKeys(options = {}, ctx) {
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const { includeRevoked = false } = options;

    let query = db
      .selectFrom('api_keys')
      .select([
        'id',
        'owner_email',
        'name',
        'key_prefix',
        'tier',
        'scopes',
        'last_used_at',
        'revoked_at',
        'created_at',
      ])
      .where('organization_id', '=', orgId)
      .where('owner_email', '=', getOwnerEmail(ctx))
      .orderBy('created_at', 'desc');

    if (!includeRevoked) {
      query = query.where('revoked_at', 'is', null);
    }

    const rows = await query.execute();

    const keys = rows.map(row => {
      let scopes = ['read', 'write'];
      try {
        if (row.scopes) {
          scopes = typeof row.scopes === 'string'
            ? JSON.parse(row.scopes)
            : row.scopes;
        }
      } catch {
        // Use default scopes on parse error
      }

      return {
        id: row.id,
        ownerEmail: row.owner_email,
        name: row.name,
        prefix: row.key_prefix,
        tier: row.tier || 'free',
        scopes,
        lastUsedAt: row.last_used_at,
        revokedAt: row.revoked_at,
        createdAt: row.created_at,
      };
    });

    return { ok: true, keys };
  });
}

/**
 * Get an API key by its prefix (for display purposes).
 * @param {string} prefix - The key prefix
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result with key data
 */
export async function getApiKeyByPrefix(prefix, ctx) {
  if (!prefix) {
    return { ok: false, reason: 'prefix_required' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .selectFrom('api_keys')
      .selectAll()
      .where('key_prefix', '=', prefix)
      .where('organization_id', '=', orgId)
      .where('owner_email', '=', getOwnerEmail(ctx))
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    let scopes = ['read', 'write'];
    try {
      if (row.scopes) {
        scopes = typeof row.scopes === 'string'
          ? JSON.parse(row.scopes)
          : row.scopes;
      }
    } catch {
      // Use default scopes on parse error
    }

    return {
      ok: true,
      id: row.id,
      ownerEmail: row.owner_email,
      name: row.name,
      prefix: row.key_prefix,
      tier: row.tier || 'free',
      scopes,
      lastUsedAt: row.last_used_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
    };
  });
}

/**
 * Get an API key by ID.
 * @param {string} keyId - The key ID
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result with key data
 */
export async function getApiKeyById(keyId, ctx) {
  if (!keyId) {
    return { ok: false, reason: 'key_id_required' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .selectFrom('api_keys')
      .selectAll()
      .where('id', '=', keyId)
      .where('organization_id', '=', orgId)
      .where('owner_email', '=', getOwnerEmail(ctx))
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    let scopes = ['read', 'write'];
    try {
      if (row.scopes) {
        scopes = typeof row.scopes === 'string'
          ? JSON.parse(row.scopes)
          : row.scopes;
      }
    } catch {
      // Use default scopes on parse error
    }

    return {
      ok: true,
      id: row.id,
      ownerEmail: row.owner_email,
      name: row.name,
      prefix: row.key_prefix,
      tier: row.tier || 'free',
      scopes,
      lastUsedAt: row.last_used_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
    };
  });
}

/**
 * Update an API key's tier.
 * @param {string} keyId - The key ID
 * @param {string} tier - The new tier (free, pro, enterprise)
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result
 */
export async function updateApiKeyTier(keyId, tier, ctx) {
  if (!keyId) {
    return { ok: false, reason: 'key_id_required' };
  }

  if (!TIER_LIMITS[tier]) {
    return { ok: false, reason: 'invalid_tier' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .updateTable('api_keys')
      .set({ tier })
      .where('id', '=', keyId)
      .where('organization_id', '=', orgId)
      .where('revoked_at', 'is', null)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found_or_revoked' };
    }

    return { ok: true, tier };
  });
}

// ============================================================
// SCOPE CHECKING
// ============================================================

/**
 * Check if an API key has a specific scope.
 * @param {string[]} keyScopes - The key's scopes
 * @param {string} requiredScope - The required scope
 * @returns {boolean}
 */
export function hasScope(keyScopes, requiredScope) {
  return Array.isArray(keyScopes) && keyScopes.includes(requiredScope);
}
