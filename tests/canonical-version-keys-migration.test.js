/**
 * Migration 083 (B481): stored language versions move to their canonical key.
 *
 * An alias key whose canonical key is free is renamed; an alias next to its
 * canonical key, or an off-axis key, is left for an operator — the migration
 * does not choose between two versions of one language.
 *
 * Run with: node --test tests/canonical-version-keys-migration.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalizeVersionKeys,
  up,
} from '../server/db/migrations/083_canonical_version_keys.js';

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

test('up rewrites decks and snapshots, and only the rows that need it', async () => {
  const tables = {
    presentations: [
      { id: 'p1', i18n: { versions: { nl: v('Dek'), en: v('Deck') } } },
      { id: 'p2', i18n: { versions: { nl: v('Dek') } } },
    ],
    presentation_versions: [
      {
        id: 'v1',
        presentation_data: {
          title: 'Dek',
          i18n: { versions: { en: v('Deck') } },
        },
      },
    ],
  };
  const updates = [];
  const db = {
    selectFrom: (table) => ({
      select: () => ({ execute: async () => tables[table] }),
    }),
    updateTable: (table) => ({
      set: (patch) => ({
        where: (_col, _op, id) => ({
          execute: async () => updates.push({ table, id, patch }),
        }),
      }),
    }),
  };

  await up(db);

  assert.deepEqual(
    updates.map(({ table, id }) => `${table}:${id}`),
    ['presentations:p1', 'presentation_versions:v1'],
  );
  assert.deepEqual(JSON.parse(updates[0].patch.i18n).versions, {
    nl: v('Dek'),
    'en-GB': v('Deck'),
  });
  const snapshot = JSON.parse(updates[1].patch.presentation_data);
  assert.equal(snapshot.title, 'Dek', 'the rest of the snapshot is kept');
  assert.deepEqual(Object.keys(snapshot.i18n.versions), ['en-GB']);
});
