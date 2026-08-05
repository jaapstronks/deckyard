/**
 * Every identity field kept out of new snapshots must also have been erased
 * from the old ones.
 *
 * PR D (#644) made `stripIdentityForSnapshot()` the single list of fields a
 * version snapshot may not carry; PR G's migration 068 erased those same fields
 * from the rows written before it. Those two lists are deliberately *not* the
 * same constant — a migration is a historical record and may not silently grow
 * a field years after it ran (see the docblock of
 * server/db/migrations/068_strip_identity_from_snapshots.js).
 *
 * This is the gate that keeps them honest without coupling them: any migration
 * may declare which snapshot keys it erased by exporting
 * `STRIPPED_SNAPSHOT_FIELDS`, and the union of those declarations must cover
 * `SNAPSHOT_IDENTITY_FIELDS`. Adding a field to the constant therefore fails
 * here until a new migration backfills it — which is the whole point: a field
 * that stops being written but is never erased leaves the old rows stamped
 * forever, and that was the defect PR D could not reach on its own.
 *
 * Run with: node --test tests/snapshot-identity-backfill-coverage.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SNAPSHOT_IDENTITY_FIELDS } from '../server/storage/presentations/snapshot-identity.js';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'server',
  'db',
  'migrations'
);

/**
 * Union of `STRIPPED_SNAPSHOT_FIELDS` over every migration that declares one,
 * mapped to the migration that declared it.
 * @returns {Promise<Map<string, string[]>>} field -> declaring migration files
 */
async function collectStrippedFields() {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.js'))
    .sort();
  const byField = new Map();
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(MIGRATIONS_DIR, file)).href);
    const declared = mod.STRIPPED_SNAPSHOT_FIELDS;
    if (!declared) continue;
    assert.ok(
      Array.isArray(declared),
      `${file} exports STRIPPED_SNAPSHOT_FIELDS but it is not an array`
    );
    for (const field of declared) {
      byField.set(field, [...(byField.get(field) || []), file]);
    }
  }
  return byField;
}

test('every snapshot identity field has a migration that erased it from old rows', async () => {
  const byField = await collectStrippedFields();
  const missing = SNAPSHOT_IDENTITY_FIELDS.filter((f) => !byField.has(f));
  assert.deepEqual(
    missing,
    [],
    `no migration erases ${missing.join(', ')} from presentation_versions.presentation_data — ` +
      'add one (see migration 068) and export STRIPPED_SNAPSHOT_FIELDS from it'
  );
});

test('the backfill declares nothing that is not an identity field', async () => {
  const byField = await collectStrippedFields();
  const stray = [...byField.keys()].filter((f) => !SNAPSHOT_IDENTITY_FIELDS.includes(f));
  assert.deepEqual(
    stray,
    [],
    'a migration erased a snapshot key that is not on the identity list — ' +
      'either it is identity (add it to SNAPSHOT_IDENTITY_FIELDS) or it was data loss'
  );
});
