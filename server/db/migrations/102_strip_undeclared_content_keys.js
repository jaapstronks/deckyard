/**
 * Strip the content keys no slide type declares from every stored slide
 * (B257 B5-rest, D359, D360).
 *
 * Since D359 every write refuses a top-level content key outside
 * `declaredContentKeys()` with `unknown_field`. A stored slide that still
 * carried one would be refused on its next save, and an MCP `update_slide`
 * (which merges into the stored content) would fail on a key the agent never
 * sent. Nothing reads such a key: the import already drops it (D121 B2), and
 * the B2 measurement found only retired spellings no renderer knows
 * (title `byline`/`attribution`, process `step*`, countdown `minutes`, matrix
 * `heading`, comparison `leftItems`/`rightItems`, payoff `tagline`). D360 says
 * stored data is migrated, never tolerated, so this removes them once instead
 * of teaching every write path to look away.
 *
 * ## Which keys: undeclared *after* the read funnel
 *
 * A stored slide is not in the current shape. `migratePresentation()` folds
 * retired spellings into their declared keys on every read and deletes the
 * old key there (`bgImage` -> `slideBgImage`, the numbered `card*` slots ->
 * `cards`, ...), but nothing wrote the folded deck back, so the raw rows still
 * hold those inputs. Stripping the raw undeclared keys would delete content the
 * funnel is about to carry over. So a key is removed only when it is still
 * there after the funnel and the type does not declare it: the funnel neither
 * uses it nor will. The raw row is edited, not replaced by the folded deck -
 * the funnel keeps running on read, as it does for every other deck.
 *
 * ## Why this imports live code, unlike 056/081/083
 *
 * Those migrations rename one known value, so they inline it as a literal and
 * do on a later run what they did the day they were tested. "Undeclared" has
 * no literal: it depends on the registry of the install running the migration
 * (a fork's file types load into it, a DB-defined type declares its own
 * `fields`), so the predicate and the funnel are imported. That is also why a
 * later run stays safe: at any version, a key the funnel of that version
 * neither folds nor keeps and the registry of that version does not declare is
 * read by nothing. It holds as long as a later key move ships its funnel step,
 * which `docs/reference/slide-type-removal.md` step 0 already requires.
 *
 * A slide whose type the registry cannot resolve (a removed type, a fork type
 * this install does not load, a custom type that is not published) is left as
 * it is: it declares nothing it could be held to.
 *
 * Surfaces (every place a write path can read a slide back from):
 * - presentations.slides, presentations.i18n
 * - presentation_versions.presentation_data (a restore writes it back)
 * - presentation_comments.slide_snapshot
 * - slide_library.content, slide_library.i18n (an insert writes it back)
 *
 * A changed deck's collab binary (`presentation_ydocs`) is deleted, as any
 * non-collab write deletes it: it is a cache of the JSON, and the next open
 * rebuilds it from the stripped deck.
 *
 * Idempotent: after a run no stored slide carries a stray key, so a second run
 * changes nothing. Irreversible on purpose: the keys are read by nothing.
 */

import { sql } from 'kysely';

import {
  getSlideType,
  SLIDE_TYPES,
} from '../../../shared/slide-types/registry.js';
import { undeclaredContentKeys } from '../../../shared/slide-types/declared-keys.js';
import {
  migrateLibraryItem,
  migratePresentation,
} from '../../../shared/slide-types/schema-version.js';
import { customSlideTypeKey } from '../../../shared/slide-types/custom-type-runtime.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('migration-102');

const BATCH = 200;

/**
 * The slide lists of a deck-shaped object: `slides`, then every language
 * version's `slides`, each under a stable address.
 * @param {any} deck
 * @returns {Array<[string, any[]]>}
 */
function slideLists(deck) {
  const lists = [];
  if (Array.isArray(deck?.slides)) lists.push(['slides', deck.slides]);
  const versions = deck?.i18n?.versions;
  if (versions && typeof versions === 'object') {
    for (const [lang, version] of Object.entries(versions)) {
      if (Array.isArray(version?.slides))
        lists.push([`i18n:${lang}`, version.slides]);
    }
  }
  return lists;
}

/**
 * Remove from `rawContent` the keys in `stray` it carries.
 * @param {any} rawContent
 * @param {string[]} stray
 * @param {Map<string, number>} tally - removed keys, `type :: key` -> count
 * @param {string} type
 * @returns {boolean} whether anything was removed
 */
function removeKeys(rawContent, stray, tally, type) {
  let removed = false;
  for (const key of stray) {
    if (!rawContent || !Object.hasOwn(rawContent, key)) continue;
    delete rawContent[key];
    const label = `${type} :: ${key}`;
    tally.set(label, (tally.get(label) || 0) + 1);
    removed = true;
  }
  return removed;
}

/**
 * Strip the stray keys from a deck-shaped object in place: `{ slides, i18n }`,
 * as a deck, a version snapshot or a one-slide wrapper stores it.
 *
 * The funnel runs on a copy; a raw slide is matched to its folded twin by
 * position and id, and loses only the keys the twin still carries undeclared.
 *
 * @param {any} deck - mutated
 * @param {Record<string, object>} slideTypes - the registry of the deck's org
 * @param {Map<string, number>} tally
 * @returns {boolean} whether anything was removed
 */
