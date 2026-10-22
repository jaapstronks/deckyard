/**
 * Storage layer for presentation collaborators.
 * Enables organization members to collaborate on presentations with specific permissions.
 *
 * Every operation validates the caller's organization against the deck row,
 * before reading a cache or collaborator row. A cross-organization collaborator
 * carries the loaded deck's organization at the caller boundary, never a
 * guessed default. Writes stamp the deck's organization; legacy collaborator
 * stamps are not an authorization source.
 */

import { toStorageContext } from './scope.js';
import { norm, nowIso } from '../utils/normalize.js';
import { normalizeEmail } from '../../shared/email.js';
import { withDbGuard } from '../db/client.js';
import { isValidPermission } from '../../shared/constants/permissions.js';
import { resolveIdentityByEmail } from './identity-resolver.js';
import {
  getCachedPermission,
  setCachedPermission,
  invalidatePermission,
} from './cache/permission-cache.js';

/**
 * Read the organization a presentation belongs to.
 *
 * This is the write path's single source of truth for the `organization_id`
 * stamp on a collaborator row. It deliberately does not fall back to a session
 * org or the default organization: a deck that is not there cannot be shared,
 * and inventing a scope is exactly the failure this module removed.
 *
 * @param {import('kysely').Kysely<any>} db - Database handle
 * @param {string} presentationId - The presentation ID
 * @returns {Promise<string|null>} - The deck's organization ID, or null if the deck is gone
 */
async function readPresentationOrgId(db, presentationId, organizationId) {
  const row = await db
    .selectFrom('presentations')
    .select('organization_id')
    .where('id', '=', presentationId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();

  return row?.organization_id || null;
}

// ============================================================
// COLLABORATOR CRUD
// ============================================================

/**
 * Add a collaborator to a presentation.
 *
 * The row is stamped with the *deck's* organization, not the inviter's session
 * organization — see the module header. An inviter acting from another
 * organization therefore produces a row the deck's own authorization reads can
 * find, instead of a silently inert one.
 *
 * @param {import('./scope.js').StorageScope} scope - Caller authorization scope.
 * @param {string} presentationId - The presentation ID
 * @param {Object} options - Collaborator options
 * @param {string} options.userEmail - Email of the user to add
 * @param {string} options.permission - 'view' | 'comment' | 'edit' | 'admin'
 * @param {string} [options.invitedBy] - Email of the inviter
 * @returns {Promise<Object>} - Result with collaborator
 */
export async function addCollaborator(scope, presentationId, options) {
  const context = toStorageContext(scope, 'addCollaborator');
  const pid = norm(presentationId);
  if (!pid) {
    return { ok: false, reason: 'invalid' };
  }

  const userEmail = normalizeEmail(options?.userEmail);
  if (!userEmail || !userEmail.includes('@')) {
    return { ok: false, reason: 'invalid', field: 'email' };
  }

  const permission = options?.permission;
  if (!isValidPermission(permission)) {
    return { ok: false, reason: 'invalid', field: 'permission' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = await readPresentationOrgId(db, pid, context.organizationId);
    if (!orgId) {
      return { ok: false, reason: 'not_found' };
    }

    // Dual-key (T10 PR 2): write the stable user_id alongside the email via the
    // resolver. A known user maps to their users.id; an external collaborator
    // (no users row) resolves `external` and stays NULL — the pinned path that
    // must keep working. Reads still key on the email; this only populates the
    // column a later PR will move the ACL reads onto.
    const resolution = await resolveIdentityByEmail(scope, userEmail);
    const userId = resolution?.userId ?? null;

    // Check if collaborator already exists. `(presentation_id, user_email)` is
    // unique, so this is the whole key — see the module header.
    const existing = await db
      .selectFrom('presentation_collaborators')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('user_email', '=', userEmail)
      .executeTakeFirst();

    if (existing) {
      // If already exists but revoked, reactivate with new permission
      if (existing.revoked_at) {
        const updated = await db
          .updateTable('presentation_collaborators')
          .set({
            // Re-stamp the deck's org: a row written before this rule existed
            // may still carry the inviter's session org.
            organization_id: orgId,
            permission,
            user_id: userId,
            invited_by: options?.invitedBy || null,
            invited_at: nowIso(),
            revoked_at: null,
            revoked_by: null,
          })
          .where('id', '=', existing.id)
          .returningAll()
          .executeTakeFirst();

        // Invalidate cache for this user
        await invalidatePermission(pid, userEmail);

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
        user_id: userId,
        permission,
        invited_by: options?.invitedBy || null,
      })
      .returningAll()
      .executeTakeFirst();

    // Invalidate cache for this user
    await invalidatePermission(pid, userEmail);

    return {
      ok: true,
      collaborator: formatCollaborator(row),
      isNew: true,
    };
  });
}

/**
 * Remove a collaborator from a presentation (soft delete).
 * @param {import('./scope.js').StorageScope} scope - Caller authorization scope.
 * @param {string} presentationId - The presentation ID
 * @param {string} userEmail - Email of the collaborator
 * @param {string} [revokedBy] - Email of the person revoking
 * @param {Object} [options] - Options
 * @param {string} [options.message] - Optional revocation message
 * @returns {Promise<Object>} - Result
 */
export async function removeCollaborator(
  scope,
  presentationId,
  userEmail,
  revokedBy,
  options,
) {
  const context = toStorageContext(scope, 'removeCollaborator');
  const pid = norm(presentationId);
  if (!pid) {
    return { ok: false, reason: 'invalid' };
  }

  const email = normalizeEmail(userEmail);
  if (!email) {
    return { ok: false, reason: 'invalid', field: 'email' };
  }

  const message = options?.message || null;

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    if (!(await readPresentationOrgId(db, pid, context.organizationId)))
      return { ok: false, reason: 'not_found' };
    const row = await db
      .updateTable('presentation_collaborators')
      .set({
        revoked_at: nowIso(),
        revoked_by: revokedBy || null,
        revocation_message: message,
      })
      .where('presentation_id', '=', pid)
      .where('user_email', '=', email)
      .where('revoked_at', 'is', null)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    // Invalidate cache for this user
    await invalidatePermission(pid, email);

    // Return the revoked row so `revocation_message` reaches the response — the
    // field was written here and read nowhere, unlike the share-link path which
    // hands its revocation message to the denied accessor.
    return { ok: true, collaborator: formatCollaborator(row) };
  });
}

