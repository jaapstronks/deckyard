/**
 * Taking in or setting aside a newer library revision on a deck slide (B904):
 * the item's content in every language it has, the deck's own fields kept
 * (D370), a missing language marked outdated rather than retranslated (D371).
 *
 * Run with: node --test tests/library-update.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyLibraryRevision,
  ignoreLibraryRevision,
  libraryItemContentFor,
  slidesBehindLibraryItem,
} from '../shared/slide-library/library-update.js';
import { SLIDE_TYPES } from '../shared/slide-types.js';
import { slideTextRows } from '../shared/i18n-progress.js';
import {
  translationFieldKey,
  translationFieldStatus,
} from '../shared/translation-provenance.js';

const ITEM = '5b0c9d1e-2f3a-4b5c-8d6e-7f8091a2b3c4';

const linked = (over = {}) => ({
  id: 's1',
  type: 'title-slide',
  content: { title: 'Oud' },
  notes: 'Mijn notities',
  duration: 30,
  hideInExport: true,
  parentId: null,
  libraryRef: { itemId: ITEM, revision: 1 },
  ...over,
});

const item = (over = {}) => ({
  id: ITEM,
  revision: 3,
  slideType: 'title-slide',
  content: { title: 'Nieuw' },
  i18n: {
    dominant: 'nl',
    versions: { 'en-GB': { content: { title: 'New' } } },
  },
  ...over,
});

/** A two-language deck, `nl` active. */
function deck(slideNl, slideEn) {
  const slides = [{ id: 'x', type: 'title-slide', content: {} }, slideNl];
  return {
    slides,
    i18n: {
      active: 'nl',
      dominant: 'nl',
      versions: {
        nl: { title: 'Deck', slides },
        'en-GB': {
          title: 'Deck',
          slides: [{ id: 'x', type: 'title-slide', content: {} }, slideEn],
        },
      },
    },
  };
}

test('libraryItemContentFor reads a language version, else the base language only', () => {
  const it = item();
  assert.deepEqual(libraryItemContentFor(it, 'en-GB'), { title: 'New' });
  assert.deepEqual(libraryItemContentFor(it, 'nl'), { title: 'Nieuw' });
  assert.equal(libraryItemContentFor(it, 'de'), null);
});

test('slidesBehindLibraryItem names the linked slides the revision is news for', () => {
  const pres = {
    slides: [
      linked(),
      linked({ id: 's2', libraryRef: { itemId: ITEM, revision: 3 } }),
      linked({
        id: 's3',
        libraryRef: { itemId: ITEM, revision: 1, ignoredRevision: 3 },
      }),
      { id: 's4', type: 'title-slide', content: {} },
    ],
  };
  assert.deepEqual(slidesBehindLibraryItem(pres, ITEM, 3), ['s1']);
  assert.deepEqual(slidesBehindLibraryItem(pres, ITEM, 4).sort(), [
    's1',
    's2',
    's3',
  ]);
});

test('update takes the item content per language and keeps what is the deck’s (D370)', () => {
  const pres = deck(linked(), linked({ content: { title: 'Old' } }));
  const res = applyLibraryRevision(pres, 's1', item(), {
    slideTypes: SLIDE_TYPES,
  });
  assert.deepEqual(res, { updated: ['nl', 'en-GB'], outdated: [] });
  const nl = pres.slides[1];
  const en = pres.i18n.versions['en-GB'].slides[1];
  assert.deepEqual(nl.content, { title: 'Nieuw' });
  assert.deepEqual(en.content, { title: 'New' });
  for (const s of [nl, en]) {
    assert.deepEqual(s.libraryRef, { itemId: ITEM, revision: 3 });
    assert.equal(s.id, 's1');
    assert.equal(s.notes, 'Mijn notities');
    assert.equal(s.duration, 30);
    assert.equal(s.hideInExport, true);
  }
  assert.equal(pres.slides.indexOf(nl), 1, 'position unchanged');
});

test('update copies, so a later edit of the item does not reach the deck', () => {
  const it = item();
  const pres = deck(linked(), linked());
  applyLibraryRevision(pres, 's1', it, { slideTypes: SLIDE_TYPES });
  it.content.title = 'Later';
  assert.equal(pres.slides[1].content.title, 'Nieuw');
});

