/**
 * A lossless type rename reaches a stored deck through the read funnel (B223).
 *
 * The rename used to live in two places a human had to aim: a numbered SQL
 * migration, which only touches the database it runs against, and a
 * `scripts/migrate-*.js` one-off, which only ever runs "where someone
 * remembers to run it". Anything holding decks outside that reach — a data
 * directory waiting to be imported, an export, a fork on its own store — kept
 * the retired name and rendered those slides as *archived*. The CIIIC fork
 * still had 35 of 35 stored decks (248 slides) on `lijstje-slide` on
 * 2026-09-03, five weeks after the rename shipped.
 *
 * `migratePresentation()` is the one path every deck already passes through,
 * on every read and every write and on import, so that is where the rename
 * belongs. This file pins both ends of it: the storage read (a stored row
 * carrying the retired name comes back renamed) and the import seam (a deck
 * that was never in this database at all).
 *
 * The unit-level behaviour of the step — every language version, idempotence,
 * and the fact that a *conversion* is never applied silently — lives in
 * tests/schema-version.test.js.
 *
 * Run with: node --test tests/lossless-type-rename-funnel.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { testScope } from './helpers/storage-scope.js';
import { userRows } from './helpers/identity-fixtures.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb, getDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createPresentation, getPresentation } =
  await import('../server/storage/presentations/index.js');
const { deckToPresentationParts } =
  await import('../shared/slide-types/deck.js');

const OWNER = 'owner@example.com';

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      users: userRows(OWNER),
    }),
  );
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

/** The slide body a `lijstje-slide` and a `list-slide` both store, unchanged. */
function listContent() {
  return {
    title: 'Drie punten',
    subheading: '',
    variant: 'bullets',
    layout: 'auto',
    items: [
      { title: 'Een', text: 'eerste punt' },
      { title: 'Twee', text: 'tweede punt' },
    ],
  };
}

/**
 * A deck whose stored `slides` still carry the retired name — the shape a
 * store has when the rename migration never ran against it.
 *
 * Written straight into the row rather than through `updatePresentation`,
 * because the write path runs the same funnel: a deck that arrives through it
 * has already been renamed, which is the opposite of what this sets up.
 *
 * @param {Array<Object>} slides - Stored slide objects.
 * @param {Object|null} i18n - Stored i18n block, or `null`.
 * @returns {Promise<string>} the presentation id
 */
async function storeDeckWithRawSlides(slides, i18n = null) {
  const scope = testScope({ actorEmail: OWNER });
  const created = await createPresentation(scope, {
    title: 'Legacy list deck',
    ownerEmail: OWNER,
  });
  await getDb()
    .updateTable('presentations')
    .set({
      slides: JSON.stringify(slides),
      ...(i18n ? { i18n: JSON.stringify(i18n) } : {}),
    })
    .where('id', '=', created.id)
    .execute();
  return created.id;
}

test('a stored deck on the retired name reads back as its successor', async () => {
  const id = await storeDeckWithRawSlides([
    { id: 's1', type: 'lijstje-slide', content: listContent(), notes: '' },
  ]);

  const deck = await getPresentation(testScope({ actorEmail: OWNER }), id);

  assert.equal(deck.slides[0].type, 'list-slide');
  assert.deepEqual(
    deck.slides[0].content.items,
    listContent().items,
    'a lossless rename touches the type and nothing else',
  );
});

test('the rename reaches a stored translation, not only the dominant version', async () => {
  // The half a per-deck script gets wrong even when it does run: a stored
  // `i18n.versions[*]` is a second copy of every slide, and a version left on
  // the retired name renders archived in that language alone.
  const slide = (title) => ({
    id: 's1',
    type: 'lijstje-slide',
    content: { ...listContent(), title },
    notes: '',
  });
  const id = await storeDeckWithRawSlides([slide('Drie punten')], {
    dominant: 'nl',
    active: 'nl',
    versions: {
      nl: { title: 'nl', slides: [slide('Drie punten')] },
      'en-GB': { title: 'en', slides: [slide('Three points')] },
    },
  });

  const deck = await getPresentation(testScope({ actorEmail: OWNER }), id);

  for (const lang of ['nl', 'en-GB']) {
    assert.equal(deck.i18n.versions[lang].slides[0].type, 'list-slide', lang);
  }
});

test('an imported deck on the retired name arrives as its successor', async () => {
  // The seam a `scripts/` one-off cannot cover at all: an export handed to
  // this install was never in any store the script could be pointed at.
  const parts = deckToPresentationParts({
    title: 'Old export',
    slides: [
      { id: 's1', type: 'lijstje-slide', content: listContent(), notes: '' },
    ],
  });

  assert.equal(parts.slides[0].type, 'list-slide');
  assert.deepEqual(parts.slides[0].content.items, listContent().items);
});
