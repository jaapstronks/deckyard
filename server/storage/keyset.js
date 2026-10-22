/**
 * Keyset pagination for a Kysely list query (D357).
 *
 * Every paged list has one order, `(<time column> desc, id desc)`, with the
 * uuid `id` as the unique tiebreaker. A page continues strictly after the
 * last row the reader saw:
 *
 *     WHERE (<column>, id) < (:value::timestamptz, :id)
 *     ORDER BY <column> desc, id desc
 *     LIMIT :limit + 1
 *
 * The extra row only answers "is there more"; it is never returned.
 *
 * Precision: PostgreSQL keeps microseconds, a JS `Date` milliseconds. The sort
 * value therefore leaves SQL as text (`<column>::text`) and goes back as
 * `::timestamptz`, never through `new Date()`; otherwise rows inside one
 * millisecond would be skipped or repeated across pages. The column must be
 * NOT NULL.
 *
 * Storage knows positions, not cursors: the transport format lives in
 * `server/services/list-page.js`.
 *
 * @module server/storage/keyset
 */

import { sql } from 'kysely';

/** Alias of the sort value read as text alongside each row. */
const SORT_VALUE = '__keyset_sort';

/**
 * Add the keyset page to a select query: the sort value as text, the position
 * filter, the one order and `limit + 1`.
 *
 * @template QB
 * @param {QB} qb - A Kysely select query that already applies its scope and
 *   filters.
 * @param {Object} options
 * @param {string} options.column - The NOT NULL timestamptz sort column.
 * @param {string} [options.idColumn='id'] - The unique uuid tiebreaker.
 * @param {{value: string, id: string}|null} [options.after] - Position of the
 *   last row seen; null starts at the top.
 * @param {number} options.limit - Rows per page.
 * @returns {QB}
 */
export function keysetPage(qb, { column, idColumn = 'id', after, limit }) {
  let page = qb.select(sql`${sql.ref(column)}::text`.as(SORT_VALUE));
  if (after) {
    page = page.where((eb) =>
      eb(
        eb.refTuple(column, idColumn),
        '<',
        eb.tuple(sql`${after.value}::timestamptz`, after.id),
      ),
    );
  }
  return page
    .orderBy(column, 'desc')
    .orderBy(idColumn, 'desc')
    .limit(limit + 1);
}

/**
 * Split the `limit + 1` rows of a keyset query into the page and the position
 * the next page starts after (null when this was the last page). The sort
 * value column is removed from the returned rows.
 *
 * @template Row
 * @param {Row[]} rows - Rows from a query built with {@link keysetPage}.
 * @param {number} limit
 * @param {string} [idColumn='id']
 * @returns {{rows: Row[], next: {value: string, id: string}|null}}
 */
export function keysetRows(rows, limit, idColumn = 'id') {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const next =
    rows.length > limit && last
      ? { value: String(last[SORT_VALUE]), id: String(last[idColumn]) }
      : null;
  return {
    rows: page.map(({ [SORT_VALUE]: _sort, ...row }) => row),
    next,
  };
}
