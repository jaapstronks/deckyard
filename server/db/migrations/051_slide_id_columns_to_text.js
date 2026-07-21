/**
 * Migration: widen every slide-reference column from `uuid` to `text`.
 *
 * Slide IDs are **not** UUIDs. They live inside the `presentations.slides`
 * JSON and are whatever the author, importer or API client put there — decks
 * created over the API or MCP routinely carry ids like `s1`, `cd-dark` or
 * `intro`. Nothing normalises them, and `#slide:<id>` deep links mean we
 * cannot start rewriting them either.
 *
 * Seven columns nonetheless declared `uuid`, so every write that carried a
 * non-UUID slide id threw `invalid input syntax for type uuid` and surfaced as
 * a 500: `POST /api/track/slide/view` (the reported symptom), plus comments,
 * feedback, interactions, lead submissions and question promotion.
 *
 * `slide_locks.slide_id` (migration 023) already used TEXT — that is the
 * correct precedent; this brings the rest in line.
 *
 * uuid -> text is lossless, so `up` cannot lose data. `down` re-casts and will
 * fail loudly if any non-UUID slide id was written in the meantime, which is
 * exactly the data this migration exists to allow.
 */

import { sql } from 'kysely';

/**
 * Table + column pairs to convert. Exported so
 * `tests/slide-id-columns-text.test.js` can assert that no later migration
 * reintroduces a `uuid` slide-reference column.
 * @type {Array<[string, string]>}
 */
export const SLIDE_ID_COLUMNS = [
  ['slide_views', 'slide_id'],
  ['view_sessions', 'exit_slide_id'],
  ['feedback', 'slide_id'],
  ['interactions', 'slide_id'],
  ['lead_submissions', 'slide_id'],
  ['presentation_comments', 'slide_id'],
  ['questions', 'promoted_slide_id'],
];

export const up = async (db) => {
  for (const [table, column] of SLIDE_ID_COLUMNS) {
    await sql`
      ALTER TABLE ${sql.ref(table)}
      ALTER COLUMN ${sql.ref(column)} TYPE TEXT USING ${sql.ref(column)}::text
    `.execute(db);
  }
};

export const down = async (db) => {
  for (const [table, column] of SLIDE_ID_COLUMNS) {
    await sql`
      ALTER TABLE ${sql.ref(table)}
      ALTER COLUMN ${sql.ref(column)} TYPE UUID USING NULLIF(${sql.ref(column)}, '')::uuid
    `.execute(db);
  }
};
