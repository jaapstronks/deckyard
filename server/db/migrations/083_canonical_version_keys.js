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
 * through the same seam.
 *
 * Idempotent: after a run no renameable key is left, so a second run renames
 * nothing and logs the same leftovers.
 */

import { normalizeLang } from '../../../shared/i18n-utils.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('migration-083');

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
    const canonical = normalizeLang(key);
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
 * @param {object} db
 * @param {string} table
 * @param {string} column
 * @param {(row: object) => unknown} readI18n
 * @param {(row: object, i18n: object) => unknown} writeColumn
 */
async function rewrite(db, table, column, readI18n, writeColumn) {
  const rows = await db.selectFrom(table).select(['id', column]).execute();
  let renamed = 0;
  for (const row of rows) {
    const { i18n, leftovers } = canonicalizeVersionKeys(readI18n(row));
    if (leftovers.length) {
      log.warn(
        `${table} ${row.id}: i18n.versions keeps non-canonical key(s) ` +
          `${leftovers.join(', ')}; fix by hand — the deck is refused on save`,
      );
    }
    if (!i18n) continue;
    await db
      .updateTable(table)
      .set({ [column]: writeColumn(row, i18n) })
      .where('id', '=', row.id)
      .execute();
    renamed += 1;
  }
  if (renamed) log.info(`${table}: canonicalized version keys on ${renamed}`);
}

export const up = async (db) => {
  await rewrite(
    db,
    'presentations',
    'i18n',
    (row) => row.i18n,
    (_row, i18n) => JSON.stringify(i18n),
  );
  await rewrite(
    db,
    'presentation_versions',
    'presentation_data',
    (row) => row.presentation_data?.i18n,
    (row, i18n) => JSON.stringify({ ...row.presentation_data, i18n }),
  );
};

/** Nothing to undo: the old key named a version no reader could reach. */
export const down = async () => {};
