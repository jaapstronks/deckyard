/**
 * B603: a deck composed from library items starts in the language its slides
 * are written in.
 *
 * `deckLangForLibraryItems` (client/views/slide-library/compose.js) is the one
 * rule both "Use -> New presentation" in the library and the creation view's
 * seeded "From the library" flow apply: the caller's preferred language holds
 * when every item has content in it, else the one language the items share.
 *
 * Run with: node --test tests/library-deck-language.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { deckLangForLibraryItems } from '../client/views/slide-library/compose.js';
import { repoRoot } from '../server/config/paths.js';
import { readSandboxLibrarySeed } from '../server/sandbox/library.js';

const english = {
  content: { title: 'Hello' },
  i18n: { dominant: 'en-GB' },
};
const bilingual = {
  content: { title: 'Hallo' },
  i18n: {
    dominant: 'nl',
    versions: {
      nl: { content: { title: 'Hallo' } },
      'en-GB': { content: { title: 'Hello' } },
    },
  },
};
const dutch = { content: { title: 'Hallo' }, i18n: { dominant: 'nl' } };

test('English slides make an English deck, whatever the library switch says', () => {
  assert.equal(deckLangForLibraryItems([english], 'nl'), 'en-GB');
  assert.equal(deckLangForLibraryItems([english, english], 'nl'), 'en-GB');
});

test('the preference holds when every item has content in it', () => {
  assert.equal(deckLangForLibraryItems([bilingual], 'en-GB'), 'en-GB');
  assert.equal(deckLangForLibraryItems([bilingual], 'nl'), 'nl');
  assert.equal(deckLangForLibraryItems([english, bilingual], 'en-GB'), 'en-GB');
});

test('items that share no single language keep the preference', () => {
  assert.equal(deckLangForLibraryItems([english, dutch], 'de'), 'de');
});

test('an item that names no language is read as the default deck language', () => {
  assert.equal(deckLangForLibraryItems([{ content: {} }], 'nl'), 'nl');
  assert.equal(deckLangForLibraryItems([], 'en'), 'en-GB');
});

test('a deck from any sandbox seed slide is English (B603)', async () => {
  const { slides } = await readSandboxLibrarySeed(repoRoot);
  for (const slide of slides) {
    const item = { content: slide.content, i18n: { dominant: slide.lang } };
    assert.equal(slide.lang, 'en-GB', `${slide.key} declares en-GB`);
    assert.equal(deckLangForLibraryItems([item], 'nl'), 'en-GB', slide.key);
  }
});
