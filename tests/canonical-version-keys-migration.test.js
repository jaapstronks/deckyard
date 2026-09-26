/**
 * Migration 083 (B481): stored language versions move to their canonical key.
 *
 * An alias key whose canonical key is free is renamed; an alias next to its
 * canonical key, or an off-axis key, is left for an operator — the migration
 * does not choose between two versions of one language.
 *
 * The per-block rule is tested here; which rows `up` reads is a SQL filter, so
 * that half runs against real PostgreSQL in
 * tests/pg/canonical-version-keys-migration.pgtest.js.
 *
 * Run with: node --test tests/canonical-version-keys-migration.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalizeVersionKeys } from '../server/db/migrations/083_canonical_version_keys.js';

const v = (title) => ({ title, slides: [] });

test('an alias with a free canonical key is renamed, order kept', () => {
  const { i18n, leftovers } = canonicalizeVersionKeys({
    dominant: 'nl',
    versions: { nl: v('Dek'), en: v('Deck') },
  });
  assert.deepEqual(i18n, {
    dominant: 'nl',
    versions: { nl: v('Dek'), 'en-GB': v('Deck') },
  });
  assert.deepEqual(leftovers, []);
});

test('an alias next to its canonical key, or an off-axis key, is left alone', () => {
  const { i18n, leftovers } = canonicalizeVersionKeys({
    versions: { 'en-GB': v('A'), en: v('B'), xx: v('C') },
  });
  assert.equal(i18n, null, 'nothing renamed, nothing rewritten');
  assert.deepEqual(leftovers, ['en', 'xx']);
});

test('a canonical block is untouched', () => {
  assert.deepEqual(canonicalizeVersionKeys({ versions: { nl: v('Dek') } }), {
    i18n: null,
    leftovers: [],
  });
  assert.deepEqual(canonicalizeVersionKeys(null), {
    i18n: null,
    leftovers: [],
  });
});
