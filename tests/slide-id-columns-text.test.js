/**
 * Slide-reference columns must be TEXT, never UUID.
 *
 * Slide IDs live inside the `presentations.slides` JSON and are whatever the
 * author, importer or API client wrote there — `s1`, `cd-dark`, `intro`. Any
 * column that stores one and declares `uuid` makes Postgres throw
 * `invalid input syntax for type uuid`, which surfaces to the viewer as a 500
 * (this is what broke `POST /api/track/slide/view` on share links).
 *
 * Migration 051 converted the seven columns that had it wrong. These tests
 * guard the invariant going forward: a new migration that adds a slide-id
 * column as `uuid` fails here instead of in production.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SLIDE_ID_COLUMNS } from '../server/db/migrations/051_slide_id_columns_to_text.js';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'server',
  'db',
  'migrations'
);

/** Migration that fixed the columns; anything at or before it is grandfathered. */
const FIX_MIGRATION = '051_slide_id_columns_to_text.js';

/** Column names that hold a slide ID from the deck JSON. */
const isSlideIdColumn = (name) => /^(.*_)?(slide_id|slide_ids)$/.test(name);

/**
 * Find slide-id columns declared as uuid, in both declaration styles used in
 * this repo: Kysely `.addColumn('slide_id', 'uuid', …)` and raw
 * `CREATE TABLE` SQL with `slide_id UUID`.
 * @param {string} source - Migration file contents.
 * @returns {string[]} Offending column names.
 */
function findUuidSlideIdColumns(source) {
  const hits = [];

  const kysely = /\.addColumn\(\s*'([a-z0-9_]+)'\s*,\s*'uuid'/gi;
  for (const m of source.matchAll(kysely)) {
    if (isSlideIdColumn(m[1])) hits.push(m[1]);
  }

  const rawSql = /^\s*([a-z0-9_]+)\s+UUID\b/gim;
  for (const m of source.matchAll(rawSql)) {
    if (isSlideIdColumn(m[1])) hits.push(m[1]);
  }

  return hits;
}

test('no migration after 051 declares a slide-id column as uuid', async () => {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.js'))
    .sort();

  const after = files.filter((f) => f > FIX_MIGRATION);

  for (const file of after) {
    const source = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    const offenders = findUuidSlideIdColumns(source);
    assert.deepEqual(
      offenders,
      [],
      `${file} declares slide-id column(s) as uuid: ${offenders.join(', ')}. ` +
        `Slide IDs are arbitrary strings from the deck JSON — use 'text'.`
    );
  }
});

test('051 covers every slide-id column the earlier migrations got wrong', async () => {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.js') && f < FIX_MIGRATION)
    .sort();

  const declared = new Set();
  for (const file of files) {
    const source = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    for (const col of findUuidSlideIdColumns(source)) declared.add(col);
  }

  const converted = new Set(SLIDE_ID_COLUMNS.map(([, column]) => column));

  for (const column of declared) {
    assert.ok(
      converted.has(column),
      `Column '${column}' was created as uuid but migration 051 never converts it.`
    );
  }
});

test('the conversion list is well formed and has no duplicates', () => {
  assert.ok(SLIDE_ID_COLUMNS.length > 0);

  const seen = new Set();
  for (const entry of SLIDE_ID_COLUMNS) {
    assert.equal(entry.length, 2, `Expected [table, column], got ${JSON.stringify(entry)}`);
    const [table, column] = entry;
    assert.match(table, /^[a-z0-9_]+$/);
    assert.ok(isSlideIdColumn(column), `'${column}' is not a slide-id column name`);

    const key = `${table}.${column}`;
    assert.ok(!seen.has(key), `Duplicate entry: ${key}`);
    seen.add(key);
  }
});
