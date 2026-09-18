/**
 * Permanently deleting a presentation — the one seam that ends a deck for
 * good.
 *
 * Ending a deck is two things in two places: the database record (whose
 * dependants ride `ON DELETE CASCADE`) and the rasters on disk (which cascade
 * nothing). Both callers — the "Delete permanently" button and the retention
 * sweep — come through here, and neither knows the steps, so the two cannot
 * do different things to the same deck.
 */

import { deletePresentationRecord } from '../storage/presentations/index.js';
import { pruneDeckThumbnails } from '../render/deck-thumbnail.js';

/**
 * Permanently delete a trashed presentation: its record and its rasters.
 *
 * Refuses a deck that is not in the trash. Permanent deletion is the second
 * step of trashing, never a shortcut past it, so a caller that hands over a
 * live deck gets `not_trashed` rather than a silently erased presentation.
 *
 * A caller that selected the deck against a deadline passes that deadline as
 * `trashedBefore`; the record delete then re-checks it atomically and answers
 * `not_due` if the deck was trashed again in between. Nothing is pruned on a
 * refusal, so such a deck keeps its rasters along with its fresh window.
 *
 * @param {Object} options
 * @param {string} options.repoRoot - Repository root, for the thumbnail cache.
 * @param {import('../storage/scope.js').StorageScope} options.storageScope -
 *   The organization the deck lives in. Always organization-scoped: this is a
 *   write, and a write may not be cross-organization.
 * @param {string} options.id - Presentation id.
 * @param {string} [options.trashedBefore] - ISO timestamp; only delete a deck
 *   trashed at or before it.
 * @returns {Promise<{ok: true}|{ok: false, reason: string}>}
 *   `not_found` when no deck with that id lives in this organization,
 *   `not_trashed` when it does but is not in the trash, `not_due` when it is
 *   trashed but after `trashedBefore`.
 */
export async function permanentlyDeletePresentation({
  repoRoot,
  storageScope,
  id,
  trashedBefore,
}) {
  const result = await deletePresentationRecord(storageScope, id, {
    trashedBefore,
  });
  if (!result.ok) return result;

  // The deck's rasters outlive nothing: this is the only path that ends a
  // presentation for good, so it is the only place they can be cleaned up.
  // Trashing deliberately does not — a card in the trash still shows its
  // thumbnail, and a restore must not come back blank.
  await pruneDeckThumbnails(repoRoot, id);

  return { ok: true };
}
