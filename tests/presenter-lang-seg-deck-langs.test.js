/**
 * The presenter's language switcher offers the deck's own versions (B207, D115).
 *
 * It used to receive no list at all and fall back to the frozen pair
 * `DEFAULT_SUPPORTED_DECK_LANGS` (`nl`, `en-GB`), so an `nl`+`de` deck showed
 * `NL EN` and its German version could not be picked. The list now comes from
 * `existingVersionLangs(pres)`, the one answer to "which languages does this
 * deck offer", with the language being presented first.
 *
 * Run with: node --test tests/presenter-lang-seg-deck-langs.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/present/abc',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;

const { createPresenterLangSeg, presenterLangChoices } =
  await import('../client/views/presenter/lang-seg.js');
const { existingVersionLangs } = await import('../shared/i18n-progress.js');

const deck = (...langs) => ({
  i18n: {
    dominant: langs[0],
    versions: Object.fromEntries(langs.map((l) => [l, { slides: [] }])),
  },
});

const offered = (seg) =>
  [...seg.el.querySelectorAll('button, option')].map((n) =>
    n.tagName === 'OPTION' ? n.value : n.textContent,
  );

test('an nl+de deck offers exactly nl and de, never en-GB', () => {
  const seg = createPresenterLangSeg({
    modeLang: 'nl',
    deckLangs: existingVersionLangs(deck('nl', 'de')),
  });
  assert.deepEqual(offered(seg), ['NL', 'DE']);
});

test('the language being presented comes first', () => {
  assert.deepEqual(presenterLangChoices(['nl', 'de'], 'de'), ['de', 'nl']);
  const seg = createPresenterLangSeg({
    modeLang: 'de',
    deckLangs: existingVersionLangs(deck('nl', 'de')),
  });
  assert.deepEqual(offered(seg), ['DE', 'NL']);
  assert.ok(seg.el.querySelector('button.is-active').textContent === 'DE');
});

test('three versions become a dropdown with all three', () => {
  const seg = createPresenterLangSeg({
    modeLang: 'en-GB',
    deckLangs: existingVersionLangs(deck('nl', 'de', 'en-GB')),
  });
  assert.equal(seg.el.tagName, 'SELECT');
  assert.deepEqual(offered(seg), ['en-GB', 'nl', 'de']);
});

test('a single-version deck shows no switcher', () => {
  const seg = createPresenterLangSeg({
    modeLang: 'de',
    deckLangs: existingVersionLangs(deck('de')),
  });
  assert.equal(seg.el.children.length, 0);
  assert.equal(seg.el.style.display, 'none');
});

test('the switcher no longer knows the frozen default pair', () => {
  const src = readFileSync(
    new URL('../client/views/presenter/lang-seg.js', import.meta.url),
    'utf8',
  );
  assert.ok(!src.includes('DEFAULT_SUPPORTED_DECK_LANGS'));
});
