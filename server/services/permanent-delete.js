/**
 * Permanently deleting a presentation — the one seam that ends a deck for
 * good.
 *
 * Ending a deck is two things in two places: the database record (whose
 * dependants ride `ON DELETE CASCADE`) and the rasters on disk (which cascade
 * nothing). Until B330 the first lived in the storage facade and the second
 * sat loose in the HTTP handler, which was survivable while a human pressing
 * "Delete permanently" was the only caller. It stops being survivable the
 * moment a second caller exists: the retention sweep would either repeat the
 * raster cleanup or quietly leak it, and "the sweep does something else than
 * the button" is precisely the defect this module exists to make impossible.
 *
 * So both callers come through here, and neither knows the steps.
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
 * @param {Object} options
 * @param {string} options.repoRoot - Repository root, for the thumbnail cache.
 * @param {import('../storage/scope.js').StorageScope} options.storageScope -
 *   The organization the deck lives in. Always organization-scoped: this is a
 *   write, and a write may not be cross-organization.
 * @param {string} options.id - Presentation id.
 * @returns {Promise<{ok: true}|{ok: false, reason: string}>}
 *   `not_found` when no deck with that id lives in this organization,
 *   `not_trashed` when it does but is not in the trash.
 */
export async function permanentlyDeletePresentation({
  repoRoot,
  storageScope,
  id,
}) {
  const result = await deletePresentationRecord(storageScope, id);
  if (!result.ok) return result;

  // The deck's rasters outlive nothing: this is the only path that ends a
  // presentation for good, so it is the only place they can be cleaned up.
  // Trashing deliberately does not — a card in the trash still shows its
  // thumbnail, and a restore must not come back blank.
  await pruneDeckThumbnails(repoRoot, id);

  return { ok: true };
}
