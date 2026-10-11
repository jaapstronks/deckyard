/**
 * B392 (D200): the e-mail stamps on a deck are normalised on write, and every
 * read compares them bare.
 *
 * `createPresentationRow` stamped `owner_email`, `created_by` and `updated_by`
 * from the raw address it was handed; its neighbours (the ownership transfer,
 * the API-key owner) already went through `normalizeEmail`. Since this change
 * the create and the update path normalise too, so the one place left that can
 * hold a mixed-case or padded address is a row written before it. This
 * migration folds those rows the way `normalizeEmail` does (trim, lower case,
 * blank becomes NULL), which is what lets `sandbox-quota.js` drop its SQL
 * `lower(owner_email)` without silently changing what a quota counts.
 *
 * The number of rows each column touches is counted before the rewrite and
 * logged, so the deploy log says how much legacy data there was.
 */

import { sql } from 'kysely';

import { createLogger } from '../../utils/logger.js';

const log = createLogger('migration-091');

/** The e-mail stamps on `presentations` that share the create-time defect. */
export const EMAIL_COLUMNS = Object.freeze([
  'owner_email',
  'created_by',
  'updated_by',
]);

/**
 * The SQL spelling of `normalizeEmail` (server/utils/normalize.js) for one
 * column: trimmed, lower-cased, and NULL when nothing is left.
 * @param {string} column
 * @returns {import('kysely').RawBuilder<string|null>}
 */
const normalized = (column) =>
  sql`nullif(lower(btrim(${sql.ref(column)})), '')`;

/**
 * How many rows of `presentations` hold a non-normalised value in `column`.
 * Exported so the real-PostgreSQL test can pin the filter.
 * @param {import('kysely').Kysely<any>} db
 * @param {string} column - One of {@link EMAIL_COLUMNS}.
 * @returns {Promise<number>}
 */
export async function countUnnormalized(db, column) {
  const { rows } = await sql`
    SELECT count(*)::int AS n
    FROM presentations
    WHERE ${sql.ref(column)} IS DISTINCT FROM ${normalized(column)}
  `.execute(db);
  return Number(rows[0]?.n) || 0;
}

export const up = async (db) => {
  for (const column of EMAIL_COLUMNS) {
    const affected = await countUnnormalized(db, column);
    log.info(`presentations.${column}: ${affected} row(s) to normalise`);
    if (!affected) continue;
    await sql`
      UPDATE presentations
      SET ${sql.ref(column)} = ${normalized(column)}
      WHERE ${sql.ref(column)} IS DISTINCT FROM ${normalized(column)}
    `.execute(db);
  }
};

/** Nothing to undo: the original casing named the same person. */
export const down = async () => {};
