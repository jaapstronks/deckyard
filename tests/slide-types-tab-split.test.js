/**
 * Slide Types curation tab: guards the module split under
 * client/views/settings/tabs/slide-types-tab/. The tab's own load() is
 * network-bound, so these exercise the extracted seams directly — the pure
 * category data, the thumbnail builders, and the lightbox preview modal — which
 * is exactly what the split moved out of the closure.
 *
 * Run with: node --test tests/slide-types-tab-split.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/settings',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;

const { CATEGORIES, CATEGORY_LABELS } = await import(
  '../client/views/settings/tabs/slide-types-tab/categories.js'
);
const { createCurationThumbnail, createVideoMockup } = await import(
  '../client/views/settings/tabs/slide-types-tab/curation-thumbnails.js'
);
const { openTypePreview } = await import(
  '../client/views/settings/tabs/slide-types-tab/type-preview-modal.js'
);

test('categories: every category key resolves to a label and holds types', () => {
  assert.ok(Array.isArray(CATEGORIES) && CATEGORIES.length > 0);
  for (const cat of CATEGORIES) {
    assert.equal(typeof CATEGORY_LABELS[cat.key], 'function', `label for ${cat.key}`);
    assert.equal(typeof CATEGORY_LABELS[cat.key](), 'string');
    assert.ok(Array.isArray(cat.types) && cat.types.length > 0, `types for ${cat.key}`);
  }
});

test('thumbnails: video slide routes to the play-button mockup', () => {
  const mock = createVideoMockup('slide-type-curation-thumb');
  assert.ok(mock.classList.contains('is-video-mock'));
  assert.ok(mock.querySelector('.slide-type-curation-video-play'));

  const viaThumbnail = createCurationThumbnail('video-slide', 'slide-type-curation-thumb', null);
  assert.ok(viaThumbnail.classList.contains('is-video-mock'));
});

test('thumbnails: a normal type never throws, always returns an element', () => {
  const el = createCurationThumbnail('content-slide', 'slide-type-curation-thumb', null);
  assert.ok(el instanceof globalThis.HTMLElement);
  assert.ok(el.classList.contains('slide-type-curation-thumb'));
});

test('preview modal: opens a backdrop and closes on Escape', () => {
  const curationSection = document.createElement('div');
  document.body.appendChild(curationSection);
  const allTypesList = [
    { type: 'content-slide', category: 'basic' },
    { type: 'quote-slide', category: 'basic' },
  ];
  let saves = 0;
  let duped = null;

  openTypePreview('content-slide', allTypesList, {
    slideTypeMeta: { 'content-slide': { label: 'Content' }, 'quote-slide': { label: 'Quote' } },
    disabledTypes: new Set(),
    curationSection,
    theme: null,
    saveCuration: () => { saves++; },
    duplicateCoreType: (typeKey) => { duped = typeKey; },
  });

  const backdrop = document.querySelector('.slide-type-preview-backdrop');
  assert.ok(backdrop, 'backdrop is mounted');
  assert.equal(
    backdrop.querySelector('.slide-type-preview-counter').textContent,
    '1 / 2'
  );

  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(document.querySelector('.slide-type-preview-backdrop'), null, 'closes on Escape');

  // saveCuration + duplicateCoreType are wired but not triggered here.
  assert.equal(saves, 0);
  assert.equal(duped, null);
});
