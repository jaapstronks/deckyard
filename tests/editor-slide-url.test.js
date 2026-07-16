/**
 * Selected slide reflected in the URL (write side of ?slideId=).
 *
 * syncSlideIdInUrl must use replaceState (no history entry per slide),
 * preserve unrelated query params (lang), replace the legacy ?s= alias,
 * and remove the param when selection is cleared. The load side
 * (?slideId=/?s= → initialSlideId) already existed in the controllers.
 *
 * Run with: node --test tests/editor-slide-url.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/test-id?lang=nl&s=old-slide',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;

const { syncSlideIdInUrl } = await import('../client/views/editor/slide-url.js');

test('writes slideId, preserves lang, replaces the legacy s alias', () => {
  const before = history.length;
  syncSlideIdInUrl('slide-42');

  const u = new URL(location.href);
  assert.equal(u.searchParams.get('slideId'), 'slide-42');
  assert.equal(u.searchParams.get('lang'), 'nl', 'lang param preserved');
  assert.equal(u.searchParams.get('s'), null, 'legacy alias removed');
  assert.equal(u.pathname, '/app/test-id', 'pathname untouched');
  assert.equal(history.length, before, 'replaceState: no new history entry');
});

test('subsequent selections replace the value', () => {
  syncSlideIdInUrl('slide-7');
  assert.equal(new URL(location.href).searchParams.get('slideId'), 'slide-7');
});

test('clearing the selection removes the param', () => {
  syncSlideIdInUrl(null);
  const u = new URL(location.href);
  assert.equal(u.searchParams.get('slideId'), null);
  assert.equal(u.searchParams.get('lang'), 'nl', 'lang still preserved');
});
