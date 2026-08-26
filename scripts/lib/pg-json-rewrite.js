/**
 * Rewriting stored JSON columns in place, for the one-time migration scripts.
 *
 * A migration that changes stored slide JSON has the same Postgres shape every
 * time: find which of the targeted columns this install actually has, read the
 * rows in id-ordered batches, run a pure rewrite over each parsed value, and
 * write back only the rows that changed. `migrate-lijstje-slide.js` grew that
 * machinery first; `migrate-legacy-bg-image.js` needed exactly the same thing,
 * which is the signal to have one copy rather than two that drift.
 *
 * What stays in the scripts is the part that is genuinely theirs: which
 * surfaces are in scope, and the pure `(value) => {value, count}` rewrite. This
 * module knows nothing about slides.
 *
 * @module scripts/lib/pg-json-rewrite
 */

/**
 * @typedef {object} JsonTarget
 * @property {string} table    table name
 * @property {string[]} columns  jsonb columns on it that can hold the JSON
 */

/**
 * @typedef {object} RewriteResult
 * @property {string} table
 * @property {boolean} present    whether any targeted column exists here
 * @property {number} rowsScanned
 * @property {number} rowsModified
 * @property {number} hits        what the rewrite counted, summed over rows
 */

/** How many rows are read per round trip. */
const BATCH_SIZE = 200;

/**
 * pg returns jsonb as parsed values, but a column can also come back as text on
 * some driver configurations. Normalize both to a JS value.
 * @param {*} raw
 * @returns {*}
 */
function parseMaybeJson(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Read which columns actually exist in the `public` schema.
 *
 * Checked per *column*, not per table: columns like
 * `presentation_comments.slide_snapshot` (migration 041) and
 * `slide_library.i18n` (049) arrived later than the tables holding them, so an
 * install that has not run those migrations must report "absent" rather than
 * fail the whole run on a missing column.
 *
 * @param {import('kysely').Kysely<any>} db
 * @returns {Promise<Set<string>>} `"table.column"` keys that exist.
 */
export async function readExistingColumns(db) {
  const rows = await db
    .selectFrom('information_schema.columns')
    .select(['table_name', 'column_name'])
    .where('table_schema', '=', 'public')
    .execute();
  return new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
}

/**
 * Run a pure rewrite over every targeted JSON column, writing back only the
 * rows it actually changed.
 *
 * Rows are read in id-ordered batches and only written back when the rewrite
 * reported a hit, so a re-run touches no rows and bumps no timestamps. The
 * rewrite must not mutate its input: a dry run walks the exact same code path
 * as a real one, minus the `UPDATE`.
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {JsonTarget[]} targets
 * @param {(value: *) => {value: *, count: number}} rewrite - pure rewrite
 * @param {{dryRun?: boolean}} [opts]
 * @returns {Promise<RewriteResult[]>} one entry per target, in the given order.
 */
export async function rewriteJsonColumns(db, targets, rewrite, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const existing = await readExistingColumns(db);
  const results = [];

  for (const { table, columns } of targets) {
    const present = columns.filter((c) => existing.has(`${table}.${c}`));
    /** @type {RewriteResult} */
    const result = {
      table,
      present: present.length > 0,
      rowsScanned: 0,
      rowsModified: 0,
      hits: 0,
    };
    results.push(result);
    if (!result.present) continue;

    let offset = 0;
    for (;;) {
      const rows = await db
        .selectFrom(table)
        .select(['id', ...present])
        .orderBy('id')
        .limit(BATCH_SIZE)
        .offset(offset)
        .execute();
      if (!rows.length) break;
      offset += rows.length;
      result.rowsScanned += rows.length;

      for (const row of rows) {
        /** @type {Record<string, string>} */
        const updates = {};
        let hits = 0;
        for (const column of present) {
          const parsed = parseMaybeJson(row[column]);
          const { value, count } = rewrite(parsed);
          if (!count) continue;
          hits += count;
          updates[column] = JSON.stringify(value);
        }
        if (!hits) continue;

        result.rowsModified += 1;
        result.hits += hits;
        if (!dryRun) {
          await db
            .updateTable(table)
            .set(updates)
            .where('id', '=', row.id)
            .execute();
        }
      }
    }
  }

  return results;
}
