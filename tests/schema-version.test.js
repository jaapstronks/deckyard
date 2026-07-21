import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_MIGRATIONS,
  migratePresentation,
  schemaVersionOf,
} from '../shared/slide-types/schema-version.js';
import {
  newPresentation,
  validatePresentation,
} from '../shared/slide-types/presentation.js';
import {
  readPresentation,
  writePresentation,
} from '../server/storage/presentations/io.js';

/** A minimal pre-versioning deck (no schemaVersion stamp). */
function legacyDeck() {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: 'Legacy deck',
    description: '',
    created: now,
    modified: now,
    theme: 'default',
    lang: 'nl',
    settings: {},
    slides: [
      {
        id: randomUUID(),
        type: 'title-slide',
        parentId: null,
        content: { title: 'Hi' },
        visibility: {},
      },
    ],
  };
}

test('the migrations array has exactly one step per version bump', () => {
  // Bumping CURRENT_SCHEMA_VERSION without adding a migration should fail here.
  assert.equal(SCHEMA_MIGRATIONS.length, CURRENT_SCHEMA_VERSION);
});

test('newPresentation() stamps the current schema version', () => {
  const pres = newPresentation({});
  assert.equal(pres.schemaVersion, CURRENT_SCHEMA_VERSION);
});

test('schemaVersionOf treats missing/garbage stamps as version 0', () => {
  assert.equal(schemaVersionOf(null), 0);
  assert.equal(schemaVersionOf({}), 0);
  assert.equal(schemaVersionOf({ schemaVersion: 'nope' }), 0);
  assert.equal(schemaVersionOf({ schemaVersion: -3 }), 0);
  assert.equal(schemaVersionOf({ schemaVersion: 1 }), 1);
  assert.equal(schemaVersionOf({ schemaVersion: '1' }), 1);
});

test('migrating a legacy deck stamps it current without touching content', () => {
  const legacy = legacyDeck();
  const before = structuredClone(legacy);
  const migrated = migratePresentation(legacy);
  assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
  // Everything else is byte-identical to the original.
  const { schemaVersion, ...rest } = migrated;
  assert.deepEqual(rest, before);
});

test('migration is idempotent', () => {
  const once = migratePresentation(legacyDeck());
  const twice = migratePresentation(structuredClone(once));
  assert.deepEqual(twice, once);
});

test('a deck from a newer build is never downgraded', () => {
  const future = { id: randomUUID(), schemaVersion: 99, title: 'Future' };
  const out = migratePresentation(future);
  assert.equal(out.schemaVersion, 99);
});

test('non-object input passes through untouched', () => {
  assert.equal(migratePresentation(null), null);
  assert.equal(migratePresentation(undefined), undefined);
});

test('the read funnel migrates a stored legacy deck in memory', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'deckyard-schema-version-'));
  const legacy = legacyDeck();
  await writePresentation(repoRoot, legacy); // stored WITHOUT schemaVersion
  const read = await readPresentation(repoRoot, legacy.id);
  assert.equal(read.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(read.id, legacy.id);
  assert.equal(read.slides[0].content.title, 'Hi');
});

test('reading a missing deck stays null', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'deckyard-schema-version-'));
  const read = await readPresentation(repoRoot, randomUUID());
  assert.equal(read, null);
});

test('validatePresentation accepts a freshly stamped deck', () => {
  const { ok, errors } = validatePresentation(newPresentation({ theme: 'deckyard' }));
  assert.equal(ok, true, `unexpected errors: ${errors.join(', ')}`);
});

test('validatePresentation rejects an out-of-range schemaVersion', () => {
  const base = newPresentation({});

  const negative = validatePresentation({ ...base, schemaVersion: -1 });
  assert.equal(negative.ok, false);
  assert.ok(negative.errors.some((e) => /schemaVersion/.test(e)));

  const fractional = validatePresentation({ ...base, schemaVersion: 1.5 });
  assert.equal(fractional.ok, false);
  assert.ok(fractional.errors.some((e) => /non-negative integer/.test(e)));

  const future = validatePresentation({ ...base, schemaVersion: 99 });
  assert.equal(future.ok, false);
  assert.ok(future.errors.some((e) => /newer than this build/.test(e)));
});
