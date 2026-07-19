/**
 * Slide-library i18n persistence (create-flow Slice 2 follow-up).
 *
 * A library slide can carry per-language content (`i18n.versions[lang]`). This
 * covers the two storage-layer halves of the round-trip that were dropping it
 * on Postgres:
 *   - the row mapper surfaces `i18n` (Postgres read path), tested directly on
 *     the pure `mapSlideLibraryRow`;
 *   - the storage facade round-trips `i18n` on create and update (file backend,
 *     which the default test env uses) so both languages survive.
 *
 * The Postgres adapter write path (migration 049 + `slides.js`) can't run in the
 * DB-less test env; it's verified manually against Postgres (see the PR).
 *
 * Run with: node --test tests/slide-library-i18n-storage.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { mapSlideLibraryRow } from '../server/storage/mappers.js';

const BILINGUAL = {
  versions: {
    nl: { content: { title: 'Hallo' } },
    'en-GB': { content: { title: 'Hello' } },
  },
};

describe('mapSlideLibraryRow (Postgres read projection)', () => {
  it('surfaces the i18n column so composed decks keep both languages', () => {
    const mapped = mapSlideLibraryRow({
      id: 'lib-1',
      scope: 'personal',
      owner_email: 'alice@example.com',
      name: 'Intro',
      slide_type: 'content-slide',
      theme_id: null,
      content: { title: 'Hallo' },
      i18n: BILINGUAL,
      favorites: [],
    });
    assert.deepStrictEqual(mapped.i18n, BILINGUAL);
    assert.strictEqual(mapped.i18n.versions.nl.content.title, 'Hallo');
    assert.strictEqual(mapped.i18n.versions['en-GB'].content.title, 'Hello');
  });

  it('defaults i18n to {} when the column is null/absent (older rows)', () => {
    assert.deepStrictEqual(mapSlideLibraryRow({ id: 'x', content: {} }).i18n, {});
    assert.deepStrictEqual(mapSlideLibraryRow({ id: 'y', content: {}, i18n: null }).i18n, {});
  });
});

// The facade round-trip runs against the file backend (the default test env),
// guarding that i18n survives create + update there and stays parity with the
// Postgres fix.
const repoRoot = path.join(os.tmpdir(), `deckyard-lib-i18n-${crypto.randomUUID()}`);
process.env.DATA_DIR = path.join(repoRoot, 'data');

const { initializeStorage, closeStorage } = await import('../server/storage/adapters/index.js');
const { createPersonalLibraryItem, listPersonalLibrary, updatePersonalLibraryItem } = await import(
  '../server/storage/slide-library.js'
);

const ALICE = 'alice@example.com';

describe('slide-library i18n round-trip (facade / file backend)', () => {
  before(async () => {
    await fs.mkdir(process.env.DATA_DIR, { recursive: true });
    await initializeStorage(repoRoot);
  });

  after(async () => {
    await closeStorage();
    await fs.rm(repoRoot, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('keeps both languages through create and update', async () => {
    const created = await createPersonalLibraryItem(
      repoRoot,
      ALICE,
      { name: 'Intro', slideType: 'content-slide', content: { title: 'Hallo' }, i18n: BILINGUAL },
      { actorEmail: ALICE }
    );
    assert.ok(created?.ok && created.item?.id, 'created item has an id');
    assert.deepStrictEqual(created.item.i18n, BILINGUAL, 'i18n survives create');

    const listed = await listPersonalLibrary(repoRoot, ALICE);
    const found = listed.items.find((i) => i.id === created.item.id);
    assert.deepStrictEqual(found?.i18n, BILINGUAL, 'i18n survives read-back');

    const nextI18n = {
      versions: {
        nl: { content: { title: 'Dag' } },
        'en-GB': { content: { title: 'Bye' } },
      },
    };
    const updated = await updatePersonalLibraryItem(
      repoRoot,
      ALICE,
      created.item.id,
      { i18n: nextI18n },
      { actorEmail: ALICE }
    );
    assert.ok(updated?.ok, 'update ok');
    assert.deepStrictEqual(updated.item.i18n, nextI18n, 'i18n survives update');
  });
});
