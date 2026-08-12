/**
 * Storage functions for presentation ownership operations.
 */

import { getPresentation, updatePresentation } from './index.js';
import { addCollaborator, removeCollaborator } from '../collaborators.js';
import { toStorageContext } from '../backend-dispatch.js';
import { normalizeEmail } from '../../utils/normalize.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('ownership');

/**
 * Transfer ownership of a presentation to another user.
 *
 * @param {import('../scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} presentationId - The presentation ID
 * @param {Object} options - Transfer options
 * @param {string} options.newOwnerEmail - Email of the new owner
 * @param {string} options.previousOwnerEmail - Email of the previous owner
 * @param {boolean} [options.keepAsCollaborator=true] - Whether to add old owner as collaborator
 * @param {string} [options.actorEmail] - Email of the user performing the transfer
 * @returns {Promise<Object>} - Result with updated presentation
 */
export async function transferPresentationOwnership(scope, presentationId, options) {
  toStorageContext(scope, 'transferPresentationOwnership');
  const newOwnerEmail = normalizeEmail(options?.newOwnerEmail);
  const previousOwnerEmail = normalizeEmail(options?.previousOwnerEmail);
  const keepAsCollaborator = options?.keepAsCollaborator !== false;
  const actorEmail = options?.actorEmail || null;

  if (!newOwnerEmail) {
    return { ok: false, reason: 'invalid_new_owner' };
  }

  // Get current presentation
  const pres = await getPresentation(scope, presentationId);
  if (!pres) {
    return { ok: false, reason: 'not_found' };
  }

  // Update the presentation with new owner
  const updates = {
    ownerEmail: newOwnerEmail,
  };

  let updated;
  try {
    updated = await updatePresentation(scope, presentationId, updates, {
      actorEmail,
      reason: 'ownership_transfer',
      // Open the owner-write gate: the adapter otherwise drops `ownerEmail` on
      // an update (mirroring allowVisibilityChange). Without this the transfer
      // returned ok but persisted nothing — the bug this fixes.
      allowOwnerChange: true,
    });
  } catch (err) {
    log.error('[ownership] Failed to update presentation:', err);
    return { ok: false, reason: 'update_failed' };
  }

  // Remove new owner from collaborators if they were one
  try {
    await removeCollaborator(presentationId, newOwnerEmail, actorEmail);
  } catch {
    // Ignore - they may not have been a collaborator
  }

  // Optionally add previous owner as collaborator
  let collaboratorAdded = false;
  if (keepAsCollaborator && previousOwnerEmail && previousOwnerEmail !== newOwnerEmail) {
    try {
      const result = await addCollaborator(presentationId, {
        userEmail: previousOwnerEmail,
        permission: 'edit', // Previous owners get edit access
        invitedBy: actorEmail,
      });
      collaboratorAdded = result.ok;
    } catch (err) {
      log.error('[ownership] Failed to add previous owner as collaborator:', err);
      // Non-fatal - ownership transfer still succeeded
    }
  }

  return {
    ok: true,
    presentation: updated,
    collaboratorAdded,
  };
}
