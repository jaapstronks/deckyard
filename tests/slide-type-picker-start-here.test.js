/**
 * Insert-slide type picker: "Start here" is the empty state of the
 * frequently-used strip (D342, B710). Without signal the picker opens on eight
 * fixed types in a fixed order; with signal the strip takes that place, never
 * both. The inline library strip is gone from the Slide types tab: "Slide
 * library" is a tab of the same dialog.
 *
 * Run with: node --test tests/slide-type-picker-start-here.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/editor',
  pretendToBeVisual: true,
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
globalThis.requestAnimationFrame = () => 0;

const { CORE_SLIDE_TYPE_DEFS } =
  await import('../shared/slide-types/registry.js');
const { FREQUENT_MIN_TOTAL, START_HERE_TYPES } =
  await import('../client/views/editor/slide-type-picker/data.js');
const prefs =
  await import('../client/views/editor/slide-type-picker/preferences.js');
const { createSlideTypePicker } =
  await import('../client/views/editor/slide-type-picker/index.js');

// The core registry in preview mode, as in the variants test: jsdom cannot
// draw the media schematics, and which shelves render does not depend on the
// thumbnail style.
function renderPicker({ usage = [], disabledSlideTypes = [] } = {}) {
  localStorage.clear();
  prefs.persistViewMode('preview');
  for (const type of usage) prefs.bumpUsage(type);
  const mount = document.createElement('div');
  document.body.append(mount);
  createSlideTypePicker({
    SLIDE_TYPES: CORE_SLIDE_TYPE_DEFS,
    theme: null,
    insertSlide: () => {},
    disabledSlideTypes,
  }).renderSlideTypePicker(mount, { afterSlideId: 's1' });
  return mount;
}

const groupKeys = (mount) =>
  [...mount.querySelectorAll('.ps-slide-types > .ps-type-group')].map(
    (group) => group.dataset.groupKey,
  );
const stripTypes = (mount, key) =>
  [
    ...mount.querySelectorAll(
      `.ps-type-group[data-group-key="${key}"] > .ps-type-grid > .ps-type-card-wrap`,
    ),
  ].map((wrap) => wrap.dataset.thumbTypeKey);

test('start here: the eight types D342 names, in its order', () => {
  assert.deepEqual(START_HERE_TYPES, [
    'title-slide',
    'content-slide',
    'list-slide',
    'image-text-slide',
    'gallery-slide',
    'chart-slide',
    'table-slide',
    'quote-slide',
  ]);
  for (const type of START_HERE_TYPES)
    assert.ok(CORE_SLIDE_TYPE_DEFS[type], `${type} is a core type`);
});

test('start here: without signal it opens the picker, and the strip is absent', () => {
  const mount = renderPicker();
  assert.equal(groupKeys(mount)[0], 'start', 'Start here is the first shelf');
  assert.deepEqual(stripTypes(mount, 'start'), START_HERE_TYPES);
  assert.equal(stripTypes(mount, 'frequent').length, 0);
  // Plain base tiles: the variants corner belongs to the shelves (D341).
  assert.equal(
    mount.querySelectorAll(
      '.ps-type-group[data-group-key="start"] .ps-type-variants-btn',
    ).length,
    0,
  );
  mount.remove();
});

test('start here: below the threshold it stays', () => {
  const below = Array.from({ length: FREQUENT_MIN_TOTAL - 1 }, (_, i) =>
    i % 2 ? 'chart-slide' : 'table-slide',
  );
  const mount = renderPicker({ usage: below });
  assert.equal(groupKeys(mount)[0], 'start');
  assert.equal(stripTypes(mount, 'frequent').length, 0);
  mount.remove();
});

test('start here: with signal the frequently-used strip takes its place', () => {
  const usage = [
    ...Array(FREQUENT_MIN_TOTAL).fill('kpi-metrics-slide'),
    'timeline-slide',
  ];
  const mount = renderPicker({ usage });
  assert.equal(groupKeys(mount)[0], 'frequent');
  assert.deepEqual(stripTypes(mount, 'frequent'), [
    'kpi-metrics-slide',
    'timeline-slide',
  ]);
  assert.equal(groupKeys(mount).includes('start'), false, 'never both');
  mount.remove();
});

test('start here: a type the deck disallows is left out, the order holds', () => {
  const mount = renderPicker({ disabledSlideTypes: ['gallery-slide'] });
  assert.deepEqual(
    stripTypes(mount, 'start'),
    START_HERE_TYPES.filter((type) => type !== 'gallery-slide'),
  );
  mount.remove();
});

test('start here: the Slide types tab carries no library strip', () => {
  const mount = renderPicker();
  assert.equal(
    groupKeys(mount).some((key) => key.startsWith('library')),
    false,
  );
  mount.remove();
});
