/**
 * The fields a custom slide type update takes away, and the stored content
 * that still carries them (B849).
 *
 * Every write refuses a content key its type does not declare (D359,
 * `unknown_field`). A custom type declares its keys in `fields`, so removing
 * a field from it turns every stored slide of that type that carries the key
 * into a slide the next save refuses: the type update succeeded, the deck
 * became unsaveable. Migration 102 stripped what was stray on the day it ran;
 * it cannot see a field removed afterwards.
 *
 * So a field removal is treated like the delete of a type in use (B414): the
 * update counts where the removed keys are stored and refuses with
 * `field_in_use` and that count, and `force` is the explicit second step that
 * strips them, in the same transaction as the type update. D360 says stored
 * data is migrated, never tolerated; this is that migration, scoped to one
 * organization and one type, run by the change that makes it necessary.
 *
 * Surfaces are the ones migration 102 walks, for the same reason: every place
 * a write path can read a slide back from.
 * - presentations.slides, presentations.i18n (trashed decks included: they
 *   come back from the trash)
 * - presentation_versions.presentation_data (a restore writes it back)
 * - presentation_comments.slide_snapshot
 * - slide_library.content, slide_library.i18n (an insert writes it back)
 *
 * No read funnel runs here, unlike in 102: a custom type's key and its field
 * keys are the organization's own spelling, and the funnel folds only core
 * types' retired spellings, so the raw slide is the slide.
 *
 * The rows are scanned in JavaScript, in id order, `BATCH` at a time, rather
 * than with `jsonb_path` queries: a field removal is a rare designer action,
 * and the in-memory double the write-seam tests run on models no jsonb
 * operators.
 */

import { declaredContentKeys } from '../../shared/slide-types/declared-keys.js';
import { getOrgId } from '../utils/context.js';
import { toStorageContext } from './scope.js';
import { parseJson } from './utils/index.js';

const BATCH = 200;

/**
 * @typedef {Object} RemovedFieldUsage
 * @property {string[]} fields - The removed keys stored content still carries.
 * @property {number} slides - Slides carrying one, across every deck's base
 *   slides and language versions; one slide id counts once per deck.
 * @property {number} decks - Decks holding at least one of those slides.
 * @property {number} libraryItems - Slide-library items carrying one.
 * @property {number} versions - Saved version snapshots carrying one.
 * @property {number} comments - Comment slide snapshots carrying one.
 */

/**
 * The field keys `before` declares and `after` does not.
 * @param {unknown} before - the type's stored `fields`
 * @param {unknown} after - the validated new `fields`
 * @returns {string[]}
 */
export function removedFieldKeys(before, after) {
  const kept = declaredContentKeys({ fields: asArray(after) });
  return [...declaredContentKeys({ fields: asArray(before) })].filter(
    (key) => !kept.has(key),
  );
}

/**
 * Find (and with `strip`, remove) the `removed` keys on the slides of type
 * `key` in the scope's organization.
 *
 * With `strip` the changed rows are written back through `db`, which the
 * caller passes as the transaction the type update runs in, and the collab
 * binaries of changed decks are deleted (a cache of the JSON; the next open
 * rebuilds it). The caller still owes the open collab docs and the deck
 * cache their update after the commit.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {import('kysely').Kysely<any>} db - the connection or transaction
 * @param {string} key - the type's registry key (`custom-<slug>`)
 * @param {string[]} removed - field keys the update removes
 * @param {{strip?: boolean}} [opts]
 * @returns {Promise<{usage: RemovedFieldUsage, deckIds: string[]}>}
 *   `deckIds`: the decks carrying a removed key (changed, with `strip`).
 */
