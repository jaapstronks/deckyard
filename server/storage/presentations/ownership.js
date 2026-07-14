/**
 * Storage functions for presentation ownership operations.
 */

import { getPresentation, updatePresentation } from '../presentations.js';
import { addCollaborator, removeCollaborator } from '../collaborators.js';
import { normalizeEmail } from '../../utils/normalize.js';

/**
 * Transfer ownership of a presentation to another user.
 *
 * @param {string} repoRoot - Repository root path
 * @param {string} presentationId - The presentation ID
 * @param {Object} options - Transfer options
 * @param {string} options.newOwnerEmail - Email of the new owner
 * @param {string} options.previousOwnerEmail - Email of the previous owner
 * @param {boolean} [options.keepAsCollaborator=true] - Whether to add old owner as collaborator
 * @param {string} [options.actorEmail] - Email of the user performing the transfer
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result with updated presentation
 */
export async function transferPresentationOwnership(
  repoRoot,
  presentationId,
  options,
  ctx
) {
  const newOwnerEmail = normalizeEmail(options?.newOwnerEmail);
  const previousOwnerEmail = normalizeEmail(options?.previousOwnerEmail);
  const keepAsCollaborator = options?.keepAsCollaborator !== false;
  const actorEmail = options?.actorEmail || null;

  if (!newOwnerEmail) {
    return { ok: false, reason: 'invalid_new_owner' };
  }

  // Get current presentation
  const pres = await getPresentation(repoRoot, presentationId);
  if (!pres) {
    return { ok: false, reason: 'not_found' };
  }

  // Update the presentation with new owner
  const updates = {
    ownerEmail: newOwnerEmail,
  };

  let updated;
  try {
    updated = await updatePresentation(repoRoot, presentationId, updates, {
      actorEmail,
      reason: 'ownership_transfer',
    });
  } catch (err) {
    console.error('[ownership] Failed to update presentation:', err);
    return { ok: false, reason: 'update_failed' };
  }

  // Remove new owner from collaborators if they were one
  try {
    await removeCollaborator(presentationId, newOwnerEmail, actorEmail, ctx);
  } catch {
    // Ignore - they may not have been a collaborator
  }

  // Optionally add previous owner as collaborator
  let collaboratorAdded = false;
  if (keepAsCollaborator && previousOwnerEmail && previousOwnerEmail !== newOwnerEmail) {
    try {
      const result = await addCollaborator(
        presentationId,
        {
          userEmail: previousOwnerEmail,
          permission: 'edit', // Previous owners get edit access
          invitedBy: actorEmail,
        },
        ctx
      );
      collaboratorAdded = result.ok;
    } catch (err) {
      console.error('[ownership] Failed to add previous owner as collaborator:', err);
      // Non-fatal - ownership transfer still succeeded
    }
  }

  return {
    ok: true,
    presentation: updated,
    collaboratorAdded,
  };
}