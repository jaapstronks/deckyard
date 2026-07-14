/**
 * CRUD helper functions - validation, error creation, and merge utilities.
 */

import { normalizePresentationScope } from '../../../utils/presentation-authz.js';
import { normalizeEmail } from '../../../utils/normalize.js';
import { ConflictError, LockedError } from '../../../utils/errors.js';

/**
 * Normalize presentation metadata.
 */
export function normalizeMeta(pres) {
  if (!pres || typeof pres !== 'object') return pres;
  pres.scope = normalizePresentationScope(pres.scope);
  const rev = Number(pres.revision);
  pres.revision = Number.isFinite(rev) && rev > 0 ? Math.floor(rev) : 1;

  // Keep ownerEmail as-is (legacy auth field).
  const owner = normalizeEmail(pres.ownerEmail);
  pres.ownerEmail = owner || null;

  const createdBy = normalizeEmail(pres.createdBy) || owner;
  pres.createdBy = createdBy || null;
  const updatedBy = normalizeEmail(pres.updatedBy) || createdBy || owner;
  pres.updatedBy = updatedBy || null;

  return pres;
}

/**
 * Create a conflict error with revision details.
 */
export function conflictError(existing) {
  return new ConflictError(
    'Conflict: presentation was updated by someone else. Reload and try again.',
    {
      id: existing?.id,
      revision: existing?.revision,
      modified: existing?.modified,
      updatedBy: existing?.updatedBy || null,
    }
  );
}

/**
 * Create a locked error with lock holder details.
 */
export function lockedError(lock) {
  return new LockedError('Presentation is locked by another user.', {
    holderEmail: lock?.holderEmail,
    holderName: lock?.holderName,
    acquiredAt: lock?.acquiredAt,
  });
}

/**
 * Check if enforced locks are enabled.
 */
export function useEnforcedLocks() {
  return process.env.USE_DB_LOCKS === 'true';
}

/**
 * Merge slides from two versions at the slide level.
 * Used for concurrent editing: if user A edited slide 1 and user B edited slide 2,
 * both changes can be preserved without conflict.
 *
 * @param {Object} options - Merge options
 * @param {Array} options.serverSlides - Current slides on server
 * @param {Array} options.clientSlides - Slides from client
 * @param {Array} options.modifiedSlideIds - IDs of slides the client modified
 * @returns {Object} { merged: boolean, slides: Array, conflicts: Array }
 */
export function mergeSlidesAtSlideLevel({ serverSlides, clientSlides, modifiedSlideIds }) {
  const serverById = new Map();
  const clientById = new Map();
  const modifiedSet = new Set(modifiedSlideIds || []);

  for (const s of serverSlides || []) {
    if (s?.id) serverById.set(s.id, s);
  }
  for (const s of clientSlides || []) {
    if (s?.id) clientById.set(s.id, s);
  }

  const conflicts = [];
  const mergedSlides = [];
  const seenIds = new Set();

  // Process in client's order (preserves reordering by this client)
  for (const clientSlide of clientSlides || []) {
    const id = clientSlide?.id;
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);

    const serverSlide = serverById.get(id);

    if (!serverSlide) {
      // Slide only exists in client (newly added by this client)
      mergedSlides.push(clientSlide);
    } else if (modifiedSet.has(id)) {
      // Client modified this slide - use client's version
      mergedSlides.push(clientSlide);
    } else {
      // Client didn't modify - use server's version (may have been changed by others)
      mergedSlides.push(serverSlide);
    }
  }

  // Add any slides from server that aren't in client's version
  // (slides added by other users)
  for (const serverSlide of serverSlides || []) {
    const id = serverSlide?.id;
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);

    // Slide exists on server but not in client
    // Check if client intentionally deleted it (was in modifiedSlideIds but not in clientSlides)
    // For now, we'll preserve server slides that client never touched
    // This means deletions need to be tracked separately (modifiedSlideIds includes deleted)
    const wasInClient = clientById.has(id);
    if (!wasInClient) {
      // Client never had this slide - it was added by another user, include it
      mergedSlides.push(serverSlide);
    }
    // If client had it but removed it, it's intentionally deleted - don't add back
  }

  return {
    merged: true,
    slides: mergedSlides,
    conflicts,
  };
}
