/**
 * CRUD helper functions - validation, error creation, and merge utilities.
 */

import { normalizePresentationScope } from '../../../utils/presentation-authz.js';
import { normalizeEmail } from '../../../utils/normalize.js';
import { ConflictError, LockedError } from '../../../utils/errors.js';
import { slideFingerprint } from '../../../../shared/slide-fingerprint.js';

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

// The slide-level merge exists for seconds-to-minutes concurrent editing.
// Beyond this many revisions of staleness the client's copy is too old to
// merge safely (its order and unmodified slides no longer mean anything), so
// the save falls back to a plain 409 and the editor's reload flow.
const DEFAULT_MERGE_MAX_REVISION_GAP = 10;

/**
 * Maximum client staleness (in revisions) the slide-level merge accepts.
 * Override with MERGE_MAX_REVISION_GAP.
 * @returns {number}
 */
export function mergeMaxRevisionGap() {
  const n = Number(process.env.MERGE_MAX_REVISION_GAP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MERGE_MAX_REVISION_GAP;
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
 * @param {Object|null} [options.baseFingerprints] - Per-slide fingerprints of the
 *   client's base version (id → hash, see shared/slide-fingerprint.js). When a
 *   modified slide's server version no longer matches its base fingerprint,
 *   both sides changed it and the slide is reported in `conflicts` instead of
 *   silently letting the client win.
 * @param {number} [options.revisionGap] - How many revisions the client is
 *   behind the server. Beyond mergeMaxRevisionGap() the merge is refused
 *   (`merged: false`) so the caller falls back to a plain revision conflict.
 * @param {boolean|null} [options.clientReordered] - Whether the client
 *   actually reordered slides since its base (X-Slides-Order-Changed).
 *   `false` keeps the server's slide order authoritative; `true` or `null`
 *   (legacy client, no signal) applies the client's order as before.
 * @returns {Object} { merged: boolean, slides: Array|null, conflicts: Array,
 *   appendedSlideIds: Array } — appendedSlideIds are server-side slides the
 *   client didn't know about that were carried into the result.
 */
export function mergeSlidesAtSlideLevel({
  serverSlides,
  clientSlides,
  modifiedSlideIds,
  baseFingerprints = null,
  revisionGap = 0,
  clientReordered = null,
}) {
  const gap = Math.abs(Number(revisionGap) || 0);
  if (gap > mergeMaxRevisionGap()) {
    return { merged: false, slides: null, conflicts: [], appendedSlideIds: [] };
  }

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
  const appendedSlideIds = [];
  const mergedSlides = [];
  const seenIds = new Set();

  // For a client-modified slide, decide which version wins. With a base
  // fingerprint that no longer matches the server's current version, both
  // sides changed it since the client's base: a true conflict — keep the
  // server version and report it. Without a fingerprint (legacy client) or
  // with a matching base, the client wins.
  const resolveModified = (clientSlide, serverSlide) => {
    const baseFp =
      baseFingerprints && typeof baseFingerprints === 'object'
        ? baseFingerprints[clientSlide.id]
        : null;
    if (typeof baseFp === 'string' && baseFp && slideFingerprint(serverSlide) !== baseFp) {
      conflicts.push(clientSlide.id);
      return serverSlide;
    }
    return clientSlide;
  };

  if (clientReordered === false) {
    // The client did not reorder: the server's slide order is authoritative.
    // Walk the server slides, swapping in client content where the client
    // modified a slide; server-side slides the client doesn't know stay at
    // their server position instead of being appended.
    for (const serverSlide of serverSlides || []) {
      const id = serverSlide?.id;
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      const clientSlide = clientById.get(id);
      if (clientSlide && modifiedSet.has(id)) {
        mergedSlides.push(resolveModified(clientSlide, serverSlide));
      } else {
        // Unmodified by the client, or absent from the client's copy
        // (server-new, or client-deleted — indistinguishable here; kept,
        // matching the client-order path below).
        mergedSlides.push(serverSlide);
        if (!clientSlide) appendedSlideIds.push(id);
      }
    }
    // Client-new slides keep their position relative to their neighbours:
    // insert after the nearest preceding client slide that made it into the
    // merged result (start of the deck when there is none). A run of new
    // slides stays together in its own order.
    let anchor = -1;
    for (const clientSlide of clientSlides || []) {
      const id = clientSlide?.id;
      if (!id) continue;
      if (seenIds.has(id)) {
        const idx = mergedSlides.findIndex((s) => s?.id === id);
        if (idx !== -1) anchor = idx;
        continue;
      }
      seenIds.add(id);
      anchor += 1;
      mergedSlides.splice(anchor, 0, clientSlide);
    }
  } else {
    // Client reordered (or legacy client without the order signal): process
    // in the client's order so its reordering is preserved.
    for (const clientSlide of clientSlides || []) {
      const id = clientSlide?.id;
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);

      const serverSlide = serverById.get(id);
      if (!serverSlide) {
        // Slide only exists in client (newly added by this client)
        mergedSlides.push(clientSlide);
      } else if (modifiedSet.has(id)) {
        mergedSlides.push(resolveModified(clientSlide, serverSlide));
      } else {
        // Client didn't modify - use server's version (may have been changed by others)
        mergedSlides.push(serverSlide);
      }
    }

    // Slides only the server knows (added by other users) are preserved;
    // with the client's order authoritative there is no anchor to place
    // them by, so they go at the end.
    for (const serverSlide of serverSlides || []) {
      const id = serverSlide?.id;
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      mergedSlides.push(serverSlide);
      appendedSlideIds.push(id);
    }
  }

  return {
    merged: true,
    slides: mergedSlides,
    conflicts,
    appendedSlideIds,
  };
}
