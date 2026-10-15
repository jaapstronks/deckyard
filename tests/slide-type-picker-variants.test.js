/**
 * Insert-slide type picker: preset variants fold into their base tile (D341,
 * B709). A shelf shows one tile per type; a corner button unfolds a row of the
 * type's presets inside the shelf, one row open at a time; search still finds
 * a variant by its own label; usage and pins stay on the base type.
 *
 * Run with: node --test tests/slide-type-picker-variants.test.js
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

// jsdom has no layout: offsetParent is always null, which the keyboard nav
// reads as "not on screen". Stand in for it with the hidden attribute, which
// is how the picker hides tiles, rows and shelves.
Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', {
  configurable: true,
  get() {
    return this.isConnected && !this.closest('[hidden]') ? document.body : null;
  },
});

// A shelf grid of four columns, for the row placement: a tile's top is its
// row among the visible tiles before it (a subheading starts a fresh row).
const COLUMNS = 4;
Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetTop', {
  configurable: true,
  get() {
    let row = 0;
    let col = 0;
    for (const el of this.parentElement?.children || []) {
      if (el.hidden) continue;
      if (!el.classList.contains('ps-type-card-wrap')) {
        if (col) row += 1;
        col = 0;
        if (el === this) return row * 100;
        row += 1;
        continue;
      }
      if (el === this) return row * 100;
      col += 1;
      if (col === COLUMNS) {
        row += 1;
        col = 0;
      }
    }
    return 0;
  },
});

const { CORE_SLIDE_TYPE_DEFS } =
  await import('../shared/slide-types/registry.js');
const { SLIDE_TYPE_PRESETS } =
  await import('../client/views/editor/slide-type-picker/data.js');
const prefs =
  await import('../client/views/editor/slide-type-picker/preferences.js');
const { createSlideTypePicker } =
  await import('../client/views/editor/slide-type-picker/index.js');

const FOLDED = Object.keys(SLIDE_TYPE_PRESETS);

// The core registry, rendered in preview mode: jsdom cannot draw the media
// schematics (SVG `className` is read-only there), and the tile count does not
// depend on the thumbnail style. Core defs, not `SLIDE_TYPES`: a fork's own
// types would otherwise land on the shelves and break the core tile budget.
function renderPicker({ insertSlide = () => {} } = {}) {
  localStorage.clear();
  prefs.persistViewMode('preview');
  const mount = document.createElement('div');
  document.body.append(mount);
  createSlideTypePicker({
    SLIDE_TYPES: CORE_SLIDE_TYPE_DEFS,
    theme: null,
    insertSlide,
    disabledSlideTypes: [],
  }).renderSlideTypePicker(mount, { afterSlideId: 's1' });
  return mount;
}

// The shelves, not the "Start here" strip above them (D342), which repeats
// eight of their types as plain base tiles.
const SHELF = '.ps-type-group:not([data-group-key="start"])';
const shelfTiles = (mount) =>
  mount.querySelectorAll(`${SHELF} > .ps-type-grid > .ps-type-card-wrap`);
const baseTile = (mount, type) =>
  mount.querySelector(
    `${SHELF} > .ps-type-grid > .ps-type-card-wrap[data-thumb-type-key="${type}"]`,
  );
const rowFor = (mount, type) =>
  mount.querySelector(`.ps-type-variants[data-variants-for="${type}"]`);
const search = (mount, query) => {
  const input = mount.querySelector('.ps-picker-search-input');
  input.value = query;
  input.dispatchEvent(new dom.window.Event('input'));
};
const variantTile = (mount, type, presetId) =>
  [...rowFor(mount, type).querySelectorAll('.ps-type-card-wrap')].find(
    (wrap) => wrap.querySelector('.ps-type-thumb').__presetId === presetId,
  );

test('variants: the shelves show one tile per type, 34 or fewer', () => {
  const mount = renderPicker();
  const tiles = [...shelfTiles(mount)];
  assert.ok(
    tiles.length <= 34,
    `expected ≤ 34 shelf tiles, got ${tiles.length}`,
  );
  const types = tiles.map((wrap) => wrap.dataset.thumbTypeKey);
  assert.equal(new Set(types).size, types.length, 'a type is offered twice');
  for (const type of FOLDED) {
    const base = baseTile(mount, type);
    assert.ok(base, `${type} has a base tile`);
    const toggle = base.querySelector('.ps-type-variants-btn');
    assert.ok(toggle, `${type} has a variants corner`);
    assert.match(
      toggle.textContent,
      new RegExp(`^${SLIDE_TYPE_PRESETS[type].length} variants`),
    );
    assert.equal(rowFor(mount, type).hidden, true, `${type} row starts folded`);
  }
  // Each shelf counts its own tiles, not the folded variants.
  for (const group of mount.querySelectorAll('.ps-type-group')) {
    assert.equal(
      group.querySelector('.ps-type-group-count').textContent,
      String(
        group.querySelectorAll(':scope > .ps-type-grid > .ps-type-card-wrap')
          .length,
      ),
    );
  }
  mount.remove();
});

test('variants: the corner unfolds the row in the shelf, another corner closes it', () => {
  const mount = renderPicker();
  const toggle = (type) =>
    baseTile(mount, type).querySelector('.ps-type-variants-btn');

  toggle('callout-slide').click();
  const callout = rowFor(mount, 'callout-slide');
  assert.equal(callout.hidden, false, 'callout row open');
  assert.equal(toggle('callout-slide').getAttribute('aria-expanded'), 'true');
  assert.equal(
    callout.closest('.ps-type-group'),
    baseTile(mount, 'callout-slide').closest('.ps-type-group'),
    "the row sits in the base tile's shelf",
  );
  assert.equal(
    callout.querySelectorAll('.ps-type-card-wrap').length,
    SLIDE_TYPE_PRESETS['callout-slide'].length,
  );

  toggle('image-text-slide').click();
  assert.equal(callout.hidden, true, 'opening another row closes the first');
  assert.equal(toggle('callout-slide').getAttribute('aria-expanded'), 'false');
  assert.equal(rowFor(mount, 'image-text-slide').hidden, false);

  toggle('image-text-slide').click();
  assert.equal(rowFor(mount, 'image-text-slide').hidden, true, 'toggles shut');
  mount.remove();
});

test('variants: the tile inserts the default, a variant its overrides; usage stays on the base', () => {
  const inserted = [];
  const mount = renderPicker({
    insertSlide: (type, opts) => inserted.push({ type, opts }),
  });
  baseTile(mount, 'callout-slide').querySelector('.ps-type-card').click();
  assert.deepEqual(inserted.at(-1), {
    type: 'callout-slide',
    opts: { afterSlideId: 's1', parentId: undefined, contentOverrides: null },
  });

  variantTile(mount, 'callout-slide', 'warning')
    .querySelector('.ps-type-card')
    .click();
  assert.equal(inserted.at(-1).type, 'callout-slide');
  assert.deepEqual(inserted.at(-1).opts.contentOverrides, {
    variant: 'warning',
  });
  assert.equal(prefs.getUsage()['callout-slide'], 2);

  // Pinning a variant pins the base type.
  variantTile(mount, 'list-slide', 'numbers')
    .querySelector('.ps-type-pin')
    .click();
  assert.deepEqual(prefs.getPins(), ['list-slide']);
  mount.remove();
});

test('variants: search finds a variant directly', () => {
  const mount = renderPicker();
  for (const [query, type, presetId] of [
    ['warning', 'callout-slide', 'warning'],
    ['image right', 'image-text-slide', 'image-right'],
  ]) {
    search(mount, query);
    assert.equal(rowFor(mount, type).hidden, false, `${query}: row shown`);
    assert.equal(
      variantTile(mount, type, presetId).hidden,
      false,
      `${query}: the variant matches`,
    );
  }
  search(mount, '');
  for (const type of FOLDED)
    assert.equal(rowFor(mount, type).hidden, true, `${type} folds back`);
  mount.remove();
});

test("variants: an open row sits under its tile's row, and the arrow keys walk into it", () => {
  const mount = renderPicker();
  const card = (wrap) => wrap.querySelector('.ps-type-card');
  const press = (key) =>
    document.activeElement.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key, bubbles: true }),
    );
  // Image + text opens the Media shelf's "One image" row of five.
  const base = baseTile(mount, 'image-text-slide');
  const row = rowFor(mount, 'image-text-slide');
  // The last tile on the list tile's visual row, and the first one after it.
  const sameRow = [...base.parentElement.children].filter(
    (el) =>
      el.classList.contains('ps-type-card-wrap') &&
      el.offsetTop === base.offsetTop,
  );
  const rowEnd = sameRow.at(-1);
  let nextRowStart = rowEnd.nextElementSibling;
  while (!nextRowStart.classList.contains('ps-type-card-wrap'))
    nextRowStart = nextRowStart.nextElementSibling;

  card(rowEnd).focus();
  press('ArrowRight');
  assert.equal(
    document.activeElement,
    card(nextRowStart),
    'a folded row is skipped',
  );

  base.querySelector('.ps-type-variants-btn').click();
  assert.equal(rowEnd.nextElementSibling, row, 'the row opens under the row');
  card(rowEnd).focus();
  press('ArrowRight');
  assert.equal(
    document.activeElement,
    card(variantTile(mount, 'image-text-slide', 'image-left')),
    'an open row is next in line',
  );
  press('ArrowRight');
  assert.equal(
    document.activeElement,
    card(variantTile(mount, 'image-text-slide', 'image-right')),
  );
  card(variantTile(mount, 'image-text-slide', 'image-corner')).focus();
  press('ArrowRight');
  assert.equal(document.activeElement, card(nextRowStart), 'and out again');
  mount.remove();
});
