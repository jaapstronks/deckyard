/**
 * B314 — import regenerates every slide id (`normalizeDeckSlide` /
 * `newSlide`), so a `#slide:<old id>` jump written into a `url`-typed field
 * (a card, an action button, a logo-wall link - at slide level or inside an
 * `items` field's `itemFields`) pointed nowhere after a JSON import. This
 * pins the fix in `deckToPresentationParts` (`shared/slide-types/deck.js`):
 * one old→new id map, rewritten via the field declaration, no key list.
 *
 * Run with: node --test tests/deck-import-slide-jump-rewrite.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { deckToPresentationParts } from '../shared/slide-types/deck.js';

test('an action-item url jump (items -> itemFields) follows the slide to its new id', () => {
  const raw = {
    title: 'Jump test',
    slides: [
      {
        id: 'old-1',
        type: 'content-slide',
        content: {
          title: 'Slide one',
          actions: [{ label: 'Go to two', url: '#slide:old-2' }],
        },
      },
      {
        id: 'old-2',
        type: 'end-slide',
        content: { title: 'Slide two' },
      },
    ],
  };

  const { slides } = deckToPresentationParts(raw);
  assert.notEqual(slides[0].id, 'old-1', 'ids are regenerated on import');
  assert.notEqual(slides[1].id, 'old-2');
  assert.equal(
    slides[0].content.actions[0].url,
    `#slide:${slides[1].id}`,
    'the action url now points at slide two\'s new id',
  );
});

test('a slide-level url jump (end-slide.contactUrl) follows the slide to its new id', () => {
  const raw = {
    title: 'Jump test',
    slides: [
      {
        id: 'old-1',
        type: 'content-slide',
        content: { title: 'Slide one' },
      },
      {
        id: 'old-2',
        type: 'end-slide',
        content: { title: 'Slide two', contactUrl: '#slide:old-1' },
      },
    ],
  };

  const { slides } = deckToPresentationParts(raw);
  assert.equal(
    slides[1].content.contactUrl,
    `#slide:${slides[0].id}`,
    'the contactUrl jump now points at slide one\'s new id',
  );
});

test('a jump to an id outside the deck is left exactly as written', () => {
  const raw = {
    title: 'Jump test',
    slides: [
      {
        id: 'old-1',
        type: 'end-slide',
        content: { title: 'Slide one', contactUrl: '#slide:not-in-this-deck' },
      },
    ],
  };

  const { slides } = deckToPresentationParts(raw);
  assert.equal(slides[0].content.contactUrl, '#slide:not-in-this-deck');
});

test('a regular web address and a #N position jump are untouched', () => {
  const raw = {
    title: 'Jump test',
    slides: [
      {
        id: 'old-1',
        type: 'end-slide',
        content: { title: 'Slide one', contactUrl: 'https://example.com' },
      },
      {
        id: 'old-2',
        type: 'content-slide',
        content: {
          title: 'Slide two',
          actions: [{ label: 'First slide', url: '#1' }],
        },
      },
    ],
  };

  const { slides } = deckToPresentationParts(raw);
  assert.equal(slides[0].content.contactUrl, 'https://example.com');
  assert.equal(slides[1].content.actions[0].url, '#1');
});

test('a portable .deck import (no per-slide id) does not crash and rewrites nothing', () => {
  // The published deck format carries no `id` on any slide (deck.js top-of-file
  // note) - there is no old id to resolve a jump from, so this is the correct,
  // covered no-op rather than a code path this fix needs to special-case.
  const raw = {
    format: 'deckyard.deck',
    version: 1,
    title: 'Jump test',
    theme: 'default',
    slides: [
      {
        type: 'content-slide',
        content: {
          title: 'Slide one',
          actions: [{ label: 'Stale jump', url: '#slide:old-2' }],
        },
      },
      { type: 'end-slide', content: { title: 'Slide two' } },
    ],
  };

  const { slides } = deckToPresentationParts(raw);
  assert.equal(
    slides[0].content.actions[0].url,
    '#slide:old-2',
    'nothing in the raw deck names an old id, so the value is left as written',
  );
});
