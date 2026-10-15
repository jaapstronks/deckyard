/**
 * B664 (D200): every e-mail column a read compares bare holds the
 * `normalizeEmail` spelling.
 *
 * Migration 091 did this for the stamps on `presentations`. The rest kept a
 * second fold on the read side instead (`lower()` in SQL, `.toLowerCase()` in
 * JavaScript), because their write paths stored the address as handed in.
 * Since this change those writes go through `normalizeEmail` (shared/email.js)
 * and the reads compare bare, which is only safe once no stored row is left in
 * another spelling. This migration folds those rows the way `normalizeEmail`
 * does: trimmed, lower-cased, blank becomes NULL.
 *
 * Three columns are unique (`users.email`, the `user_settings.email` primary
 * key, and `presentation_collaborators.user_email` per deck). Folding two rows
 * that differ only in case onto one value would break that constraint, and
 * which of the two is the real one is not a question a migration can answer.
 * Such a row is left as it is and counted in the log, so an operator can see
 * it; every other row is folded. Those columns are NOT NULL, and so is
 * `presentation_versions.created_by` (migration 014): a blank value there is
 * left alone too rather than turned into the NULL the constraint refuses.
 *
 * `slide_library.favorites` is an array of addresses: each element is folded,
 * blanks are dropped and duplicates collapse to one.
 *
 * The number of rows each column touches is counted before the rewrite and
 * logged, so the deploy log says how much legacy data there was.
 */

import { sql } from 'kysely';

import { createLogger } from '../../utils/logger.js';

const log = createLogger('migration-092');

/**
 * The e-mail columns this migration folds. `unique` names the columns that
 * scope a unique constraint over the address (`[]`: unique on its own); it is
 * absent for a column without one, and a unique column is NOT NULL as well.
 * `notNull` marks the one NOT NULL column without a unique constraint.
 * @typedef {{table: string, column: string, unique?: string[], notNull?: boolean}} EmailColumn
 * @type {readonly EmailColumn[]}
 */
export const EMAIL_COLUMNS = Object.freeze([
  { table: 'users', column: 'email', unique: [] },
  { table: 'user_settings', column: 'email', unique: [] },
  {
    table: 'presentation_collaborators',
    column: 'user_email',
    unique: ['presentation_id'],
  },
  { table: 'presentations', column: 'trashed_by' },
  { table: 'presentation_versions', column: 'created_by', notNull: true },
  { table: 'slide_library', column: 'owner_email' },
  { table: 'slide_library', column: 'created_by' },
  { table: 'slide_library', column: 'updated_by' },
  { table: 'slide_library', column: 'trashed_by' },
  { table: 'slide_collections', column: 'owner_email' },
  { table: 'slide_collections', column: 'created_by' },
  { table: 'slide_collections', column: 'updated_by' },
  { table: 'view_sessions', column: 'viewer_email' },
]);

/** The array column of addresses, folded per element. */
export const FAVORITES = Object.freeze({
  table: 'slide_library',
  column: 'favorites',
});

/**
 * The SQL spelling of `normalizeEmail` (shared/email.js) for one value:
 * trimmed, lower-cased, and NULL when nothing is left.
 * @param {import('kysely').RawBuilder<unknown>|import('kysely').Expression<unknown>} value
 * @returns {import('kysely').RawBuilder<string|null>}
 */
const normalized = (value) => sql`nullif(lower(btrim(${value})), '')`;

/**
 * The rows of `spec.table`, aliased `r`, whose `spec.column` is not in the
 * normalised spelling.
 * @param {{table: string, column: string}} spec
 */
const unnormalizedRows = ({ table, column }) => {
  const col = sql.ref(`r.${column}`);
  return sql`${sql.table(table)} r WHERE ${col} IS DISTINCT FROM ${normalized(col)}`;
};

/**
 * The extra condition a unique column's fold needs: the folded value is not
 * blank (the column is NOT NULL) and no other row in the same unique scope
 * folds to it.
 * @param {{table: string, column: string, unique: string[]}} spec
 */
const foldableUnique = ({ table, column, unique }) => {
  const col = sql.ref(`r.${column}`);
  const sameScope = unique.map(
    (key) => sql` AND o.${sql.ref(key)} = r.${sql.ref(key)}`,
  );
  return sql`${normalized(col)} IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM ${sql.table(table)} o
      WHERE o.ctid <> r.ctid
        AND ${normalized(sql.ref(`o.${column}`))} = ${normalized(col)}
        ${sql.join(sameScope, sql``)}
    )`;
};