export async function removedFieldContent(
  scope,
  db,
  key,
  removed,
  { strip = false } = {},
) {
  toStorageContext(scope, 'removedFieldContent');
  const orgId = getOrgId(scope);
  const found = new Set();
  const usage = {
    fields: [],
    slides: 0,
    decks: 0,
    libraryItems: 0,
    versions: 0,
    comments: 0,
  };
  const deckIds = [];
  if (!removed.length) return { usage, deckIds };

  /** @param {any} content @returns {boolean} whether it carried a key */
  const visit = (content) => {
    if (!content || typeof content !== 'object') return false;
    let carried = false;
    for (const field of removed) {
      if (!Object.hasOwn(content, field)) continue;
      found.add(field);
      carried = true;
      if (strip) delete content[field];
    }
    return carried;
  };

  /** @param {any} deck @returns {Set<string>} ids of the slides that carried one */
  const visitDeck = (deck) => {
    const ids = new Set();
    for (const slides of slideLists(deck)) {
      slides.forEach((slide, index) => {
        if (slide?.type === key && visit(slide.content))
          ids.add(slide.id ?? `#${index}`);
      });
    }
    return ids;
  };

  await eachRow(db, 'presentations', ['slides', 'i18n'], orgId, async (row) => {
    const deck = { slides: parseJson(row.slides), i18n: parseJson(row.i18n) };
    const ids = visitDeck(deck);
    if (!ids.size) return;
    usage.decks += 1;
    usage.slides += ids.size;
    deckIds.push(row.id);
    if (strip)
      await write(db, 'presentations', row.id, {
        slides: deck.slides,
        i18n: deck.i18n,
      });
  });

  await eachRow(
    db,
    'presentation_versions',
    ['presentation_data'],
    orgId,
    async (row) => {
      const data = parseJson(row.presentation_data);
      if (!visitDeck(data).size) return;
      usage.versions += 1;
      if (strip)
        await write(db, 'presentation_versions', row.id, {
          presentation_data: data,
        });
    },
  );

  await eachRow(
    db,
    'presentation_comments',
    ['slide_snapshot'],
    orgId,
    async (row) => {
      const snapshot = parseJson(row.slide_snapshot);
      if (!visitDeck({ slides: [snapshot] }).size) return;
      usage.comments += 1;
      if (strip)
        await write(db, 'presentation_comments', row.id, {
          slide_snapshot: snapshot,
        });
    },
  );

  await eachRow(
    db,
    'slide_library',
    ['slide_type', 'content', 'i18n'],
    orgId,
    async (row) => {
      if (row.slide_type !== key) return;
      const content = parseJson(row.content);
      const i18n = parseJson(row.i18n);
      let carried = visit(content);
      for (const version of Object.values(i18n?.versions || {})) {
        if (visit(version?.content)) carried = true;
      }
      if (!carried) return;
      usage.libraryItems += 1;
      if (strip) await write(db, 'slide_library', row.id, { content, i18n });
    },
  );

  if (strip && deckIds.length) {
    await db
      .deleteFrom('presentation_ydocs')
      .where('organization_id', '=', orgId)
      .where('presentation_id', 'in', deckIds)
      .execute();
  }

  usage.fields = removed.filter((field) => found.has(field));
  return { usage, deckIds };
}

/**
 * The slide lists of a deck-shaped object: `slides`, then every language
 * version's `slides`.
 * @param {any} deck
 * @returns {any[][]}
 */
function slideLists(deck) {
  const lists = [];
  if (Array.isArray(deck?.slides)) lists.push(deck.slides);
  for (const version of Object.values(deck?.i18n?.versions || {})) {
    if (Array.isArray(version?.slides)) lists.push(version.slides);
  }
  return lists;
}

/**
 * Visit every row of `table` in one organization, in id order.
 * @param {import('kysely').Kysely<any>} db
 * @param {string} table
 * @param {string[]} columns
 * @param {string} orgId
 * @param {(row: any) => Promise<void>} fn
 */
async function eachRow(db, table, columns, orgId, fn) {
  let after = null;
  for (;;) {
    let query = db
      .selectFrom(table)
      .select(['id', ...columns])
      .where('organization_id', '=', orgId);
    if (after !== null) query = query.where('id', '>', after);
    const rows = await query.orderBy('id').limit(BATCH).execute();
    for (const row of rows) await fn(row);
    if (rows.length < BATCH) return;
    after = rows[rows.length - 1].id;
  }
}

/**
 * Write jsonb columns of one row back.
 * @param {import('kysely').Kysely<any>} db
 * @param {string} table
 * @param {string} id
 * @param {Record<string, any>} values
 */
async function write(db, table, id, values) {
  const set = {};
  for (const [column, value] of Object.entries(values)) {
    set[column] = value == null ? null : JSON.stringify(value);
  }
  await db.updateTable(table).set(set).where('id', '=', id).execute();
}

function asArray(value) {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : [];
}
