/**
 * B286: slide-library items go through the deck schema funnel.
 *
 * A library item is a copy of one slide in its own table, and nothing ran it
 * through `migratePresentation()`: an item saved before v8 kept its numbered
 * `card*` slots, the preview rendered no cards, and "Use" merged the type's
 * seeded placeholder member beside the slots - after which "a populated array
 * wins" kept the placeholder. Reported from slides.ciiic.nl, three
 * `team-cards-slide` items (`_meta` briefing 2026-09-15,
 * slide-library-skips-schema-migrations).
 *
 * Pinned here: the item migrates in every language version, the storage row
 * mapper and the editor insert both run it, a seeded placeholder beside legacy
 * slots folds the slots (which repairs decks that already inserted such an
 * item), and every step of the ledger - including one appended later - reaches
 * the library.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  CURRENT_SCHEMA_VERSION,
  LOSSLESS_TYPE_RENAMES,
  SCHEMA_MIGRATIONS,
  migrateLibraryItem,
  migratePresentation,
} from '../shared/slide-types/schema-version.js';
import { newSlide } from '../shared/slide-types/presentation.js';
import { SLIDE_TYPES } from '../shared/slide-types.js';
import { mapSlideLibraryRow } from '../server/storage/slide-library.js';

/** The stored shape of one of the CIIIC items: slots only, no `members`. */
const legacyTeamCards = (who) => ({
  title: 'De mensen van CIIIC',
  subheading: 'Het team',
  cardCount: '2',
  card1Name: `${who} 1`,
  card1Byline: 'Programma',
  card1Image: 'https://example.test/a.jpg',
  card1ImageFocusY: 30,
  card2Name: `${who} 2`,
  card2Byline: 'Communicatie',
});

const slotKeys = (content) =>
  Object.keys(content).filter((k) => /^(card|logo|option)\d|Count$/.test(k));

