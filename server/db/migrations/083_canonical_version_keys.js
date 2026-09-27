/**
 * Store every language version under its canonical key (B481).
 *
 * Until B481 the write seam (`normalizeI18n`) stored a version under whatever
 * key the caller sent, so an API PUT with `i18n.versions.en` landed as-is.
 * No reader could reach it — `pickVersion` reads the canonical key only — and
 * the seam now refuses such a write outright. A deck that already carries one
 * would be refused on its next save, because the editor sends the whole
 * `i18n` block back. This puts the data in the one shape the seam accepts.
 *
 * Rule, per non-canonical key:
 * - an alias (`en`) whose canonical key (`en-GB`) the deck does not carry is
 *   **renamed** to it — the version is kept, it just becomes reachable;
 * - anything else (an off-axis key, or an alias next to its canonical key) is
 *   **left alone and logged** with the deck id. Choosing between two versions
 *   of one language, or dropping one, is an operator's call on real content,
 *   not a migration's. Such a deck is refused on save until it is fixed.
 *
 * Surfaces: `presentations.i18n` and the `i18n` inside
 * `presentation_versions.presentation_data`, which a restore writes back
 * through the same seam. Only the rows that carry a non-canonical key are
 * read: the filter is in SQL, so a store with thousands of snapshots does not
 * load them all to rewrite none.
 *
 * Idempotent: after a run no renameable key is left, so a second run renames
 * nothing and logs the same leftovers.
 */

import { sql } from 'kysely';

import { createLogger } from '../../utils/logger.js';

const log = createLogger('migration-083');

// The deck-language axis and its aliases as they stood when this migration was
// written (`TRANSLATION_LANGS` and the alias map in shared/i18n-utils.js). A
// literal, not an import: a migration is a historical record and must do on a
// later run what it did the day it was tested, whatever the live axis becomes
// (docs/reference/slide-type-removal.md § The removal checklist, step 0).
const CANONICAL_LANGS = Object.freeze([
  'nl',
  'en-GB',
  'de',
  'fr',
  'es',
  'pt',
  'it',
  'pl',
  'fi',
  'da',
  'sv',
  'no',
]);
const LANG_ALIASES = Object.freeze({ en: 'en-GB' });

/**
 * The canonical key for `key`, or `null` when it is off the axis.
 * @param {string} key
 * @returns {string|null}
 */
function canonicalKey(key) {
  if (Object.hasOwn(LANG_ALIASES, key)) return LANG_ALIASES[key];
  return CANONICAL_LANGS.includes(key) ? key : null;
}

/**
 * Canonicalize the version keys of one `i18n` block.
 *
 * @param {unknown} i18n
 * @returns {{ i18n: object|null, leftovers: string[] }} `i18n` is the
 *   rewritten block, or `null` when nothing was renamed.
 */
export function canonicalizeVersionKeys(i18n) {
  const versions = i18n?.versions;
  if (!versions || typeof versions !== 'object' || Array.isArray(versions)) {
    return { i18n: null, leftovers: [] };
  }
  const leftovers = [];
  let renamed = false;
  const next = {};
  for (const [key, version] of Object.entries(versions)) {
    const canonical = canonicalKey(key);
    if (canonical === key) {
      next[key] = version;
    } else if (canonical && !Object.hasOwn(versions, canonical)) {
      next[canonical] = version;
      renamed = true;
    } else {
      next[key] = version;
      leftovers.push(key);
    }
  }
  return {
    i18n: renamed ? { ...i18n, versions: next } : null,
    leftovers,
  };
}

/**
 * True for a row whose `versions` object has a key off the canonical set. A
 * `versions` that is not an object has no keys, so it never matches.
 *
 * @param {import('kysely').RawBuilder<unknown>} versions - the jsonb path
 * @returns {import('kysely').RawBuilder<boolean>}
 */
const hasNonCanonicalKey = (versions) => sql`EXISTS (
  SELECT 1 FROM jsonb_object_keys(
    CASE WHEN jsonb_typeof(${versions}) = 'object'
         THEN ${versions} ELSE '{}'::jsonb END
  ) AS k(key)
  WHERE k.key NOT IN (${sql.join(CANONICAL_LANGS)})
)`;

/**
 * The two places a deck's `i18n` block is stored. `versions` is the jsonb path
 * to its `versions` object; `read`/`write` get the block out of and back into
 * the column.
 */
const SURFACES = Object.freeze({
  presentations: {
    column: 'i18n',
    versions: sql`i18n -> 'versions'`,
    read: (row) => row.i18n,
    write: (_row, i18n) => JSON.stringify(i18n),
  },
  presentation_versions: {
    column: 'presentation_data',
    versions: sql`presentation_data -> 'i18n' -> 'versions'`,
    read: (row) => row.presentation_data?.i18n,
    write: (row, i18n) => JSON.stringify({ ...row.presentation_data, i18n }),
  },
});

/**
 * The rows of `table` whose `i18n.versions` carries a non-canonical key — the
 * only rows `up` reads. Exported so the real-PostgreSQL test can pin the filter.
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {keyof typeof SURFACES} table
 * @returns {Promise<object[]>}
 */
export function selectNonCanonical(db, table) {
  const { column, versions } = SURFACES[table];
  return db
    .selectFrom(table)
    .select(['id', column])
    .where(hasNonCanonicalKey(versions))
    .execute();
}

/**
 * @param {import('kysely').Kysely<any>} db
 * @param {keyof typeof SURFACES} table
 */
async function rewrite(db, table) {
  const { column, read, write } = SURFACES[table];
  let renamed = 0;
  for (const row of await selectNonCanonical(db, table)) {
    const { i18n, leftovers } = canonicalizeVersionKeys(read(row));
    if (leftovers.length) {
      log.warn(
        `${table} ${row.id}: i18n.versions keeps non-canonical key(s) ` +
          `${leftovers.join(', ')}; fix by hand — the deck is refused on save`,
      );
    }
    if (!i18n) continue;
    await db
      .updateTable(table)
      .set({ [column]: write(row, i18n) })
      .where('id', '=', row.id)
      .execute();
    renamed += 1;
  }
  if (renamed) log.info(`${table}: canonicalized version keys on ${renamed}`);
}

export const up = async (db) => {
  await rewrite(db, 'presentations');
  await rewrite(db, 'presentation_versions');
};

/** Nothing to undo: the old key named a version no reader could reach. */
export const down = async () => {};
