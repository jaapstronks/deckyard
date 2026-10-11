/**
 * Deck search reads a slide's words through the type's own declaration
 * (`slideProse`), not a hand-kept list of field names (B257 B1-rest). That list
 * read ten keys no current type declares (`cards`, `steps`, `events`, …) and
 * missed every item text that was not `title`/`text`/`label`; and the language
 * versions it searched (`pres.i18n.slides`) are a shape storage no longer has,
 * so a match in a translation was never found.
 *
 * Run with: node --test tests/deck-search-slide-text.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractSlideText,
  normalizeForSearch,
  slideMatchLocation,
} from '../server/services/deck-search.js';

const find = (pres, q) => slideMatchLocation(pres, normalizeForSearch(q));

test('item texts are found at every field the type declares', () => {
  const slide = {
    type: 'list-slide',
    content: {
      title: 'Plan',
      items: [
        { title: 'Kickoff', text: 'Gather the team' },
        { title: 'Launch', text: 'Ship it' },
      ],
    },
  };
  const text = extractSlideText(slide);
  // The old extractor took an item's `text` and stopped: `title` was lost.
  for (const word of ['Plan', 'Kickoff', 'Gather', 'Launch', 'Ship'])
    assert.ok(text.includes(word), word);
});

test('machine values are not searchable text', () => {
  const text = extractSlideText({
    type: 'list-slide',
    content: { title: 'Plan', variant: 'numbers', items: [] },
  });
  assert.equal(text.includes('numbers'), false);
});

test('a match in a language version finds the slide', () => {
  const pres = {
    slides: [
      { id: 'a', type: 'title-slide', content: { title: 'Welcome' } },
      { id: 'b', type: 'title-slide', content: { title: 'Results' } },
    ],
    i18n: {
      versions: {
        nl: {
          slides: [
            { id: 'b', type: 'title-slide', content: { title: 'Resultaten' } },
            { id: 'a', type: 'title-slide', content: { title: 'Welkom' } },
          ],
        },
      },
    },
  };
  // Matched by id, not position: `Resultaten` belongs to slide 2.
  assert.equal(find(pres, 'resultaten'), 'slide 2');
  assert.equal(find(pres, 'welkom'), 'slide 1');
  assert.equal(find(pres, 'nowhere'), null);
});

test('deck-search names no content key of its own', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(
    new URL('../server/services/deck-search.js', import.meta.url),
    'utf8',
  );
  for (const key of [
    'text',
    'description',
    'attribution',
    'cards',
    'headers',
    'steps',
    'quadrants',
    'columns',
    'events',
    'altText',
  ])
    assert.equal(
      new RegExp(`content\\??\\.${key}\\b`).test(src),
      false,
      `content.${key}`,
    );
});
