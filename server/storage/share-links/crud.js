/**
 * CRUD operations for share links.
 */

import { getDb } from '../../db/client.js';
import { getOrgId } from '../../utils/context.js';
import { norm, nowIso } from '../../utils/normalize.js';
import { withDbGuard } from '../utils/db-guard.js';
import { generateShareToken, hashPassword, verifyPassword } from './index.js';

/**
 * Format a database row into a share link object.
 * @param {Object} row - Database row
 * @returns {Object} - Formatted share link
 */
export function formatShareLink(row) {
  return {
    id: row.id,
    presentationId: row.presentation_id,
    token: row.token,
    label: row.label,
    permission: row.permission,
    hasPassword: !!row.password_hash,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    useCount: row.use_count,
    createdBy: row.created_by,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    revocationMessage: row.revocation_message || null,
    registrationMode: row.registration_mode || 'invite_only',
  };
}

/**
 * Create a new share link for a presentation.
 * @param {string} presentationId - The presentation ID
 * @param {Object} options - Share link options
 * @param {string} options.permission - 'view' | 'comment' | 'edit'
 * @param {string} [options.label] - Optional friendly name
 * @param {string} [options.password] - Optional password protection
 * @param {string} [options.expiresAt] - Optional expiration timestamp
 * @param {number} [options.maxUses] - Optional max use limit
 * @param {string} [options.createdBy] - Email of creator
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - The created share link
 */
export async function createShareLink(presentationId, options, ctx) {
  const pid = norm(presentationId);
  if (!pid) {
    return { ok: false, reason: 'invalid' };
  }

  const permission = options?.permission;
  if (!['view', 'comment', 'edit'].includes(permission)) {
    return { ok: false, reason: 'invalid_permission' };
  }

  // Registration mode: 'open' allows anyone, 'invite_only' requires pre-registration
  const registrationMode = options?.registrationMode || 'invite_only';
  if (!['open', 'invite_only'].includes(registrationMode)) {
    return { ok: false, reason: 'invalid_registration_mode' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const token = generateShareToken();

    // Hash password if provided
    let passwordHash = null;
    if (options?.password) {
      passwordHash = await hashPassword(options.password);
    }

    const row = await db
      .insertInto('presentation_share_links')
      .values({
        presentation_id: pid,
        organization_id: orgId,
        token,
        label: options?.label || null,
        permission,
        password_hash: passwordHash,
        expires_at: options?.expiresAt || null,
        max_uses: options?.maxUses || null,
        created_by: options?.createdBy || null,
        registration_mode: registrationMode,
      })
      .returningAll()
      .executeTakeFirst();

    return {
      ok: true,
      shareLink: formatShareLink(row),
    };
  });
}

/**
 * Get a share link by its token.
 * Does not check expiration or revocation - use validateShareLink for access checks.
 * @param {string} token - The share token
 * @param {Object} ctx - Context object
 * @returns {Promise<Object|null>} - The share link or null
 */
export async function getShareLinkByToken(token, ctx) {
  const t = norm(token);
  if (!t) return null;

  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .selectFrom('presentation_share_links')
      .selectAll()
      .where('token', '=', t)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    return row ? formatShareLink(row) : null;
  });
}

/**
 * Get a share link by its ID (org-scoped), without expiry/revocation filtering.
 *
 * Used to bind a linkId to the presentation the caller is authorized for before
 * a revoke/update/access-log operation, so a user who can write one deck can't
 * act on a link belonging to a different (private) deck via a forged linkId.
 * Returns revoked links too, so the containment check still holds on the
 * revoke/access-log paths.
 * @param {string} linkId - The share link ID
 * @param {Object} ctx - Context object
 * @returns {Promise<Object|null>} - The formatted share link, or null
 */
export async function getShareLinkById(linkId, ctx) {
  const id = norm(linkId);
  if (!id) return null;

  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .selectFrom('presentation_share_links')
      .selectAll()
      .where('id', '=', id)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    return row ? formatShareLink(row) : null;
  });
}

/**
 * Get and validate a share link by ID.
 * Checks: exists, not revoked, not expired.
 * For use in guest management where we have the share link ID.
 * @param {Object} db - Database connection
 * @param {string} shareLinkId - The share link ID
 * @param {string} orgId - Organization ID
 * @returns {Promise<Object>} - { ok: boolean, shareLink?: Object, reason?: string }
 */
export async function getValidShareLinkById(db, shareLinkId, orgId) {
  const shareLink = await db
    .selectFrom('presentation_share_links')
    .selectAll()
    .where('id', '=', shareLinkId)
    .where('organization_id', '=', orgId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();

  if (!shareLink) {
    return { ok: false, reason: 'share_link_not_found' };
  }

  if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
    return { ok: false, reason: 'share_link_expired' };
  }

  return { ok: true, shareLink };
}

/**
 * Validate a share token and return access info if valid.
 * Checks: token exists, not revoked, not expired, within use limit.
 * @param {string} token - The share token
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Validation result
 */
