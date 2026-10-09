/**
 * One plural seam in `t()` (B625).
 *
 * A counted noun passes both English forms, `t(key, { one, many }, { count })`,
 * and the seam picks the form with `Intl.PluralRules` on the UI locale, looked
 * up as `<key>.one` / `<key>.many`. Three things are pinned here against the
 * copy that ships:
 *
 *   1. **en and nl pick by the count**: 1 is `one`, 0 and 2 are `many`.
 *   2. **A locale without the form gets the English of the same form**, never
 *      its own other form. Swedish `list.home.greetingCount.one` is absent
 *      because "1 presentation" equals the English (D73); its `many` would
 *      render "1 presentationer".
 *   3. **The presenter start screen says "1 slide"**, the case that minted
 *      the item.
 *
 * Run with: node --test tests/ui-i18n-plural.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;

// The locale loader fetches `/client/i18n/<locale>/<component>.json`; serve
// the files from disk so the test reads the copy that ships.
globalThis.fetch = async (url) => {
  const rel = decodeURIComponent(String(url)).replace(/^\//, '');
  try {
    const body = await fs.readFile(path.join(process.cwd(), rel), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { setUiLocale, t, pluralForm } = await import('../client/lib/ui-i18n.js');

const greeting = (count) =>
  t(
    'list.home.greetingCount',
    { one: '1 presentation', many: '{count} presentations' },
    { count },
  );

test('pluralForm folds every non-one category onto many', () => {
  assert.equal(pluralForm('en', 1), 'one');
  assert.equal(pluralForm('en', 0), 'many');
  assert.equal(pluralForm('en', 2), 'many');
  // Polish has `few` (2–4) and `many` (5+): both read the one `many` form.
  assert.equal(pluralForm('pl', 3), 'many');
  assert.equal(pluralForm('pl', 5), 'many');
  // French counts 0 as `one`.
  assert.equal(pluralForm('fr', 0), 'one');
});

test('en picks the form by the count', async () => {
  await setUiLocale('en', { persist: false });
  assert.equal(greeting(1), '1 presentation');
  assert.equal(greeting(0), '0 presentations');
  assert.equal(greeting(2), '2 presentations');
});

test('nl picks the form by the count', async () => {
  await setUiLocale('nl', { persist: false });
  assert.equal(greeting(1), '1 presentatie');
  assert.equal(greeting(3), '3 presentaties');
});

test('sv without a one form falls back to the English one, not its own many', async () => {
  await setUiLocale('sv', { persist: false });
  assert.equal(greeting(1), '1 presentation');
  assert.equal(greeting(4), '4 presentationer');
});

test('the presenter start screen says "1 slide"', async () => {
  const start = (count) =>
    t(
      'presenter.start.slides',
      { one: '1 slide', many: '{count} slides' },
      {
        count,
      },
    );
  await setUiLocale('en', { persist: false });
  assert.equal(start(1), '1 slide');
  assert.equal(start(12), '12 slides');
  await setUiLocale('nl', { persist: false });
  assert.equal(start(1), '1 slide');
});

test('a key the dictionary lacks renders the English of the chosen form', async () => {
  await setUiLocale('en', { persist: false });
  const v = (count) =>
    t(
      'test.absent.plural',
      { one: 'one {count}', many: 'many {count}' },
      {
        count,
      },
    );
  assert.equal(v(1), 'one 1');
  assert.equal(v(7), 'many 7');
});
