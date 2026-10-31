/**
 * Slide-library links storage (B904, D223): which decks hold a copy of which
 * library item, and at which revision.
 *
 * The truth is the deck JSON (`slide.libraryRef`, shared/slide-library/
 * library-ref.js); this table is its index, rebuilt as a set on every deck
 * write that touches slides, so an item save can find the decks to notify
 * without reading every deck. See migration 106.
 *
 * `replaceLibraryLinks` runs inside the presentations facade's deck write,
 * with the context that write already holds; `listDecksBehindLibraryItem`
 * serves the item save.
 */

import { getDb } from '../db/client.js';
import { getOrgId } from '../utils/context.js';
import { toStorageContext } from './scope.js';
import { libraryLinksOf } from '../../shared/slide-library/library-ref.js';

/**
 * Rebuild one deck's link rows from the refs its slides carry.
 * @param {import('./scope.js').StorageScope} scope - the deck write's context
 * @param {object} pres - the stored presentation, as just written
 * @returns {Promise<number>} rows written
 */
export async function replaceLibraryLinks(scope, pres) {
  const ctx = toStorageContext(scope, 'replaceLibraryLinks');
  const orgId = getOrgId(ctx);
  const presentationId = String(pres?.id || '');
  if (!orgId || !presentationId) return 0;
  const links = libraryLinksOf(pres);
  const db = getDb();
  await db
    .deleteFrom('slide_library_links')
    .where('presentation_id', '=', presentationId)
    .execute();
  if (!links.length) return 0;
  await db
    .insertInto('slide_library_links')
    .values(
      links.map((l) => ({
        presentation_id: presentationId,
        slide_id: l.slideId,
        organization_id: orgId,
        item_id: l.itemId,
        revision: l.revision,
        ignored_revision: l.ignoredRevision,
      })),
    )
    .execute();
  return links.length;
}

/**
 * The live decks with a copy of `itemId` older than `itemRevision` that has
 * not ignored it: who a new revision is news for. One entry per deck, with
 * the linked slides in it.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} itemId
 * @param {number} itemRevision - the item's revision after the save
 * @returns {Promise<Array<{presentationId: string, title: string, ownerEmail: string|null, slideIds: string[]}>>}
 */
export async function listDecksBehindLibraryItem(scope, itemId, itemRevision) {
  const ctx = toStorageContext(scope, 'listDecksBehindLibraryItem');
  if (!itemId || !Number.isInteger(itemRevision)) return [];
  const rows = await getDb()
    .selectFrom('slide_library_links as l')
    .innerJoin('presentations as p', 'p.id', 'l.presentation_id')
    .select(['l.presentation_id', 'l.slide_id', 'p.title', 'p.owner_email'])
    .where('l.organization_id', '=', getOrgId(ctx))
    .where('l.item_id', '=', itemId)
    .where('l.revision', '<', itemRevision)
    .where((eb) =>
      eb.or([
        eb('l.ignored_revision', 'is', null),
        eb('l.ignored_revision', '<', itemRevision),
      ]),
    )
    .where('p.trashed_at', 'is', null)
    .orderBy('l.presentation_id')
    .orderBy('l.slide_id')
    .execute();
  const byDeck = new Map();
  for (const r of rows) {
    let deck = byDeck.get(r.presentation_id);
    if (!deck) {
      deck = {
        presentationId: r.presentation_id,
        title: r.title || '',
        ownerEmail: r.owner_email || null,
        slideIds: [],
      };
      byDeck.set(r.presentation_id, deck);
    }
    deck.slideIds.push(r.slide_id);
  }
  return [...byDeck.values()];
}