test('a deck language the item lacks keeps its text and reads as changed (D371)', () => {
  const pres = deck(linked(), linked({ content: { title: 'Old' } }));
  const it = item({ i18n: { dominant: 'nl', versions: {} } });
  const res = applyLibraryRevision(pres, 's1', it, {
    slideTypes: SLIDE_TYPES,
  });
  assert.deepEqual(res, { updated: ['nl'], outdated: ['en-GB'] });
  const en = pres.i18n.versions['en-GB'];
  assert.equal(en.slides[1].content.title, 'Old');
  assert.deepEqual(en.slides[1].libraryRef, { itemId: ITEM, revision: 3 });

  const [row] = slideTextRows(
    { slides: [pres.slides[1]] },
    { slides: [en.slides[1]] },
    { slideTypes: SLIDE_TYPES },
  ).filter((r) => r.kind === 'slide');
  const record =
    en.translationSources[translationFieldKey(row.slideId, row.path)];
  assert.equal(translationFieldStatus(row, 'nl', record), 'changed');
});

test('a field the revision left alone stays current in the outdated language', () => {
  const pres = deck(
    linked({ content: { title: 'Zelfde', subheading: 'Oud' } }),
    linked({ content: { title: 'Same', subheading: 'Old' } }),
  );
  const it = item({
    content: { title: 'Zelfde', subheading: 'Nieuw' },
    i18n: { dominant: 'nl', versions: {} },
  });
  applyLibraryRevision(pres, 's1', it, { slideTypes: SLIDE_TYPES });
  const en = pres.i18n.versions['en-GB'];
  const rows = slideTextRows(
    { slides: [pres.slides[1]] },
    { slides: [en.slides[1]] },
    { slideTypes: SLIDE_TYPES },
  ).filter((r) => r.kind === 'slide' && r.source.trim());
  const status = Object.fromEntries(
    rows.map((r) => [
      r.key,
      translationFieldStatus(
        r,
        'nl',
        en.translationSources[translationFieldKey(r.slideId, r.path)],
      ),
    ]),
  );
  assert.deepEqual(status, { title: 'current', subheading: 'changed' });
});

test('a single-language deck in a language the item lacks still takes its text', () => {
  const pres = { lang: 'de', slides: [linked()] };
  const res = applyLibraryRevision(pres, 's1', item(), {
    slideTypes: SLIDE_TYPES,
  });
  assert.deepEqual(res, { updated: ['de'], outdated: [] });
  assert.deepEqual(pres.slides[0].content, { title: 'Nieuw' });
});

test('update keeps the slide’s own instance keys', () => {
  const pres = {
    slides: [
      linked({
        type: 'poll-slide',
        content: { question: 'Oud?', pollId: 'deck-poll' },
      }),
    ],
  };
  const it = item({
    slideType: 'poll-slide',
    content: { question: 'Nieuw?', pollId: 'library-poll' },
    i18n: {},
  });
  applyLibraryRevision(pres, 's1', it, { slideTypes: SLIDE_TYPES });
  assert.equal(pres.slides[0].content.pollId, 'deck-poll');
  assert.equal(pres.slides[0].content.question, 'Nieuw?');
});

test('update refuses a slide that is not linked to the item', () => {
  const pres = { slides: [linked({ libraryRef: undefined })] };
  assert.equal(applyLibraryRevision(pres, 's1', item()), null);
  assert.equal(pres.slides[0].content.title, 'Oud');
});

test('ignore remembers the revision in every version, so only a later one is news', () => {
  const pres = deck(linked(), linked());
  assert.equal(ignoreLibraryRevision(pres, 's1', 3), true);
  for (const s of [pres.slides[1], pres.i18n.versions['en-GB'].slides[1]]) {
    assert.deepEqual(s.libraryRef, {
      itemId: ITEM,
      revision: 1,
      ignoredRevision: 3,
    });
  }
  assert.deepEqual(slidesBehindLibraryItem(pres, ITEM, 3), []);
  assert.deepEqual(slidesBehindLibraryItem(pres, ITEM, 4), ['s1']);
  assert.equal(ignoreLibraryRevision(pres, 's1', 3), false);
});
