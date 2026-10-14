/**
 * Import regenerates every slide id (`normalizeDeckSlide` /
 * `newSlide`), so a `#slide:<old id>` jump written into a `url`-typed field
 * (a card, an action button, a logo-wall link - at slide level or inside an
 * `items` field's `itemFields`) pointed nowhere after a JSON import. This
 * pins the fix in `deckToPresentationParts` (`shared/slide-types/deck.js`):
 * one old→new id map, rewritten via the field declaration, no key list (B314).
 *
 * Run with: node --test tests/deck-import-slide-jump-rewrite.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { deckToPresentationParts } from '../shared/slide-types/deck.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { slideJumpTarget } from '../shared/slide-types/helpers.js';

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

  const { slides } = deckToPresentationParts(raw, { slideTypes: SLIDE_TYPES });
  assert.notEqual(slides[0].id, 'old-1', 'ids are regenerated on import');
  assert.notEqual(slides[1].id, 'old-2');
  assert.equal(
    slides[0].content.actions[0].url,
    `#slide:${slides[1].id}`,
    "the action url now points at slide two's new id",
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

  const { slides } = deckToPresentationParts(raw, { slideTypes: SLIDE_TYPES });
  assert.equal(
    slides[1].content.contactUrl,
    `#slide:${slides[0].id}`,
    "the contactUrl jump now points at slide one's new id",
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

  const { slides } = deckToPresentationParts(raw, { slideTypes: SLIDE_TYPES });
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

  const { slides } = deckToPresentationParts(raw, { slideTypes: SLIDE_TYPES });
  assert.equal(slides[0].content.contactUrl, 'https://example.com');
  assert.equal(slides[1].content.actions[0].url, '#1');
});

test('a portable deck import (no per-slide id) keeps its positional jump on target', () => {
  // The portable deck carries no slide ids; its export writes an in-deck jump
  // as `#N` on the exported order (B494, tests/deck-export-slide-jumps.test.js),
  // so the import keeps it and it lands on the same slide.
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
          body: 'Body',
          actions: [{ label: 'Go to two', url: '#2' }],
        },
      },
      { type: 'end-slide', content: { title: 'Slide two' } },
    ],
  };

  const { slides } = deckToPresentationParts(raw, { slideTypes: SLIDE_TYPES });
  const jump = slideJumpTarget(slides[0].content.actions[0].url);
  assert.equal(
    slides[jump.index - 1].content.title,
    'Slide two',
    'the positional jump reaches slide two of the imported deck',
  );
});
