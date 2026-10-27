/**
 * Migration 102 (B257 B5-rest, D359, D360): which keys it strips.
 *
 * The fixture carries the retired spellings measured in stored decks (the B2
 * measurement: title `byline`/`attribution`, process `step*`, countdown
 * `minutes`, matrix `heading`, comparison `leftItems`/`rightItems`, payoff
 * `tagline`), next to declared keys and a raw key the read funnel still folds
 * (`bgImage` -> `slideBgImage`). Only the retired spellings may go: a declared
 * key is content, and a funnel input is content the next read carries over.
 * The SQL walk over the stored columns is pinned against PostgreSQL in
 * tests/pg/strip-undeclared-content-keys-migration.pgtest.js.
 *
 * Run with: node --test tests/strip-undeclared-content-keys-migration.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SLIDE_TYPES } from '../shared/slide-types.js';
import {
  stripDeck,
  stripLibraryItem,
} from '../server/db/migrations/102_strip_undeclared_content_keys.js';
import { DECLARED, legacyDeck } from './helpers/legacy-content-keys.js';

test('strips exactly the legacy keys, in every language version', () => {
  const deck = legacyDeck();
  const tally = new Map();
  assert.equal(stripDeck(deck, SLIDE_TYPES, tally), true);

  const lists = [
    deck.slides,
    deck.i18n.versions.nl.slides,
    deck.i18n.versions['en-GB'].slides,
  ];
  for (const slides of lists) {
    for (const slide of slides) {
      assert.deepEqual(
        slide.content,
        DECLARED[slide.type],
        `${slide.type} keeps its declared keys and nothing else`,
      );
    }
  }
  assert.equal(tally.get('title-slide :: byline'), 3);
  assert.equal(tally.get('payoff-slide :: tagline'), 3);
});

test('a raw key the funnel still folds is kept for the funnel', () => {
  const deck = legacyDeck();
  stripDeck(deck, SLIDE_TYPES, new Map());
  assert.equal(deck.slides[0].content.bgImage, '/uploads/bg.jpg');
});

test('a second run changes nothing', () => {
  const deck = legacyDeck();
  stripDeck(deck, SLIDE_TYPES, new Map());
  const once = structuredClone(deck);
  assert.equal(stripDeck(deck, SLIDE_TYPES, new Map()), false);
  assert.deepEqual(deck, once);
});

test('a slide of an unresolvable type is left as it is', () => {
  const deck = {
    slides: [{ id: 'x', type: 'no-such-slide', content: { anything: 1 } }],
  };
  assert.equal(stripDeck(deck, SLIDE_TYPES, new Map()), false);
  assert.deepEqual(deck.slides[0].content, { anything: 1 });
});

test('a DB-defined type is held to its own fields', () => {
  const slideTypes = {
    ...SLIDE_TYPES,
    'custom-hero': { fields: [{ key: 'headline', type: 'string' }] },
  };
  const deck = {
    slides: [
      {
        id: 'c',
        type: 'custom-hero',
        content: { headline: 'Hoi', removedField: 'weg', slideBgImage: '' },
      },
    ],
  };
  assert.equal(stripDeck(deck, slideTypes, new Map()), true);
  assert.deepEqual(deck.slides[0].content, {
    headline: 'Hoi',
    slideBgImage: '',
  });
});

test('a library item loses the legacy keys in its content and versions', () => {
  const item = {
    slideType: 'payoff-slide',
    content: { tagline: 'Bedankt' },
    i18n: { versions: { 'en-GB': { content: { tagline: 'Thanks' } } } },
  };
  assert.equal(stripLibraryItem(item, SLIDE_TYPES, new Map()), true);
  assert.deepEqual(item.content, {});
  assert.deepEqual(item.i18n.versions['en-GB'].content, {});
});
