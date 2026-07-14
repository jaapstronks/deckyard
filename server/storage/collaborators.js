/**
 * Storage layer for presentation collaborators.
 * Enables workspace users to collaborate on presentations with specific permissions.
 */

import { getOrgId } from '../utils/context.js';
import { norm, nowIso, normalizeEmail } from '../utils/normalize.js';
import { withDbGuard } from './utils/db-guard.js';
import {
  getCachedPermission,
  setCachedPermission,
  invalidatePermission,
  invalidatePresentationPermissions,
} from './cache/permission-cache.js';

// ============================================================
// COLLABORATOR CRUD
// ============================================================

/**
 * Add a collaborator to a presentation.
 * @param {string} presentationId - The presentation ID
 * @param {Object} options - Collaborator options
 * @param {string} options.userEmail - Email of the user to add
 * @param {string} options.permission - 'view' | 'comment' | 'edit'
 * @param {string} [options.invitedBy] - Email of the inviter
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result with collaborator
 */
export async function addCollaborator(presentationId, options, ctx) {
  const pid = norm(presentationId);
  if (!pid) {
    return { ok: false, reason: 'invalid' };
  }

  const userEmail = normalizeEmail(options?.userEmail);
  if (!userEmail || !userEmail.includes('@')) {
    return { ok: false, reason: 'invalid_email' };
  }

  const permission = options?.permission;
  if (!['view', 'comment', 'edit', 'admin'].includes(permission)) {
    return { ok: false, reason: 'invalid_permission' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    // Check if collaborator already exists
    const existing = await db
      .selectFrom('presentation_collaborators')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('user_email', '=', userEmail)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (existing) {
      // If already exists but revoked, reactivate with new permission
      if (existing.revoked_at) {
        const updated = await db
          .updateTable('presentation_collaborators')
          .set({
            permission,
            invited_by: options?.invitedBy || null,
            invited_at: nowIso(),
            revoked_at: null,
            revoked_by: null,
          })
          .where('id', '=', existing.id)
          .returningAll()
          .executeTakeFirst();

        // Invalidate cache for this user
        await invalidatePermission(pid, userEmail, orgId);

        return {
          ok: true,
          collaborator: formatCollaborator(updated),
          reactivated: true,
        };
      }

      // Already an active collaborator
      return { ok: false, reason: 'already_exists' };
    }

    // Create new collaborator
    const row = await db
      .insertInto('presentation_collaborators')
      .values({
        presentation_id: pid,
        organization_id: orgId,
        user_email: userEmail,
        permission,
        invited_by: options?.invitedBy || null,
      })
      .returningAll()
      .executeTakeFirst();

    // Invalidate cache for this user
    await invalidatePermission(pid, userEmail, orgId);

    return {
      ok: true,
      collaborator: formatCollaborator(row),
      isNew: true,
    };
  });
}

/**
 * Remove a collaborator from a presentation (soft delete).
 * @param {string} presentationId - The presentation ID
 * @param {string} userEmail - Email of the collaborator
 * @param {string} [revokedBy] - Email of the person revoking
 * @param {Object} [options] - Options
 * @param {string} [options.message] - Optional revocation message
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result
 */
export async function removeCollaborator(presentationId, userEmail, revokedBy, options, ctx) {
  // Handle backward compatibility: if options is actually ctx (no options passed)
  if (options && !ctx && typeof options.organizationId !== 'undefined') {
    ctx = options;
    options = {};
  }

  const pid = norm(presentationId);
  if (!pid) {
    return { ok: false, reason: 'invalid' };
  }

  const email = normalizeEmail(userEmail);
  if (!email) {
    return { ok: false, reason: 'invalid_email' };
  }

  const message = options?.message || null;

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .updateTable('presentation_collaborators')
      .set({
        revoked_at: nowIso(),
        revoked_by: revokedBy || null,
        revocation_message: message,
      })
      .where('presentation_id', '=', pid)
      .where('user_email', '=', email)
      .where('organization_id', '=', orgId)
      .where('revoked_at', 'is', null)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    // Invalidate cache for this user
    await invalidatePermission(pid, email, orgId);

    return { ok: true };
  });
}

/**
 * Get revoked collaborator info (for showing revocation message).
 * @param {string} presentationId - The presentation ID
 * @param {string} userEmail - The user's email
 * @param {Object} ctx - Context object
 * @returns {Promise<Object|null>} - Revoked collaborator info or null
 */
export async function getRevokedCollaboratorInfo(presentationId, userEmail, ctx) {
  const pid = norm(presentationId);
  const email = normalizeEmail(userEmail);
  if (!pid || !email) return null;

  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .selectFrom('presentation_collaborators')
      .select(['revoked_at', 'revoked_by', 'revocation_message'])
      .where('presentation_id', '=', pid)
      .where('user_email', '=', email)
      .where('organization_id', '=', orgId)
      .where('revoked_at', 'is not', null)
      .orderBy('revoked_at', 'desc')
      .executeTakeFirst();

    if (!row) return null;

    return {
      revokedAt: row.revoked_at,
      revokedBy: row.revoked_by,
      revocationMessage: row.revocation_message || null,
    };
  });
}

/**
 * Update a collaborator's permission.
 * @param {string} presentationId - The presentation ID
 * @param {string} userEmail - Email of the collaborator
 * @param {string} permission - New permission level
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result with updated collaborator
 */
