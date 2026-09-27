/**
 * Migration 084 (B482): stored slide-library language versions, and the
 * `dominant` that names one, move to their canonical form.
 *
 * The per-block rule is tested here; which rows `up` reads is a SQL filter,
 * so that half runs against real PostgreSQL in
 * tests/pg/library-canonical-version-keys-migration.pgtest.js.
 *
 * Run with: node --test tests/library-canonical-version-keys-migration.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalizeLibraryI18n } from '../server/db/migrations/084_library_canonical_version_keys.js';

const v = (title) => ({ content: { title } });

test('an alias key with a free canonical key is renamed, and its dominant with it', () => {
  const { i18n, leftovers } = canonicalizeLibraryI18n({
    dominant: 'en',
    versions: { nl: v('Hallo'), en: v('Hello') },
  });
  assert.deepEqual(i18n, {
    dominant: 'en-GB',
    versions: { nl: v('Hallo'), 'en-GB': v('Hello') },
  });
  assert.deepEqual(leftovers, []);
});

test('an alias dominant alone is normalized', () => {
  const { i18n } = canonicalizeLibraryI18n({
    dominant: 'en',
    versions: { 'en-GB': v('Hello') },
  });
  assert.deepEqual(i18n, {
    dominant: 'en-GB',
    versions: { 'en-GB': v('Hello') },
  });
});

test('an alias next to its canonical key, an off-axis key or dominant, is left alone', () => {
  const { i18n, leftovers } = canonicalizeLibraryI18n({
    dominant: 'xx',
    versions: { 'en-GB': v('A'), en: v('B'), yy: v('C') },
  });
  assert.equal(i18n, null, 'nothing renamed, nothing rewritten');
  assert.deepEqual(leftovers, ['versions.en', 'versions.yy', 'dominant xx']);
});

test('a canonical block is untouched', () => {
  assert.deepEqual(
    canonicalizeLibraryI18n({ dominant: 'nl', versions: { nl: v('Hallo') } }),
    { i18n: null, leftovers: [] },
  );
  assert.deepEqual(canonicalizeLibraryI18n({}), { i18n: null, leftovers: [] });
  assert.deepEqual(canonicalizeLibraryI18n(null), {
    i18n: null,
    leftovers: [],
  });
});