const legacyRow = (slideType, content, versions = null) => ({
  id: 'lib-1',
  shelf: 'organization',
  owner_email: 'owner@example.test',
  name: 'Item',
  description: '',
  slide_type: slideType,
  theme_id: null,
  content,
  i18n: versions ? { versions } : {},
  favorites: [],
  trashed_at: null,
  trashed_by: null,
  created_by: null,
  created_by_user_id: null,
  updated_by: null,
  updated_by_user_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

test('a legacy team-cards item folds its slots in content and in every language version', () => {
  const item = migrateLibraryItem({
    slideType: 'team-cards-slide',
    content: legacyTeamCards('Mens'),
    i18n: {
      versions: {
        nl: { content: legacyTeamCards('Mens') },
        'en-GB': { content: legacyTeamCards('Person') },
      },
    },
  });

  for (const [label, content] of [
    ['content', item.content],
    ['nl', item.i18n.versions.nl.content],
    ['en-GB', item.i18n.versions['en-GB'].content],
  ]) {
    assert.equal(content.members.length, 2, label);
    assert.deepEqual(slotKeys(content), [], `${label} keeps slot keys`);
  }
  assert.deepEqual(
    item.i18n.versions['en-GB'].content.members.map((m) => m.name),
    ['Person 1', 'Person 2'],
  );
  assert.equal(item.content.members[0].imageFocusY, 30);
  assert.equal(item.content.title, 'De mensen van CIIIC');
});

test('the storage row mapper returns library items migrated', () => {
  const item = mapSlideLibraryRow(
    legacyRow('team-cards-slide', legacyTeamCards('Mens'), {
      nl: { content: legacyTeamCards('Mens') },
    }),
  );
  assert.deepEqual(
    item.content.members.map((m) => m.name),
    ['Mens 1', 'Mens 2'],
  );
  assert.deepEqual(slotKeys(item.i18n.versions.nl.content), []);
  assert.equal(item.slideType, 'team-cards-slide');
});

test('logo-wall and poll items migrate too', () => {
  const logos = migrateLibraryItem({
    slideType: 'logo-wall-slide',
    content: { logoCount: '2', logo1Name: 'A', logo2Image: '/b.png' },
  });
  assert.deepEqual(
    logos.content.logos.map((l) => l.name || l.image),
    ['A', '/b.png'],
  );
  assert.deepEqual(slotKeys(logos.content), []);

  const poll = migrateLibraryItem({
    slideType: 'poll-slide',
    content: { question: 'Welke?', option1: 'Ja', option3: 'Nee' },
  });
  assert.deepEqual(poll.content.options, [{ text: 'Ja' }, { text: 'Nee' }]);
  assert.deepEqual(slotKeys(poll.content), []);
});

test('"Use" on a migrated item yields the real members and no slot keys', () => {
  // The editor insert: migrate, then `newSlide` merges the type defaults under
  // the content. Before B286 the defaults' placeholder member won.
  const item = migrateLibraryItem({
    slideType: 'team-cards-slide',
    content: legacyTeamCards('Mens'),
  });
  const slide = newSlide({
    type: item.slideType,
    slideTypes: SLIDE_TYPES,
    content: item.content,
  });
  assert.deepEqual(
    slide.content.members.map((m) => m.name),
    ['Mens 1', 'Mens 2'],
  );
  assert.deepEqual(slotKeys(slide.content), []);
});

test('the editor insert migrates before newSlide merges the defaults', () => {
  const src = fs.readFileSync(
    new URL('../client/views/editor/slides-panel.js', import.meta.url),
    'utf8',
  );
  const body = src.slice(src.indexOf('const insertFromLibraryItem'));
  const migrateAt = body.indexOf('migrateLibraryItem(');
  const insertAt = body.indexOf('insertedSlide(');
  assert.ok(migrateAt > 0, 'insertFromLibraryItem calls migrateLibraryItem');
  assert.ok(migrateAt < insertAt, 'and does so before insertedSlide');
});

test('a deck that already inserted a legacy item gets its slots back, not the placeholder', () => {
  // The shape "Use" left behind: the seeded placeholder beside the slots. The
  // fold treats the seed as empty, so the slots are the content (B286 #3).
  const inserted = newSlide({
    type: 'team-cards-slide',
    slideTypes: SLIDE_TYPES,
    content: legacyTeamCards('Mens'),
  });
  assert.equal(inserted.content.members[0].name, 'Title', 'precondition');

  const deck = migratePresentation({ slides: [inserted] });
  const content = deck.slides[0].content;
  assert.deepEqual(
    content.members.map((m) => m.name),
    ['Mens 1', 'Mens 2'],
  );
  assert.deepEqual(slotKeys(content), []);

  // Same for poll, seeded per language.
  const poll = newSlide({
    type: 'poll-slide',
    slideTypes: SLIDE_TYPES,
    lang: 'nl',
    content: { option1: 'Ja', option2: 'Nee' },
  });
  const pollContent = migratePresentation({ slides: [poll] }).slides[0].content;
  assert.deepEqual(pollContent.options, [{ text: 'Ja' }, { text: 'Nee' }]);
});

test('the seed only yields to slots: a seed alone, or real members beside slots, stay', () => {
  const seedOnly = newSlide({
    type: 'team-cards-slide',
    slideTypes: SLIDE_TYPES,
  });
  const before = structuredClone(seedOnly.content.members);
  assert.deepEqual(
    migratePresentation({ slides: [seedOnly] }).slides[0].content.members,
    before,
  );

  const real = migratePresentation({
    slides: [
      {
        type: 'team-cards-slide',
        content: { card1Name: 'Stale', members: [{ name: 'Real' }] },
      },
    ],
  }).slides[0].content;
  assert.deepEqual(real.members, [{ name: 'Real' }]);
});

test('a type-changing step renames the library item type', () => {
  // The names come from the removal record, so a removed type is spelled in
  // one place only (tests/removed-slide-types.test.js).
  const [oldName, successor] = [...LOSSLESS_TYPE_RENAMES][0];
  const item = migrateLibraryItem({
    slideType: oldName,
    content: { title: 'Plan' },
  });
  assert.equal(item.slideType, successor);
  assert.equal(item.content.title, 'Plan');
});

test('every step of the ledger reaches the library, including the last one', () => {
  // A step appended later must cover the library without anyone remembering
  // to: wrap the current last step and check the library item passes it.
  const last = CURRENT_SCHEMA_VERSION - 1;
  const original = SCHEMA_MIGRATIONS[last];
  const seen = [];
  SCHEMA_MIGRATIONS[last] = (pres) => {
    for (const s of pres.slides || []) seen.push(s.content?.marker);
    for (const v of Object.values(pres.i18n?.versions || {}))
      for (const s of v.slides || []) seen.push(s.content?.marker);
    return original(pres);
  };
  try {
    migrateLibraryItem({
      slideType: 'content-slide',
      content: { marker: 'top' },
      i18n: { versions: { nl: { content: { marker: 'nl' } } } },
    });
  } finally {
    SCHEMA_MIGRATIONS[last] = original;
  }
  assert.deepEqual(seen.sort(), ['nl', 'top']);
});

test('the scan script flags old-shape library items and deck slides, and nothing current', async () => {
  const { isUnmigratedLibraryItem, unmigratedDeckSlides } =
    await import('../scripts/scan-unmigrated-content.js');
  assert.equal(
    isUnmigratedLibraryItem({
      slideType: 'team-cards-slide',
      content: legacyTeamCards('Mens'),
    }),
    true,
  );
  assert.equal(
    isUnmigratedLibraryItem({
      slideType: 'team-cards-slide',
      content: { members: [{ name: 'Ada', byline: 'Eng' }] },
    }),
    false,
  );

  const fresh = newSlide({ type: 'team-cards-slide', slideTypes: SLIDE_TYPES });
  const legacy = {
    id: 'old',
    type: 'team-cards-slide',
    content: legacyTeamCards('Mens'),
  };
  const hits = unmigratedDeckSlides({
    slides: [fresh, legacy],
    i18n: { versions: { 'en-GB': { slides: [fresh, legacy] } } },
  });
  assert.deepEqual(
    hits.map((h) => [h.lang, h.slideId]),
    [
      [null, 'old'],
      ['en-GB', 'old'],
    ],
  );
});