export async function validateShareLink(token, ctx) {
  const t = norm(token);
  if (!t) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .selectFrom('presentation_share_links')
      .selectAll()
      .where('token', '=', t)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    // Check if revoked
    if (row.revoked_at) {
      return {
        ok: false,
        reason: 'revoked',
        revocationMessage: row.revocation_message || null,
        shareLinkId: row.id,
        presentationId: row.presentation_id,
      };
    }

    // Check if expired
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return { ok: false, reason: 'expired' };
    }

    // Check use limit
    if (row.max_uses !== null && row.use_count >= row.max_uses) {
      return { ok: false, reason: 'max_uses_exceeded' };
    }

    return {
      ok: true,
      shareLink: formatShareLink(row),
      requiresPassword: !!row.password_hash,
    };
  });
}

/**
 * Verify password for a share link and increment use count.
 * @param {string} token - The share token
 * @param {string} [password] - The password (if required)
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Verification result with access token
 */
export async function verifyShareLinkAccess(token, password, ctx) {
  const validation = await validateShareLink(token, ctx);
  if (!validation.ok) {
    return validation;
  }

  const { shareLink, requiresPassword } = validation;

  // Check password if required
  if (requiresPassword) {
    if (!password) {
      return { ok: false, reason: 'password_required' };
    }

    const db = getDb();
    const orgId = getOrgId(ctx);

    const row = await db
      .selectFrom('presentation_share_links')
      .select('password_hash')
      .where('token', '=', token)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (!row?.password_hash) {
      return { ok: false, reason: 'invalid' };
    }

    const valid = await verifyPassword(password, row.password_hash);
    if (!valid) {
      return { ok: false, reason: 'invalid_password' };
    }
  }

  // Increment use count atomically
  const db = getDb();
  const orgId = getOrgId(ctx);

  await db
    .updateTable('presentation_share_links')
    .set((eb) => ({
      use_count: eb('use_count', '+', 1),
      last_used_at: nowIso(),
    }))
    .where('id', '=', shareLink.id)
    .where('organization_id', '=', orgId)
    .execute();

  return {
    ok: true,
    shareLink: {
      ...shareLink,
      useCount: shareLink.useCount + 1,
    },
  };
}

/**
 * List all share links for a presentation.
 * @param {string} presentationId - The presentation ID
 * @param {Object} [options] - Filter options
 * @param {boolean} [options.includeRevoked] - Include revoked links
 * @param {Object} ctx - Context object
 * @returns {Promise<Array>} - List of share links
 */
export async function listShareLinks(presentationId, options, ctx) {
  const pid = norm(presentationId);
  if (!pid) return [];

  return withDbGuard([], async (db) => {
    const orgId = getOrgId(ctx);

    let query = db
      .selectFrom('presentation_share_links')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .orderBy('created_at', 'desc');

    if (!options?.includeRevoked) {
      query = query.where('revoked_at', 'is', null);
    }

    const rows = await query.execute();
    return rows.map(formatShareLink);
  });
}

/**
 * Update a share link's settings.
 * Cannot change permission or token.
 * @param {string} linkId - The share link ID
 * @param {Object} updates - Fields to update
 * @param {string} [updates.label] - New label
 * @param {string} [updates.expiresAt] - New expiration
 * @param {number} [updates.maxUses] - New use limit
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Update result
 */
export async function updateShareLink(linkId, updates, ctx) {
  const id = norm(linkId);
  if (!id) {
    return { ok: false, reason: 'invalid' };
  }

  const updateData = {};
  if ('label' in updates) updateData.label = updates.label || null;
  if ('expiresAt' in updates) updateData.expires_at = updates.expiresAt || null;
  if ('maxUses' in updates) updateData.max_uses = updates.maxUses || null;

  if (Object.keys(updateData).length === 0) {
    return { ok: false, reason: 'no_updates' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .updateTable('presentation_share_links')
      .set(updateData)
      .where('id', '=', id)
      .where('organization_id', '=', orgId)
      .where('revoked_at', 'is', null)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    return {
      ok: true,
      shareLink: formatShareLink(row),
    };
  });
}

/**
 * Revoke a share link.
 * @param {string} linkId - The share link ID
 * @param {string} [revokedBy] - Email of user revoking
 * @param {Object} [options] - Options
 * @param {string} [options.message] - Optional revocation message
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Revoke result
 */
export async function revokeShareLink(linkId, revokedBy, options, ctx) {
  // Handle backward compatibility: if options is actually ctx (no options passed)
  if (options && !ctx && typeof options.organizationId !== 'undefined') {
    ctx = options;
    options = {};
  }

  const id = norm(linkId);
  if (!id) {
    return { ok: false, reason: 'invalid' };
  }

  const message = options?.message || null;

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .updateTable('presentation_share_links')
      .set({
        revoked_at: nowIso(),
        revoked_by: revokedBy || null,
        revocation_message: message,
      })
      .where('id', '=', id)
      .where('organization_id', '=', orgId)
      .where('revoked_at', 'is', null)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    return { ok: true };
  });
}

/**
 * Revoke all share links for a presentation.
 * @param {string} presentationId - The presentation ID
 * @param {string} [revokedBy] - Email of user revoking
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Revoke result with count
 */
export async function revokeAllShareLinks(presentationId, revokedBy, ctx) {
  const pid = norm(presentationId);
  if (!pid) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    const result = await db
      .updateTable('presentation_share_links')
      .set({
        revoked_at: nowIso(),
        revoked_by: revokedBy || null,
      })
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();

    return {
      ok: true,
      count: Number(result.numUpdatedRows) || 0,
    };
  });
}