export function stripDeck(deck, slideTypes, tally) {
  if (!deck || typeof deck !== 'object') return false;
  const folded = migratePresentation(
    structuredClone({ slides: deck.slides, i18n: deck.i18n }),
  );
  const foldedLists = new Map(slideLists(folded));
  let removed = false;
  for (const [address, rawSlides] of slideLists(deck)) {
    const foldedSlides = foldedLists.get(address) || [];
    rawSlides.forEach((raw, index) => {
      const twin = foldedSlides[index];
      if (!raw || !twin || raw.id !== twin.id) return;
      const def = getSlideType(twin.type, slideTypes);
      const stray = undeclaredContentKeys(def, twin.content);
      if (stray.length && removeKeys(raw.content, stray, tally, twin.type))
        removed = true;
    });
  }
  return removed;
}

/**
 * Strip the stray keys from a slide-library item in place
 * (`{ slideType, content, i18n }`), through the library's own funnel entry.
 *
 * @param {any} item - mutated
 * @param {Record<string, object>} slideTypes
 * @param {Map<string, number>} tally
 * @returns {boolean} whether anything was removed
 */
export function stripLibraryItem(item, slideTypes, tally) {
  const folded = migrateLibraryItem(structuredClone(item));
  const def = getSlideType(folded?.slideType, slideTypes);
  if (!def) return false;
  const type = folded.slideType;
  let removed = removeKeys(
    item.content,
    undeclaredContentKeys(def, folded.content),
    tally,
    type,
  );
  for (const [lang, version] of Object.entries(item.i18n?.versions || {})) {
    const twin = folded.i18n?.versions?.[lang]?.content;
    const stray = undeclaredContentKeys(def, twin);
    if (removeKeys(version?.content, stray, tally, type)) removed = true;
  }
  return removed;
}

/**
 * The slide-type registry per organization: the process registry (core and
 * the install's file types) plus each organization's published DB types under
 * their `custom-<slug>` key. A DB type declares its `fields`; that is all
 * `declaredContentKeys()` needs, so no template is compiled here.
 *
 * @param {import('kysely').Kysely<any>} db
 * @returns {Promise<(orgId: string|null) => Record<string, object>>}
 */
async function registriesByOrganization(db) {
  const { rows } = await sql`
    SELECT organization_id, slug, fields
    FROM custom_slide_types
    WHERE is_published = true
  `.execute(db);
  const byOrg = new Map();
  for (const row of rows) {
    const key = String(row.organization_id);
    if (!byOrg.has(key)) byOrg.set(key, { ...SLIDE_TYPES });
    byOrg.get(key)[customSlideTypeKey(row)] = {
      fields: Array.isArray(row.fields) ? row.fields : [],
    };
  }
  return (orgId) => byOrg.get(String(orgId)) || SLIDE_TYPES;
}

/**
 * Walk one table in id order, `BATCH` rows at a time, and write back the rows
 * `strip` changed.
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {{table: string, columns: string[], read?: string[], strip: (row: any) => boolean}} spec
 *   - `columns` are the jsonb columns written back, `read` any further columns
 *   `strip` needs; `strip` mutates the row's jsonb values and says whether it
 *   changed them
 * @returns {Promise<string[]>} the ids of the changed rows
 */
async function rewriteTable(db, { table, columns, read = [], strip }) {
  const changed = [];
  let after = null;
  for (;;) {
    const { rows } = await sql`
      SELECT id, organization_id, ${sql.join([...read, ...columns].map((c) => sql.ref(c)))}
      FROM ${sql.table(table)}
      WHERE ${after === null ? sql`true` : sql`id > ${after}`}
      ORDER BY id
      LIMIT ${BATCH}
    `.execute(db);
    if (!rows.length) break;
    for (const row of rows) {
      if (!strip(row)) continue;
      const sets = columns.map(
        (c) => sql`${sql.ref(c)} = ${JSON.stringify(row[c])}::jsonb`,
      );
      await sql`
        UPDATE ${sql.table(table)} SET ${sql.join(sets)} WHERE id = ${row.id}
      `.execute(db);
      changed.push(row.id);
    }
    after = rows[rows.length - 1].id;
  }
  return changed;
}

export const up = async (db) => {
  const registryFor = await registriesByOrganization(db);
  const tally = new Map();

  const decks = await rewriteTable(db, {
    table: 'presentations',
    columns: ['slides', 'i18n'],
    strip: (row) => stripDeck(row, registryFor(row.organization_id), tally),
  });
  const snapshots = await rewriteTable(db, {
    table: 'presentation_versions',
    columns: ['presentation_data'],
    strip: (row) =>
      stripDeck(row.presentation_data, registryFor(row.organization_id), tally),
  });
  const comments = await rewriteTable(db, {
    table: 'presentation_comments',
    columns: ['slide_snapshot'],
    strip: (row) =>
      !!row.slide_snapshot &&
      stripDeck(
        { slides: [row.slide_snapshot] },
        registryFor(row.organization_id),
        tally,
      ),
  });
  const library = await rewriteTable(db, {
    table: 'slide_library',
    columns: ['content', 'i18n'],
    read: ['slide_type'],
    strip: (row) => {
      const item = {
        slideType: row.slide_type,
        content: row.content,
        i18n: row.i18n,
      };
      return stripLibraryItem(item, registryFor(row.organization_id), tally);
    },
  });

  if (decks.length) {
    await sql`
      DELETE FROM presentation_ydocs
      WHERE presentation_id IN (${sql.join(decks)})
    `.execute(db);
  }

  log.info(
    `stripped undeclared content keys: ${decks.length} deck(s), ` +
      `${snapshots.length} snapshot(s), ${comments.length} comment ` +
      `snapshot(s), ${library.length} library item(s)`,
  );
  for (const [label, count] of [...tally].sort())
    log.info(`  ${label}: ${count}`);
};

// Irreversible on purpose: the stripped keys are read by nothing, and putting
// them back would only make the next save refuse the slide again.
export const down = async () => {
  // no-op - see the comment above.
};
