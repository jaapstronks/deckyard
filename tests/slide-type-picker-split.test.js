/**
 * Insert-slide type picker: guards the module split under
 * client/views/editor/slide-type-picker/. The picker is a closure-heavy UI
 * unit, so these exercise the extracted seams directly — the static data, the
 * localStorage-backed preferences, the pure thumbnail builders — plus one
 * end-to-end render through the index seam to prove the wiring still holds.
 *
 * Run with: node --test tests/slide-type-picker-split.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/editor',
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
// The picker schedules a focus in rAF; jsdom has no scheduler, and the split
// leaves ResizeObserver/IntersectionObserver undefined (default schematic mode
// skips them entirely), so we deliberately don't polyfill those.
globalThis.requestAnimationFrame = () => 0;

const { h } = await import('../client/lib/dom/index.js');
const data = await import('../client/views/editor/slide-type-picker/data.js');
const companions =
  await import('../shared/slide-types/authoring-companions.js');
const prefs =
  await import('../client/views/editor/slide-type-picker/preferences.js');
const thumbs =
  await import('../client/views/editor/slide-type-picker/thumbnails.js');
const { createSlideTypePicker } =
  await import('../client/views/editor/slide-type-picker/index.js');

// --- data.js ------------------------------------------------------------
test('data: view modes are exactly schematic + preview', () => {
  assert.deepEqual([...data.VIEW_MODES].sort(), ['preview', 'schematic']);
});

test('data: every described / preset type has a search alias', () => {
  // Description and aliases now live on each type's authoring.js and are surfaced
  // as maps by the facet module; the preset table still lives in data.js. A
  // description or preset without an alias means it can never be found by an
  // unofficial name.
  for (const type of Object.keys(companions.SLIDE_TYPE_DESCRIPTION)) {
    assert.ok(
      type in companions.SLIDE_TYPE_ALIASES,
      `no alias for described type ${type}`,
    );
  }
  for (const type of Object.keys(data.SLIDE_TYPE_PRESETS)) {
    assert.ok(
      type in companions.SLIDE_TYPE_ALIASES,
      `no alias for preset type ${type}`,
    );
  }
});

test('data: presets carry an id, label and content overrides', () => {
  for (const list of Object.values(data.SLIDE_TYPE_PRESETS)) {
    for (const preset of list) {
      assert.equal(typeof preset.id, 'string');
      assert.equal(typeof preset.labelKey, 'string');
      assert.ok(preset.content && typeof preset.content === 'object');
    }
  }
});

// --- preferences.js -----------------------------------------------------
test('preferences: view mode defaults to schematic and round-trips', () => {
  localStorage.clear();
  assert.equal(prefs.readViewMode(), 'schematic');
  prefs.persistViewMode('preview');
  assert.equal(prefs.readViewMode(), 'preview');
  // A bogus stored value falls back to schematic, not the raw string.
  localStorage.setItem('ps-slide-picker-view', 'nonsense');
  assert.equal(prefs.readViewMode(), 'schematic');
});

test('preferences: surface round-trips and defaults to auto', () => {
  localStorage.clear();
  assert.equal(prefs.readSurface(), '');
  prefs.persistSurface('mist');
  assert.equal(prefs.readSurface(), 'mist');
});

test('preferences: usage bumps accumulate per type', () => {
  localStorage.clear();
  prefs.bumpUsage('title-slide');
  prefs.bumpUsage('title-slide');
  prefs.bumpUsage('quote-slide');
  const usage = prefs.getUsage();
  assert.equal(usage['title-slide'], 2);
  assert.equal(usage['quote-slide'], 1);
});

test('preferences: pin toggle flips and persists', () => {
  localStorage.clear();
  assert.equal(prefs.isPinned('chart-slide'), false);
  assert.equal(prefs.togglePin('chart-slide'), true); // now pinned
  assert.equal(prefs.isPinned('chart-slide'), true);
  assert.deepEqual(prefs.getPins(), ['chart-slide']);
  assert.equal(prefs.togglePin('chart-slide'), false); // now unpinned
  assert.equal(prefs.isPinned('chart-slide'), false);
});

test('preferences: section collapse honours the interaction default', () => {
  localStorage.clear();
  // No stored preference: interaction starts collapsed, others expanded.
  assert.equal(prefs.isSectionCollapsed('interaction'), true);
  assert.equal(prefs.isSectionCollapsed('basic'), false);
  prefs.setSectionCollapsed('basic', true);
  assert.equal(prefs.isSectionCollapsed('basic'), true);
  prefs.setSectionCollapsed('interaction', false);
  assert.equal(prefs.isSectionCollapsed('interaction'), false);
});

// --- thumbnails.js ------------------------------------------------------
test('thumbnails: video mock builds a poster + play button', () => {
  const wrap = h('div', {});
  thumbs.fillVideoThumb(wrap);
  assert.ok(wrap.classList.contains('ps-type-thumb-video'));
  assert.ok(wrap.querySelector('.ps-type-video-poster'));
  assert.ok(wrap.querySelector('.ps-type-video-play'));
});

test('thumbnails: embed mock builds browser chrome', () => {
  const wrap = h('div', {});
  thumbs.fillEmbedThumb(wrap);
  assert.ok(wrap.classList.contains('ps-type-thumb-embed'));
  assert.ok(wrap.querySelector('.ps-type-embed-bar'));
  assert.equal(wrap.querySelectorAll('.ps-type-embed-dot').length, 3);
});

test('thumbnails: schematic fill clears pending and appends a diagram', () => {
  const wrap = h('div', {
    class: 'is-pending',
    'data-thumb-type': 'title-slide',
  });
  thumbs.fillSchematic(wrap, { 'title-slide': { label: 'Title' } });
  assert.equal(wrap.classList.contains('is-pending'), false);
  assert.ok(wrap.firstChild, 'a schematic node was appended');
});

// --- index.js (end-to-end render seam) ----------------------------------
const SLIDE_TYPES = {
  'title-slide': { label: 'Title', labelKey: 'slideType.title-slide.label' },
  'content-slide': {
    label: 'Content',
    labelKey: 'slideType.content-slide.label',
  },
  'quote-slide': { label: 'Quote', labelKey: 'slideType.quote-slide.label' },
  'chart-slide': { label: 'Chart', labelKey: 'slideType.chart-slide.label' },
  'kpi-metrics-slide': {
    label: 'KPI',
    labelKey: 'slideType.kpi-metrics-slide.label',
  },
};

function makePicker(overrides = {}) {
  return createSlideTypePicker({
    SLIDE_TYPES,
    theme: null,
    insertSlide: () => {},
    disabledSlideTypes: [],
    ...overrides,
  });
}

test('index: renders a grid of type cards in default schematic mode', () => {
  localStorage.clear();
  const mount = h('div', {});
  document.body.append(mount);
  const { renderSlideTypePicker } = makePicker();
  renderSlideTypePicker(mount, {});

  assert.ok(
    mount.querySelector('.ps-slide-types.is-schematic-mode'),
    'schematic grid mounted',
  );
  const cards = mount.querySelectorAll('.ps-type-card-wrap');
  assert.ok(
    cards.length >= 3,
    `expected several type tiles, got ${cards.length}`,
  );
  mount.remove();
});

test('index: clicking a card inserts that slide type and bumps usage', () => {
  localStorage.clear();
  const inserted = [];
  const mount = h('div', {});
  document.body.append(mount);
  const { renderSlideTypePicker } = makePicker({
    insertSlide: (type, opts) => inserted.push({ type, opts }),
  });
  renderSlideTypePicker(mount, { afterSlideId: 'slide-1' });

  const card = mount.querySelector(
    '.ps-type-card-wrap[data-thumb-type-key="quote-slide"] .ps-type-card',
  );
  assert.ok(card, 'quote-slide card present');
  card.click();
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].type, 'quote-slide');
  assert.equal(inserted[0].opts.afterSlideId, 'slide-1');
  assert.equal(prefs.getUsage()['quote-slide'], 1);
  mount.remove();
});

test('index: search filters tiles in place', () => {
  localStorage.clear();
  const mount = h('div', {});
  document.body.append(mount);
  const { renderSlideTypePicker } = makePicker();
  renderSlideTypePicker(mount, {});

  const search = mount.querySelector('.ps-picker-search-input');
  search.value = 'kpi';
  search.dispatchEvent(new dom.window.Event('input'));

  const kpi = mount.querySelector(
    '.ps-type-card-wrap[data-thumb-type-key="kpi-metrics-slide"]',
  );
  const quote = mount.querySelector(
    '.ps-type-card-wrap[data-thumb-type-key="quote-slide"]',
  );
  assert.equal(kpi.hidden, false, 'kpi tile stays visible for its alias');
  assert.equal(quote.hidden, true, 'unrelated tile is hidden');
  mount.remove();
});

test('index: pin button pins the type and persists it', () => {
  localStorage.clear();
  const mount = h('div', {});
  document.body.append(mount);
  const { renderSlideTypePicker } = makePicker();
  renderSlideTypePicker(mount, {});

  const pinBtn = mount.querySelector(
    '.ps-type-card-wrap[data-thumb-type-key="chart-slide"] .ps-type-pin',
  );
  assert.ok(pinBtn, 'pin button present');
  pinBtn.click();
  assert.ok(
    prefs.getPins().includes('chart-slide'),
    'pin persisted to storage',
  );
  // A pinned strip appears at the top of the grid.
  assert.ok(
    mount.querySelector('.ps-type-group[data-group-key="pinned"]'),
    'pinned strip rendered',
  );
  mount.remove();
});

// --- the aggregator seam: which shelf a non-core type lands on --------------
// A fork type used to be pinned to the "Custom" shelf whatever it declared: the
// picker read membership from the generated authoring aggregator, which holds
// core and only core. The shelves now resolve over the live SLIDE_TYPES map, so
// a declared group wins and "Custom" becomes the shelf for a type that declares
// nothing — which is also how an org keeps its own types together, by declaring
// nothing.

// `data` rather than `media`: the media glyphs draw an SVG, and jsdom cannot
// set className on an SVGElement. The shelf is incidental to what is asserted.
const SLIDE_TYPES_WITH_FORK = {
  ...SLIDE_TYPES,
  'acme-hero': { label: 'Acme hero', isCustom: true, group: 'data' },
  'acme-widget': { label: 'Acme widget', isCustom: true },
};

const shelfOf = (mount, type) => {
  const wrap = mount.querySelector(
    `.ps-type-card-wrap[data-thumb-type-key="${type}"]`,
  );
  return (
    wrap?.closest('.ps-type-group')?.getAttribute('data-group-key') ?? null
  );
};

test('index: a custom type that declares a group is offered on that shelf', () => {
  localStorage.clear();
  const mount = h('div', {});
  document.body.append(mount);
  const { renderSlideTypePicker } = makePicker({
    SLIDE_TYPES: SLIDE_TYPES_WITH_FORK,
  });
  renderSlideTypePicker(mount, {});

  assert.equal(shelfOf(mount, 'acme-hero'), 'data', 'declared shelf ignored');
  assert.equal(shelfOf(mount, 'chart-slide'), 'data', 'core neighbour moved');
  assert.equal(
    mount.querySelectorAll(
      '.ps-type-card-wrap[data-thumb-type-key="acme-hero"]',
    ).length,
    1,
    'the type is offered twice — the Custom shelf kept a copy',
  );
  mount.remove();
});

test('index: a custom type that declares nothing stays on the Custom shelf', () => {
  localStorage.clear();
  const mount = h('div', {});
  document.body.append(mount);
  const { renderSlideTypePicker } = makePicker({
    SLIDE_TYPES: SLIDE_TYPES_WITH_FORK,
  });
  renderSlideTypePicker(mount, {});

  // A one-tile group folds into "Other", so the shelf is whichever of the two
  // the fold rule produced — what matters is that it is not a curated shelf.
  const shelf = shelfOf(mount, 'acme-widget');
  assert.ok(['custom', 'other'].includes(shelf), `unexpected shelf ${shelf}`);
  mount.remove();
});

// --- the Media shelf: two rows, and the collections in preview (D343, D344) --
// The shelf reads "One image" / "Collection" under small subheadings inside one
// grid; the three collection tiles always show their live preview, because all
// three draw as a grid in a schematic and only their content tells them apart.

const ONE_IMAGE = [
  'image-text-slide',
  'image-set-slide',
  'image-slide',
  'video-slide',
  'embed-slide',
];
const COLLECTION = ['gallery-slide', 'team-cards-slide', 'logo-wall-slide'];

test('data: the Media rows split one image from collections, as decided', () => {
  assert.deepEqual(
    data.MEDIA_ROWS.map((row) => [row.key, row.types]),
    [
      ['single', ONE_IMAGE],
      ['collection', COLLECTION],
    ],
  );
  // The shelf's order hint is spelled by its rows, so the two cannot drift.
  assert.deepEqual(data.PICKER_GROUP_ORDER.media, [
    ...ONE_IMAGE,
    ...COLLECTION,
  ]);
  assert.deepEqual(
    [...data.ALWAYS_PREVIEW_TYPES].sort(),
    [...COLLECTION].sort(),
  );
});

const SLIDE_TYPES_MEDIA = {
  ...SLIDE_TYPES,
  ...Object.fromEntries(
    [...ONE_IMAGE, ...COLLECTION].map((type) => [
      type,
      { label: type, group: 'media' },
    ]),
  ),
  'acme-photo': { label: 'Acme photo', isCustom: true, group: 'media' },
};

const mediaShelf = (mount) =>
  mount.querySelector('.ps-type-group[data-group-key="media"]');

// Each row title with the tile types that follow it, in grid order.
const mediaRows = (mount) => {
  const rows = [];
  for (const el of mediaShelf(mount).querySelector('.ps-type-grid').children) {
    if (el.classList.contains('ps-type-row-title'))
      rows.push({ key: el.dataset.rowKey, title: el, types: [] });
    // One entry per type: image + text still unfolds into preset tiles.
    else if (rows.at(-1).types.at(-1) !== el.dataset.thumbTypeKey)
      rows.at(-1).types.push(el.dataset.thumbTypeKey);
  }
  return rows;
};

test('index: the Media shelf shows "One image" and "Collection" in one grid', () => {
  localStorage.clear();
  localStorage.setItem('ps-slide-picker-view', 'preview');
  const mount = h('div', {});
  document.body.append(mount);
  makePicker({ SLIDE_TYPES: SLIDE_TYPES_MEDIA }).renderSlideTypePicker(mount);

  const shelf = mediaShelf(mount);
  assert.equal(shelf.querySelectorAll('.ps-type-grid').length, 1);
  const rows = mediaRows(mount);
  assert.deepEqual(
    rows.map((r) => [r.key, r.title.textContent]),
    [
      ['single', 'One image'],
      ['collection', 'Collection'],
    ],
  );
  // A media type no row names (a fork's) joins the "One image" row.
  assert.deepEqual(rows[0].types, [...ONE_IMAGE, 'acme-photo']);
  assert.deepEqual(rows[1].types, COLLECTION);
  // The count is tiles, not tiles plus subheadings.
  assert.equal(
    shelf.querySelector('.ps-type-group-count').textContent,
    String(shelf.querySelectorAll('.ps-type-card-wrap').length),
  );
  // Only the Media shelf has rows.
  assert.equal(mount.querySelectorAll('.ps-type-row-title').length, 2);
  mount.remove();
});

test('index: a subheading hides with its row during a search', () => {
  localStorage.clear();
  localStorage.setItem('ps-slide-picker-view', 'preview');
  const mount = h('div', {});
  document.body.append(mount);
  makePicker({ SLIDE_TYPES: SLIDE_TYPES_MEDIA }).renderSlideTypePicker(mount);

  const search = mount.querySelector('.ps-picker-search-input');
  search.value = 'logo';
  search.dispatchEvent(new dom.window.Event('input'));
  const [single, collection] = mediaRows(mount);
  assert.equal(single.title.hidden, true, 'empty row keeps its subheading');
  assert.equal(collection.title.hidden, false);

  search.value = '';
  search.dispatchEvent(new dom.window.Event('input'));
  assert.equal(single.title.hidden, false);
  mount.remove();
});

const thumbOf = (mount, type) =>
  mount.querySelector(
    `.ps-type-card-wrap[data-thumb-type-key="${type}"] .ps-type-thumb`,
  );

test('index: the collection tiles stay in preview while the switch says schematic', () => {
  localStorage.clear();
  const mount = h('div', {});
  document.body.append(mount);
  // A non-media shelf for the schematic side (the media glyphs draw an SVG,
  // which jsdom cannot class), plus the three collections.
  const types = {
    ...SLIDE_TYPES,
    ...Object.fromEntries(
      COLLECTION.map((type) => [type, { label: type, group: 'media' }]),
    ),
  };
  makePicker({ SLIDE_TYPES: types }).renderSlideTypePicker(mount);

  const isSchematic = (thumb) =>
    !!thumb.querySelector('.slide-schematic, svg, [class*="schematic"]');
  assert.ok(isSchematic(thumbOf(mount, 'chart-slide')), 'chart is schematic');
  for (const type of COLLECTION) {
    const thumb = thumbOf(mount, type);
    // Hydrated as a live render (here: an error tile, the stub has no
    // renderer), never filled with a schematic.
    assert.equal(isSchematic(thumb), false, `${type} drew a schematic`);
    assert.equal(thumb.classList.contains('is-pending'), false);
  }

  // Switching to preview and back leaves them as they were.
  const before = COLLECTION.map((type) => thumbOf(mount, type).innerHTML);
  for (const view of ['preview', 'schematic']) {
    mount.querySelector(`.ps-view-toggle-btn[data-view="${view}"]`).click();
  }
  assert.ok(isSchematic(thumbOf(mount, 'chart-slide')));
  assert.deepEqual(
    COLLECTION.map((type) => thumbOf(mount, type).innerHTML),
    before,
  );
  mount.remove();
});

test('team-cards-slide is "Image cards", with the description from D344', async () => {
  const { SLIDE_TYPES: registry } = await import('../shared/slide-types.js');
  assert.equal(registry['team-cards-slide'].label, 'Image cards');
  assert.equal(
    companions.SLIDE_TYPE_DESCRIPTION['team-cards-slide'],
    'Photo with name and text per card',
  );
  const { readFileSync } = await import('node:fs');
  const read = (lang, file) =>
    JSON.parse(
      readFileSync(new URL(`../client/i18n/${lang}/${file}`, import.meta.url)),
    );
  assert.equal(
    read('nl', 'slide-types.json')['slideType.team-cards-slide.label'],
    'Beeldkaarten',
  );
  assert.equal(
    read('nl', 'editor.json')['editor.slideTypeDesc.team-cards-slide'],
    'Foto met naam en uitleg per kaart',
  );
  assert.equal(
    read('nl', 'editor.json')['editor.slideTypeRow.mediaSingle'],
    'Eén beeld',
  );
});
