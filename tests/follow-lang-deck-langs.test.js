/**
 * The follow view's language switcher offers the deck's own versions (B467,
 * D222; same rule as D115 for the presenter).
 *
 * With fewer than two versions it used to fall back to the frozen pair
 * `DEFAULT_SUPPORTED_DECK_LANGS` (`nl`, `en-GB`), so a `de`-only deck showed
 * `NL EN` and a choice landed on a version that does not exist. The list is now
 * exactly `meta.availableLangs`; fewer than two means no switcher.
 *
 * Run with: node --test tests/follow-lang-deck-langs.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/follow/abc',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;

const { renderFollowLangButtons } =
  await import('../client/views/follow/lang.js');

const render = (availableLangs, currentLang = availableLangs[0]) => {
  const langWrap = document.createElement('div');
  renderFollowLangButtons({ langWrap, currentLang, availableLangs });
  return langWrap;
};

const offered = (wrap) =>
  [...wrap.querySelectorAll('button, option')].map((n) =>
    n.tagName === 'OPTION' ? n.value : n.textContent,
  );

test('a de-only deck shows no switcher', () => {
  const wrap = render(['de']);
  assert.equal(wrap.style.display, 'none');
  assert.deepEqual(offered(wrap), []);
});

test('a deck with no versions reported shows no switcher', () => {
  const wrap = render([], 'nl');
  assert.equal(wrap.style.display, 'none');
  assert.deepEqual(offered(wrap), []);
});

test('an nl+de deck offers exactly NL and DE, never EN', () => {
  const wrap = render(['nl', 'de']);
  assert.equal(wrap.style.display, '');
  assert.deepEqual(offered(wrap), ['NL', 'DE']);
});

test('three versions become a dropdown with exactly those three', () => {
  const wrap = render(['nl', 'de', 'fr'], 'de');
  assert.deepEqual(offered(wrap), ['nl', 'de', 'fr']);
  assert.equal(wrap.querySelector('select').value, 'de');
});

test('the follow view no longer knows the frozen default pair', () => {
  const src = readFileSync(
    new URL('../client/views/follow/lang.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(src, /DEFAULT_SUPPORTED_DECK_LANGS/);
});
