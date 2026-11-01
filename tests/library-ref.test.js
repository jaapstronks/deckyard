/**
 * A deck slide's library provenance (B904, D223): one canonical shape, the
 * same for every language version of a slide, carried by both insert paths,
 * and never part of the portable deck.
 *
 * The storage half (link rows, the item save's notification) is
 * tests/pg/slide-library-links.pgtest.js.
 *
 * Run with: node --test tests/library-ref.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  alignLibraryRefs,
  isNewerLibraryRevision,
  libraryLinksOf,
  libraryRefForItem,
  normalizeLibraryRef,
} from '../shared/slide-library/library-ref.js';
import { normalizeSlides } from '../server/storage/presentations/slides.js';
import { normalizeI18n } from '../server/storage/presentations/i18n.js';
import { presentationToDeck } from '../shared/slide-types/deck.js';
import { buildSlidesFromLibraryItems } from '../client/views/slide-library/compose.js';
import {
  buildLibraryUpdateNotificationInput,
  ownerMayReadItem,
} from '../server/services/library-revision-notifications.js';

const ITEM = '5b0c9d1e-2f3a-4b5c-8d6e-7f8091a2b3c4';

test('normalizeLibraryRef keeps the canonical shape and drops anything else', () => {
  assert.deepEqual(normalizeLibraryRef({ itemId: ITEM, revision: 2 }), {
    itemId: ITEM,
    revision: 2,
  });
  assert.deepEqual(
    normalizeLibraryRef({
      itemId: ITEM.toUpperCase(),
      revision: 2,
      ignoredRevision: 4,
      extra: true,
    }),
    { itemId: ITEM, revision: 2, ignoredRevision: 4 },
  );
  // An ignored revision at or below the copy means nothing.
  assert.deepEqual(
    normalizeLibraryRef({ itemId: ITEM, revision: 2, ignoredRevision: 2 }),
    { itemId: ITEM, revision: 2 },
  );
  for (const bad of [
    null,
    'x',
    [],
    { itemId: 'not-a-uuid', revision: 1 },
    { itemId: ITEM },
    { itemId: ITEM, revision: -1 },
    { itemId: ITEM, revision: 1.5 },
  ])
    assert.equal(normalizeLibraryRef(bad), null, JSON.stringify(bad));
});

test('a newer revision is newer than both the copy and what was ignored', () => {
  const ref = { itemId: ITEM, revision: 1 };
  assert.equal(isNewerLibraryRevision(ref, 1), false);
  assert.equal(isNewerLibraryRevision(ref, 2), true);
  const ignored = { ...ref, ignoredRevision: 3 };
  assert.equal(isNewerLibraryRevision(ignored, 3), false);
  assert.equal(isNewerLibraryRevision(ignored, 4), true);
  assert.equal(isNewerLibraryRevision(null, 4), false);
});

test('libraryRefForItem reads the id and revision of a library item', () => {
  assert.deepEqual(libraryRefForItem({ id: ITEM, revision: 0 }), {
    itemId: ITEM,
    revision: 0,
  });
  assert.equal(libraryRefForItem({ id: ITEM }), null);
  assert.equal(libraryRefForItem(null), null);
});

test('the write seam stores a canonical ref or none', () => {
  const [kept, dropped] = normalizeSlides([
    {
      id: 'a',
      type: 'content-slide',
      content: {},
      libraryRef: { itemId: ITEM, revision: 1, stray: 1 },
    },
    {
      id: 'b',
      type: 'content-slide',
      content: {},
      libraryRef: { itemId: 'x', revision: 1 },
    },
  ]);
  assert.deepEqual(kept.libraryRef, { itemId: ITEM, revision: 1 });
  assert.equal('libraryRef' in dropped, false);
});

test('the version just written decides the ref for every version', () => {
  const ref = { itemId: ITEM, revision: 1, ignoredRevision: 2 };
  const versions = {
    nl: {
      slides: [
        { id: 'a', libraryRef: ref },
        { id: 'b' },
        { id: 'c', libraryRef: { itemId: ITEM, revision: 1 } },
      ],
    },
    'en-GB': {
      slides: [
        { id: 'a', libraryRef: { itemId: ITEM, revision: 1 } },
        { id: 'b', libraryRef: { itemId: ITEM, revision: 1 } },
        { id: 'only-en', libraryRef: { itemId: ITEM, revision: 1 } },
      ],
    },
  };
  alignLibraryRefs(versions, 'nl');
  const en = Object.fromEntries(
    versions['en-GB'].slides.map((s) => [s.id, s.libraryRef]),
  );
  assert.deepEqual(en.a, ref);
  assert.equal(en.b, undefined);
  // A slide the authority lacks keeps what its own version says.
  assert.deepEqual(en['only-en'], { itemId: ITEM, revision: 1 });
});

test('normalizeI18n aligns refs from the active version', () => {
  const ref = { itemId: ITEM, revision: 1, ignoredRevision: 2 };
  const pres = {
    id: 'p',
    title: 'Deck',
    slides: [{ id: 'a', type: 'content-slide', content: {}, libraryRef: ref }],
    i18n: {
      dominant: 'nl',
      active: 'nl',
      versions: {
        nl: { title: 'Deck', slides: [] },
        'en-GB': {
          title: 'Deck',
          slides: [{ id: 'a', type: 'content-slide', content: {} }],
        },
      },
    },
  };
  normalizeI18n(pres);
  assert.deepEqual(pres.i18n.versions['en-GB'].slides[0].libraryRef, ref);
});

test('libraryLinksOf lists each linked slide once, across versions', () => {
  const pres = {
    slides: [
      { id: 'a', libraryRef: { itemId: ITEM, revision: 1 } },
      { id: 'b' },
    ],
    i18n: {
      versions: {
        de: {
          slides: [
            { id: 'a', libraryRef: { itemId: ITEM, revision: 1 } },
            { id: 'z', libraryRef: { itemId: ITEM, revision: 4 } },
          ],
        },
      },
    },
  };
  assert.deepEqual(libraryLinksOf(pres), [
    { slideId: 'a', itemId: ITEM, revision: 1, ignoredRevision: null },
    { slideId: 'z', itemId: ITEM, revision: 4, ignoredRevision: null },
  ]);
});

test('the portable deck never carries a library ref (brief § 11)', () => {
  const deck = presentationToDeck({
    title: 'Deck',
    slides: [
      {
        id: 'a',
        type: 'content-slide',
        content: { title: 'T' },
        libraryRef: { itemId: ITEM, revision: 1 },
      },
    ],
  });
  assert.equal(JSON.stringify(deck).includes('libraryRef'), false);
  assert.equal(JSON.stringify(deck).includes(ITEM), false);
});

test('composing from the library carries each item ref', () => {
  const [slide] = buildSlidesFromLibraryItems([
    {
      id: ITEM,
      revision: 3,
      slideType: 'content-slide',
      content: { title: 'T' },
    },
  ]);
  assert.deepEqual(slide.libraryRef, { itemId: ITEM, revision: 3 });
});

test('only an owner who may read the item hears it changed', () => {
  const owner = 'owner@example.com';
  assert.equal(ownerMayReadItem({ shelf: 'organization' }, owner), true);
  assert.equal(
    ownerMayReadItem(
      { shelf: 'personal', ownerEmail: 'Owner@Example.com' },
      owner,
    ),
    true,
  );
  assert.equal(
    ownerMayReadItem({ shelf: 'personal', ownerEmail: 'x@example.com' }, owner),
    false,
  );
  assert.equal(ownerMayReadItem({ shelf: 'organization' }, ''), false);
});

test('the notification names maker, slide and deck, and opens the slide', () => {
  const input = buildLibraryUpdateNotificationInput({
    deck: { presentationId: 'p1', title: 'Q3', slideIds: ['s 1', 's2'] },
    item: { id: ITEM, name: 'Team', revision: 5 },
    actor: { email: 'maker@example.com', name: 'Riley' },
  });
  assert.equal(input.notificationType, 'library_update');
  assert.equal(input.title, 'Riley updated "Team", which is in "Q3"');
  assert.equal(input.actionUrl, '/app/p1?slideId=s%201');
  assert.equal(input.data.itemId, ITEM);
  assert.equal(input.data.revision, 5);
  assert.deepEqual(input.data.slideIds, ['s 1', 's2']);
});
