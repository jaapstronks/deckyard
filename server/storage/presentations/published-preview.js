/**
 * Targeted write that forgets a deck's withdrawn OG preview URL.
 *
 * When the proof behind a published preview expires, the public seams stop
 * advertising the image and the publish service withdraws the object from its
 * origin (B806). The URL stored on the deck's `published` column then names
 * nothing, so it is blanked; otherwise every read would decide the generic
 * card again.
 *
 * This is not an edit of the deck and must not look like one: it runs on a
 * public read, so it neither bumps `revision` (an open editor's next save
 * would answer a conflict) nor `modified_at` (the feed would re-date the
 * entry), and it stamps no actor. It only lands on the revision the caller
 * read, so a publish or edit in between keeps its own `published` value;
 * the next read decides again.
 *
 * @module server/storage/presentations/published-preview
 */

import { getDb } from '../../db/client.js';
import { getOrgId } from '../../utils/context.js';
import { toStorageContext } from '../scope.js';
import { invalidatePresentationCache } from './cache.js';

/**
 * Blank `published.ogImageUrl` on the deck when it still holds `expectedUrl`.
 *
 * @param {import('../scope.js').StorageScope} scope - Organization-scoped: this
 *   is a write, so derive the organization from the deck a public token
 *   addressed (`presentation.organizationId`).
 * @param {Object} presentation - The stored deck, as `getPresentation` answers it.
 * @param {string} expectedUrl - The URL the caller saw expire.
 * @returns {Promise<boolean>} true when the column was written
 */
export async function clearPublishedOgImageUrl(
  scope,
  presentation,
  expectedUrl,
) {
  const ctx = toStorageContext(scope, 'clearPublishedOgImageUrl');
  const published = presentation?.published;
  if (
    !expectedUrl ||
    !published ||
    typeof published !== 'object' ||
    published.ogImageUrl !== expectedUrl
  ) {
    return false;
  }

  const next = JSON.stringify({ ...published, ogImageUrl: '' });
  const result = await getDb()
    .updateTable('presentations')
    .set({ published: next })
    .where('id', '=', presentation.id)
    .where('organization_id', '=', getOrgId(ctx))
    .where('revision', '=', presentation.revision)
    .executeTakeFirst();

  const written = Number(result?.numUpdatedRows ?? 0) > 0;
  if (written) invalidatePresentationCache(presentation.id);
  return written;
}