export async function updateCollaboratorPermission(presentationId, userEmail, permission, ctx) {
  const pid = norm(presentationId);
  if (!pid) {
    return { ok: false, reason: 'invalid' };
  }

  const email = normalizeEmail(userEmail);
  if (!email) {
    return { ok: false, reason: 'invalid_email' };
  }

  if (!['view', 'comment', 'edit', 'admin'].includes(permission)) {
    return { ok: false, reason: 'invalid_permission' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .updateTable('presentation_collaborators')
      .set({ permission })
      .where('presentation_id', '=', pid)
      .where('user_email', '=', email)
      .where('organization_id', '=', orgId)
      .where('revoked_at', 'is', null)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    // Invalidate cache for this user
    await invalidatePermission(pid, email, orgId);

    return {
      ok: true,
      collaborator: formatCollaborator(row),
    };
  });
}

/**
 * List all collaborators for a presentation.
 * @param {string} presentationId - The presentation ID
 * @param {Object} ctx - Context object
 * @returns {Promise<Array>} - List of collaborators
 */
export async function listCollaborators(presentationId, ctx) {
  const pid = norm(presentationId);
  if (!pid) return [];

  return withDbGuard([], async (db) => {
    const orgId = getOrgId(ctx);

    const rows = await db
      .selectFrom('presentation_collaborators')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .where('revoked_at', 'is', null)
      .orderBy('invited_at', 'asc')
      .execute();

    return rows.map(formatCollaborator);
  });
}

/**
 * List presentations shared with a user.
 * For the "Shared with me" view.
 * @param {string} userEmail - The user's email
 * @param {Object} ctx - Context object
 * @returns {Promise<Array>} - List of presentations with permission info
 */
export async function listPresentationsSharedWithUser(userEmail, ctx) {
  const email = normalizeEmail(userEmail);
  if (!email) return [];

  return withDbGuard([], async (db) => {
    const orgId = getOrgId(ctx);

    const rows = await db
      .selectFrom('presentation_collaborators as c')
      .innerJoin('presentations as p', 'p.id', 'c.presentation_id')
      .select([
        'p.id',
        'p.title',
        'p.theme',
        'p.scope',
        'p.owner_email',
        'p.created_by',
        'p.updated_by',
        'p.created_at',
        'p.modified_at',
        'c.permission',
        'c.invited_by',
        'c.invited_at',
      ])
      .where('c.user_email', '=', email)
      .where('c.organization_id', '=', orgId)
      .where('c.revoked_at', 'is', null)
      .where('p.trashed_at', 'is', null) // Exclude trashed presentations
      .orderBy('c.invited_at', 'desc')
      .execute();

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      theme: row.theme,
      scope: row.scope,
      ownerEmail: row.owner_email,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      createdAt: row.created_at,
      updatedAt: row.modified_at,
      // Collaboration-specific fields
      permission: row.permission,
      sharedBy: row.invited_by,
      sharedAt: row.invited_at,
    }));
  });
}

/**
 * Get the collaborator permission for a specific user on a presentation.
 * Uses cache to reduce database queries.
 * @param {string} presentationId - The presentation ID
 * @param {string} userEmail - The user's email
 * @param {Object} ctx - Context object
 * @returns {Promise<string|null>} - Permission level or null
 */
export async function getCollaboratorPermission(presentationId, userEmail, ctx) {
  const pid = norm(presentationId);
  const email = normalizeEmail(userEmail);
  if (!pid || !email) return null;

  const orgId = getOrgId(ctx);

  // Check cache first
  const cached = await getCachedPermission(pid, email, orgId);
  if (cached !== undefined) {
    return cached;
  }

  // Cache miss - fetch from database
  const permission = await withDbGuard(null, async (db) => {
    const row = await db
      .selectFrom('presentation_collaborators')
      .select('permission')
      .where('presentation_id', '=', pid)
      .where('user_email', '=', email)
      .where('organization_id', '=', orgId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();

    return row?.permission || null;
  });

  // Cache the result (including null for "no permission")
  await setCachedPermission(pid, email, orgId, permission);

  return permission;
}

/**
 * Check if a user is a collaborator on a presentation.
 * @param {string} presentationId - The presentation ID
 * @param {string} userEmail - The user's email
 * @param {Object} ctx - Context object
 * @returns {Promise<boolean>}
 */
export async function isCollaborator(presentationId, userEmail, ctx) {
  const permission = await getCollaboratorPermission(presentationId, userEmail, ctx);
  return !!permission;
}

/**
 * Remove all collaborators from a presentation.
 * Used when deleting a presentation (though CASCADE should handle it).
 * @param {string} presentationId - The presentation ID
 * @param {string} [revokedBy] - Email of the person revoking
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result with count
 */
export async function removeAllCollaborators(presentationId, revokedBy, ctx) {
  const pid = norm(presentationId);
  if (!pid) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    const result = await db
      .updateTable('presentation_collaborators')
      .set({
        revoked_at: nowIso(),
        revoked_by: revokedBy || null,
      })
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();

    // Invalidate all cached permissions for this presentation
    await invalidatePresentationPermissions(pid, orgId);

    return {
      ok: true,
      count: Number(result.numUpdatedRows) || 0,
    };
  });
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Format a database row into a collaborator object.
 * @param {Object} row - Database row
 * @returns {Object} - Formatted collaborator
 */
function formatCollaborator(row) {
  return {
    id: row.id,
    presentationId: row.presentation_id,
    userEmail: row.user_email,
    permission: row.permission,
    invitedBy: row.invited_by,
    invitedAt: row.invited_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
  };
}