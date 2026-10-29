/**
 * `formatRelativeTime` speaks the UI locale through CLDR (B148 batch14).
 *
 * The four relative-time formatters it replaced read hand-translated keys:
 * no plurals ("1 dagen geleden"), and past a week a date in the browser's
 * language instead of the interface's. Pinned here with a fixed clock:
 *
 *   1. **Dutch** reads "1 uur geleden", "gisteren" and "nu".
 *   2. **Polish plurals** take the CLDR form per count: 2 godziny, 5 godzin.
 *   3. **A week or older is a date in the UI locale**, whatever the default.
 *   4. **Empty or invalid input** gives an empty string.
 *
 * Run with: node --test tests/format-relative-time.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;

// No dictionary is needed: the wording comes from Intl, not from a key.
globalThis.fetch = async () => ({
  ok: false,
  status: 404,
  json: async () => ({}),
});

const { setUiLocale } = await import('../client/lib/ui-i18n.js');
const { formatRelativeTime } =
  await import('../client/lib/format/format-time.js');

const NOW = Date.parse('2026-10-28T12:00:00Z');
const realNow = Date.now;

/** The ISO timestamp `ms` before the fixed clock. */
const ago = (ms) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

async function inLocale(locale, fn) {
  await setUiLocale(locale, { persist: false, announce: false });
  Date.now = () => NOW;
  try {
    fn();
  } finally {
    Date.now = realNow;
  }
}

test('Dutch: now, one hour, yesterday', async () => {
  await inLocale('nl', () => {
    assert.equal(formatRelativeTime(ago(10_000)), 'nu');
    assert.equal(formatRelativeTime(ago(5 * MINUTE)), '5 minuten geleden');
    assert.equal(formatRelativeTime(ago(HOUR)), '1 uur geleden');
    assert.equal(formatRelativeTime(ago(DAY)), 'gisteren');
    assert.equal(formatRelativeTime(ago(6 * DAY)), '6 dagen geleden');
  });
});

test('Polish: the plural form follows the count', async () => {
  await inLocale('pl', () => {
    assert.equal(formatRelativeTime(ago(2 * HOUR)), '2 godziny temu');
    assert.equal(formatRelativeTime(ago(5 * HOUR)), '5 godzin temu');
  });
});

test('a week or older is a date in the UI locale, not the default one', async () => {
  const then = ago(8 * DAY);
  await inLocale('nl', () => {
    const expected = new Date(then).toLocaleDateString('nl');
    assert.equal(formatRelativeTime(then), expected);
    assert.notEqual(expected, new Date(then).toLocaleDateString('en-US'));
  });
  await inLocale('de', () => {
    assert.equal(
      formatRelativeTime(then),
      new Date(then).toLocaleDateString('de'),
    );
  });
});

test('empty or invalid input gives an empty string', async () => {
  await inLocale('en', () => {
    assert.equal(formatRelativeTime(''), '');
    assert.equal(formatRelativeTime(null), '');
    assert.equal(formatRelativeTime('not a date'), '');
  });
});