/**
 * Update a collaborator's permission.
 * @param {import('./scope.js').StorageScope} scope - Caller authorization scope.
 * @param {string} presentationId - The presentation ID
 * @param {string} userEmail - Email of the collaborator
 * @param {string} permission - New permission level
 * @returns {Promise<Object>} - Result with updated collaborator
 */
export async function updateCollaboratorPermission(
  scope,
  presentationId,
  userEmail,
  permission,
) {
  const context = toStorageContext(scope, 'updateCollaboratorPermission');
  const pid = norm(presentationId);
  if (!pid) {
    return { ok: false, reason: 'invalid' };
  }

  const email = normalizeEmail(userEmail);
  if (!email) {
    return { ok: false, reason: 'invalid', field: 'email' };
  }

  if (!isValidPermission(permission)) {
    return { ok: false, reason: 'invalid', field: 'permission' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    if (!(await readPresentationOrgId(db, pid, context.organizationId)))
      return { ok: false, reason: 'not_found' };
    const row = await db
      .updateTable('presentation_collaborators')
      .set({ permission })
      .where('presentation_id', '=', pid)
      .where('user_email', '=', email)
      .where('revoked_at', 'is', null)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    // Invalidate cache for this user
    await invalidatePermission(pid, email);

    return {
      ok: true,
      collaborator: formatCollaborator(row),
    };
  });
}

/**
 * List all collaborators for a presentation.
 * @param {import('./scope.js').StorageScope} scope - Caller authorization scope.
 * @param {string} presentationId - The presentation ID
 * @returns {Promise<Array>} - List of collaborators
 */
export async function listCollaborators(scope, presentationId) {
  const context = toStorageContext(scope, 'listCollaborators');
  const pid = norm(presentationId);
  if (!pid) return [];

  return withDbGuard([], async (db) => {
    if (!(await readPresentationOrgId(db, pid, context.organizationId)))
      return [];
    const rows = await db
      .selectFrom('presentation_collaborators')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('revoked_at', 'is', null)
      .orderBy('invited_at', 'asc')
      .execute();

    return rows.map(formatCollaborator);
  });
}

/**
 * Get the collaborator permission for a specific user on a presentation.
 * Uses cache to reduce database queries.
 *
 * Answers "what does this email hold on this deck", not "may this session see
 * this deck" — the caller has already settled the second question by loading
 * the presentation on its own storage scope. That is why there is no context
 * that decision here. The scope is checked against the stored deck organization
 * before consulting the shared permission cache or the collaborator row.
 *
 * @param {import('./scope.js').StorageScope} scope - Caller authorization scope.
 * @param {string} presentationId - The presentation ID
 * @param {string} userEmail - The user's email
 * @returns {Promise<string|null>} - Permission level or null
 */
export async function getCollaboratorPermission(
  scope,
  presentationId,
  userEmail,
) {
  const context = toStorageContext(scope, 'getCollaboratorPermission');
  const pid = norm(presentationId);
  const email = normalizeEmail(userEmail);
  if (!pid || !email) return null;

  const deckOrgId = await withDbGuard(null, (db) =>
    readPresentationOrgId(db, pid, context.organizationId),
  );
  if (!deckOrgId) return null;

  // Check cache first
  const cached = await getCachedPermission(pid, email);
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
      .where('revoked_at', 'is', null)
      .executeTakeFirst();

    return row?.permission || null;
  });

  // Cache the result (including null for "no permission")
  await setCachedPermission(pid, email, permission);

  return permission;
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
    revocationMessage: row.revocation_message ?? null,
  };
}