/**
 * The condition, beyond "not yet normalised", a row must meet to be folded:
 * a unique column takes the folded value only when no other row in its scope
 * folds to it, and a NOT NULL column keeps a blank value rather than taking
 * the NULL its constraint refuses. `null` when every unnormalised row folds.
 * @param {EmailColumn} spec
 * @returns {import('kysely').RawBuilder<unknown>|null}
 */
const foldable = (spec) => {
  if (spec.unique) return foldableUnique(spec);
  if (spec.notNull)
    return sql`${normalized(sql.ref(`r.${spec.column}`))} IS NOT NULL`;
  return null;
};

/**
 * How many rows hold a non-normalised value in one column, and how many of
 * those the fold will rewrite (the rest would collide on a unique
 * constraint, or are blank in a NOT NULL column). Exported so the
 * real-PostgreSQL test can pin the filter.
 * @param {import('kysely').Kysely<any>} db
 * @param {EmailColumn} spec - One of {@link EMAIL_COLUMNS}.
 * @returns {Promise<{unnormalized: number, foldable: number}>}
 */
export async function countUnnormalized(db, spec) {
  const extra = foldable(spec);
  const count = extra ? sql`count(*) FILTER (WHERE ${extra})` : sql`count(*)`;
  const { rows } = await sql`
    SELECT count(*)::int AS unnormalized, (${count})::int AS foldable
    FROM ${unnormalizedRows(spec)}
  `.execute(db);
  return {
    unnormalized: Number(rows[0]?.unnormalized) || 0,
    foldable: Number(rows[0]?.foldable) || 0,
  };
}

/**
 * Fold one column. Exported for the real-PostgreSQL test.
 * @param {import('kysely').Kysely<any>} db
 * @param {EmailColumn} spec
 */
export async function foldColumn(db, spec) {
  const { table, column } = spec;
  const col = sql.ref(`r.${column}`);
  const extra = foldable(spec);
  const where = extra
    ? sql`${col} IS DISTINCT FROM ${normalized(col)} AND ${extra}`
    : sql`${col} IS DISTINCT FROM ${normalized(col)}`;
  await sql`
    UPDATE ${sql.table(table)} r
    SET ${sql.ref(column)} = ${normalized(col)}
    WHERE ${where}
  `.execute(db);
}

/** Whether one element of `favorites` is outside the normalised spelling. */
const favoriteUnnormalized = sql`EXISTS (
  SELECT 1 FROM unnest(r.favorites) AS e(address)
  WHERE e.address IS DISTINCT FROM ${normalized(sql`e.address`)}
)`;

/**
 * How many `slide_library` rows carry a favorite outside the normalised
 * spelling. Exported for the real-PostgreSQL test.
 * @param {import('kysely').Kysely<any>} db
 * @returns {Promise<number>}
 */
export async function countUnnormalizedFavorites(db) {
  const { rows } = await sql`
    SELECT count(*)::int AS n FROM slide_library r
    WHERE ${favoriteUnnormalized}
  `.execute(db);
  return Number(rows[0]?.n) || 0;
}

export const up = async (db) => {
  for (const spec of EMAIL_COLUMNS) {
    const { unnormalized, foldable } = await countUnnormalized(db, spec);
    const name = `${spec.table}.${spec.column}`;
    log.info(`${name}: ${foldable} row(s) to normalise`);
    if (unnormalized > foldable) {
      log.warn(
        `${name}: ${unnormalized - foldable} row(s) left as is: blank in a NOT NULL column, or folding would collide with another row`,
      );
    }
    if (foldable) await foldColumn(db, spec);
  }

  const favorites = await countUnnormalizedFavorites(db);
  log.info(
    `${FAVORITES.table}.${FAVORITES.column}: ${favorites} row(s) to normalise`,
  );
  if (favorites) {
    await sql`
      UPDATE slide_library r
      SET favorites = ARRAY(
        SELECT DISTINCT ${normalized(sql`e.address`)}
        FROM unnest(r.favorites) AS e(address)
        WHERE ${normalized(sql`e.address`)} IS NOT NULL
      )
      WHERE ${favoriteUnnormalized}
    `.execute(db);
  }
};

/** Nothing to undo: the original casing named the same person. */
export const down = async () => {};
