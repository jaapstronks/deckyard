/**
 * Editor form surfaces (D171): createRerenderEditor takes a `surface` name from
 * the declared table in client/views/editor/editor-form/surfaces.js and every
 * surface-dependent part of the form reads one capability from that row.
 *
 * - `fields` (the Fields form in the canvas column, D335) renders ONLY the
 *   per-type content fields - no header, no Background/Accessibility
 *   sections, and no setting at any level - and inline-covered text fields
 *   render in place instead of tucked behind the collapsed Text section.
 *   These assertions ARE the Fields contract.
 * - `inspector` keeps the rail chrome and the settings sections.
 * - `library` (the Fields form in the slide-library editor, with nothing
 *   beside it) renders all fields plus Background and Accessibility, and none
 *   of the deck-bound chrome.
 *
 * Run with: node --test tests/editor-form-surfaces.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { walkFiles } from './helpers/walk-files.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/test-id',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.ResizeObserver =
  dom.window.ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

const { createFieldRenderers } =
  await import('../client/views/editor/fields/index.js');
const { createRerenderEditor } =
  await import('../client/views/editor/editor-form/index.js');
const { SLIDE_TYPES } = await import('../shared/slide-types.js');
const { FORM_SURFACES, surfaceCapabilities } =
  await import('../client/views/editor/editor-form/surfaces.js');
const { isSettingsField } =
  await import('../shared/slide-types/settings-fields.js');
const { CORE_SLIDE_TYPE_NAMES } =
  await import('../shared/slide-types/registry.js');

function renderForm({
  surface,
  setInspectorCollapsed = null,
  slideToolbar = undefined,
}) {
  const editorMount = document.createElement('div');
  document.body.append(editorMount);
  const slide = {
    id: 's1',
    type: 'content-slide',
    content: structuredClone(SLIDE_TYPES['content-slide'].defaults),
  };
  const pres = { id: 'p1', slides: [slide], settings: {} };
  const noop = () => {};
  const deps = {
    pres,
    user: {},
    markDirty: noop,
    scheduleUiRefresh: noop,
    rerenderEditor: noop,
    updateSelectedSlideListItem: noop,
    normalizeLang: (l) => l,
  };
  const rerender = createRerenderEditor({
    ...deps,
    editorMount,
    SLIDE_TYPES,
    api: null,
    getSelectedSlideId: () => 's1',
    setSelectedSlideId: noop,
    editorState: {},
    requestSave: noop,
    rerenderSlideList: noop,
    rerenderPreview: noop,
    fieldRenderers: createFieldRenderers(deps),
    surface,
    setInspectorCollapsed,
    slideToolbar,
  }).rerender;
  rerender();
  return editorMount;
}

test('the fields surface renders content fields without panel chrome or settings sections', () => {
  const mount = renderForm({
    surface: 'fields',
    setInspectorCollapsed: () => {},
  });

  assert.ok(mount.querySelector('.editor-form'), 'form container renders');
  assert.equal(
    mount.querySelector('.editor-form-close-slot'),
    null,
    'no rail chrome',
  );
  assert.equal(
    mount.querySelector('.editor-bg-section'),
    null,
    'no Background section',
  );
  assert.equal(
    mount.querySelector('.editor-text-fields'),
    null,
    'no collapsed Text section',
  );
  assert.equal(
    mount.querySelector('.ai-iterate-panel'),
    null,
    'no AI refine box',
  );

  // Inline-covered text fields (title/subheading) render IN PLACE - the whole
  // point of the fields surface. Background/a11y fields must not render at all.
  const labels = [...mount.querySelectorAll('label, .field-label')].map((el) =>
    el.textContent.trim().toLowerCase(),
  );
  assert.ok(
    labels.some((l) => l.includes('title')),
    'title field renders inline',
  );
  assert.ok(
    !labels.some((l) => l.includes('background')),
    'no background field',
  );
  const editables = mount.querySelectorAll(
    'input, textarea, [contenteditable]',
  );
  assert.ok(editables.length > 0, 'editable content fields present');
});

test('inspector keeps the rail chrome and the settings sections', () => {
  // The "INSPECTOR" header row went in the 2026-07-26 declutter, but the
  // collapse button it held did not: it now floats in a zero-height slot.
  let collapsed = null;
  const mount = renderForm({
    surface: 'inspector',
    setInspectorCollapsed: (v) => {
      collapsed = v;
    },
  });
  const closeBtn = mount.querySelector(
    '.editor-form-close-slot .editor-form-close-btn',
  );
  assert.ok(closeBtn, 'collapse button renders');
  closeBtn.click();
  assert.equal(collapsed, true, 'clicking it collapses the rail');
  assert.ok(
    mount.querySelector('.editor-bg-color'),
    'background colour renders in the form',
  );
  assert.ok(
    mount.querySelector('.editor-bg-section'),
    'Background image section renders',
  );
});

test('library renders every field plus Background and Accessibility, no deck chrome', () => {
  const leftEl = document.createElement('div');
  const mount = renderForm({
    surface: 'library',
    setInspectorCollapsed: () => {},
    slideToolbar: { leftEl },
  });

  // All content fields, in place (the inspector would drop the title).
  const labels = [...mount.querySelectorAll('label, .field-label')].map((el) =>
    el.textContent.trim().toLowerCase(),
  );
  assert.ok(
    labels.some((l) => l.includes('title')),
    'title field renders inline',
  );
  assert.ok(
    mount.querySelector('.editor-bg-color'),
    'background colour renders',
  );
  assert.ok(
    mount.querySelector('.editor-bg-section'),
    'Background image section renders',
  );
  const a11y = mount.querySelector('.editor-a11y-section');
  assert.ok(a11y, 'Accessibility section renders');
  assert.ok(
    a11y.querySelector('input, textarea'),
    'a11y keys render inside the Accessibility section',
  );

  // Toolbar yes (type pill into the caller's mount), deck chrome no.
  assert.ok(leftEl.querySelector('.pill'), 'type pill renders in the toolbar');
  assert.equal(
    leftEl.querySelector('.type-pill-menu'),
    null,
    'the pill is a label here: the library keeps its type, no menu',
  );
  assert.equal(
    mount.querySelector('.editor-form-close-slot'),
    null,
    'no rail collapse control',
  );
  assert.equal(
    mount.querySelector('.ai-iterate-panel'),
    null,
    'no AI refine box',
  );
  assert.equal(mount.querySelector('.inspector-tabs'), null, 'no element tabs');
});

/**
 * Render one type's form on a surface with the setting widgets spied on: the
 * field renderers a setting reaches (enum, number, colour, icon picker), at the
 * top level and inside every collection item.
 */
function renderTypeWithSpies(type, surface) {
  const editorMount = document.createElement('div');
  document.body.append(editorMount);
  const slide = {
    id: 's1',
    type,
    content: structuredClone(SLIDE_TYPES[type]?.defaults || {}),
  };
  const pres = { id: 'p1', slides: [slide], settings: {} };
  const noop = () => {};
  const deps = {
    pres,
    user: {},
    markDirty: noop,
    scheduleUiRefresh: noop,
    rerenderEditor: noop,
    updateSelectedSlideListItem: noop,
    normalizeLang: (l) => l,
  };
  const calls = [];
  const renderers = createFieldRenderers(deps);
  for (const name of [
    'fieldEnum',
    'fieldNumber',
    'fieldColor',
    'fieldIconPicker',
  ]) {
    const real = renderers[name];
    if (typeof real !== 'function') continue;
    renderers[name] = (label, ...rest) => {
      calls.push(`${name}(${typeof label === 'string' ? label : '?'})`);
      return real(label, ...rest);
    };
  }
  createRerenderEditor({
    ...deps,
    editorMount,
    SLIDE_TYPES,
    api: null,
    getSelectedSlideId: () => 's1',
    setSelectedSlideId: noop,
    editorState: {},
    requestSave: noop,
    rerenderSlideList: noop,
    rerenderPreview: noop,
    fieldRenderers: renderers,
    surface,
  }).rerender();
  editorMount.remove();
  return { editorMount, calls, def: SLIDE_TYPES[type] };
}

// The Fields rule (D335) as a property of every core type: a setting has one
// home, the inspector beside the form, so the `fields` surface renders none -
// no settings-shaped schema field, no setting widget inside a collection item,
// no checkbox.
test('the Fields form (fields surface) renders no settings field on any core type', () => {
  const offenders = [];
  for (const type of CORE_SLIDE_TYPE_NAMES) {
    const { editorMount, calls, def } = renderTypeWithSpies(type, 'fields');
    const byKey = new Map((def.fields || []).map((f) => [f.key, f]));
    for (const el of editorMount.querySelectorAll('[data-collab-field-key]')) {
      const key = el.getAttribute('data-collab-field-key');
      if (isSettingsField(byKey.get(key))) offenders.push(`${type}.${key}`);
    }
    for (const call of calls) offenders.push(`${type}: ${call}`);
    if (editorMount.querySelector('input[type="checkbox"]'))
      offenders.push(`${type}: a checkbox`);
  }
  assert.deepEqual(offenders, []);
});

// The spies are not vacuous: the full form of the same types does reach the
// setting widgets, and the content stays in the Fields form.
test('the full form renders the settings the Fields form leaves to the inspector', () => {
  const full = renderTypeWithSpies('text-blocks-slide', 'library');
  assert.ok(
    full.calls.some((c) => c.startsWith('fieldEnum')),
    'the library form renders the row colour/arrow enums',
  );
  const fields = renderTypeWithSpies('text-blocks-slide', 'fields');
  assert.ok(
    fields.editorMount.querySelector('textarea, [contenteditable], input'),
    'the Fields form still renders the row text',
  );
});

test('the fields surface renders a11y keys nowhere', () => {
  const mount = renderForm({ surface: 'fields' });
  assert.equal(mount.querySelector('.editor-a11y-section'), null);
  const names = [...mount.querySelectorAll('[name], [data-key]')].map(
    (el) => el.getAttribute('name') || el.getAttribute('data-key'),
  );
  assert.ok(!names.includes('a11yTitle') && !names.includes('a11ySummary'));
});

test('the surface table declares every capability on every row', () => {
  const keys = [
    'fields',
    'toolbar',
    'layout',
    'typeConversion',
    'headerActions',
    'deckTools',
    'elementTabs',
    'background',
    'a11y',
  ];
  assert.deepEqual(Object.keys(FORM_SURFACES).sort(), [
    'fields',
    'inspector',
    'library',
  ]);
  for (const [name, row] of Object.entries(FORM_SURFACES)) {
    assert.deepEqual(Object.keys(row).sort(), [...keys].sort(), name);
    assert.ok(['keeps', 'content', 'all'].includes(row.fields), name);
  }
  assert.throws(
    () => surfaceCapabilities('panel'),
    /Unknown editor form surface/,
  );
  // No default surface: a caller that names none is refused the same way.
  assert.throws(
    () => surfaceCapabilities(undefined),
    /Unknown editor form surface/,
  );
});

// Guard: the one-boolean form mode is gone for good. `contentOnly` on the AI
// append request is a different concept (append content slides only) and
// keeps its name; those two files are the only allowed mentions under client/.
test('contentOnly no longer appears in the client', () => {
  const allowed = new Set([
    'client/views/editor/ai-append.js',
    'client/views/editor/modals/ai-batch-review-modal.js',
  ]);
  const offenders = [];
  for (const file of walkFiles('client', {
    extensions: ['.js'],
    skipDirs: ['vendor', 'i18n'],
    followSymlinks: true,
    filesOnly: false,
  })) {
    if (
      !allowed.has(file) &&
      readFileSync(file, 'utf8').includes('contentOnly')
    ) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], 'use a surface from editor-form/surfaces.js');
});

// The library editor keeps the item's type (D170: `slideType` is not
// writable), so its Layout row offers no cross-type tile.
test('the Layout row offers cross-type tiles only where typeConversion is on', async () => {
  const { createLayoutRow } =
    await import('../client/views/editor/layout-switcher.js');
  const tileLabels = (typeConversion) => {
    const slide = {
      id: 's1',
      type: 'image-text-slide',
      content: structuredClone(SLIDE_TYPES['image-text-slide'].defaults),
    };
    const row = createLayoutRow({
      slide,
      pres: { id: '', slides: [slide] },
      SLIDE_TYPES,
      editorState: { dirtyRefreshWithItem() {} },
      typeConversion,
    });
    document.body.append(row);
    const inline = row.querySelectorAll('.layout-row-tiles .layout-tile');
    assert.ok(inline.length <= 4, 'at most four schematics inline');
    // image-text declares a mirror toggle, so "All N" is there on both.
    row.querySelector('.layout-row-all').click();
    const labels = [
      ...document.querySelectorAll('.layout-switcher-popover .layout-tile'),
    ].map((b) => b.textContent.trim());
    document.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape' }),
    );
    row.remove();
    for (const el of document.querySelectorAll('.layout-switcher-popover')) {
      el.remove();
    }
    return labels;
  };
  const withConversion = tileLabels(true);
  const without = tileLabels(false);
  assert.ok(
    withConversion.length > without.length,
    JSON.stringify({ withConversion, without }),
  );
  assert.ok(without.length > 0, 'same-type tiles still render');
});

// The Layout row is the form's first row on the surfaces that declare
// `layout`, for exactly the types that declare layoutVariants (B703 PR 3) -
// except while an image type's picture is empty: then the image card leads
// and Layout is second (D347, tested on its own below).
test('the Layout row leads the inspector for every type with layout variants', async () => {
  const { getLayoutVariants } = await import('../shared/slide-types.js');
  const withVariants = Object.keys(SLIDE_TYPES).filter(
    (type) => getLayoutVariants(SLIDE_TYPES[type]).length > 0,
  );
  assert.deepEqual(withVariants.sort(), [
    'chapter-title-slide',
    'chart-slide',
    'content-slide',
    'image-set-slide',
    'image-text-slide',
    'kpi-metrics-slide',
    'list-slide',
    'logo-wall-slide',
    'quote-slide',
    'text-blocks-slide',
    'title-slide',
  ]);
  for (const type of Object.keys(SLIDE_TYPES)) {
    const { editorMount } = renderTypeWithSpies(type, 'inspector');
    const form = editorMount.querySelector('.editor-form');
    const imageFirst = IMAGE_CARD_TYPES.includes(type);
    const lead = imageFirst
      ? form?.firstElementChild?.nextElementSibling
      : form?.firstElementChild;
    if (withVariants.includes(type)) {
      assert.ok(
        lead?.classList.contains('layout-row'),
        `${type}: Layout is the ${imageFirst ? 'second' : 'first'} inspector row`,
      );
    } else {
      assert.equal(form?.querySelector('.layout-row'), null, type);
    }
    editorMount.remove();
  }
  const { editorMount } = renderTypeWithSpies('content-slide', 'fields');
  assert.equal(
    editorMount.querySelector('.layout-row'),
    null,
    'Fields carries no Layout row',
  );
  editorMount.remove();
});

// D347 (B723): on an image slide the first inspector row is what to do next.
// The five image types: the two flat ones carry the shared image card on the
// Slide tab, image-set its collection section; gallery and team-cards have no
// Slide-tab card, their image card is the "This image" tab alone.
const IMAGE_CARD_TYPES = ['image-set-slide', 'image-text-slide'];
const IMAGE_TYPES = [
  'image-text-slide',
  'image-slide',
  'image-set-slide',
  'gallery-slide',
  'team-cards-slide',
];
const PHOTO = 'https://example.com/photo.jpg';

/** Put a picture in the first image slot of a default slide. */
function withPhoto(type, content) {
  if (type === 'image-slide' || type === 'image-text-slide') {
    content.image = PHOTO;
  } else if (type === 'team-cards-slide') {
    content.members[0].image = PHOTO;
  } else {
    if (!Array.isArray(content.images) || !content.images.length) {
      content.images = [{ src: '', alt: '' }];
    }
    content.images[0].src = PHOTO;
  }
  return content;
}

/** Render the inspector for a slide, optionally with a canvas selection. */
function renderInspector(type, { photo = false, selected = null } = {}) {
  const editorMount = document.createElement('div');
  document.body.append(editorMount);
  const content = structuredClone(SLIDE_TYPES[type].defaults);
  const slide = {
    id: 's1',
    type,
    content: photo ? withPhoto(type, content) : content,
  };
  const pres = { id: 'p1', slides: [slide], settings: {} };
  const noop = () => {};
  const deps = {
    pres,
    user: {},
    markDirty: noop,
    scheduleUiRefresh: noop,
    rerenderEditor: noop,
    updateSelectedSlideListItem: noop,
    normalizeLang: (l) => l,
  };
  createRerenderEditor({
    ...deps,
    editorMount,
    SLIDE_TYPES,
    api: null,
    getSelectedSlideId: () => 's1',
    setSelectedSlideId: noop,
    getSelectedElement: () => selected,
    editorState: {},
    requestSave: noop,
    rerenderSlideList: noop,
    rerenderPreview: noop,
    fieldRenderers: createFieldRenderers(deps),
    surface: 'inspector',
  }).rerender();
  editorMount.remove();
  const forms = [...editorMount.querySelectorAll('.editor-form')];
  return {
    slideForm: forms.find((f) => !f.classList.contains('editor-element-form')),
    elementForm: forms.find((f) => f.classList.contains('editor-element-form')),
  };
}

// A collapsed section is named as one ("Background image" summarises as
// "Image"), so it cannot pass for the image card.
const rowLabel = (el) => {
  if (el?.classList.contains('layout-row')) return 'Layout row';
  if (el?.tagName === 'DETAILS') return `section: ${el.className}`;
  return el?.querySelector('.field-label')?.textContent || el?.className;
};
const rows = (form) => [...(form?.children || [])].map(rowLabel);

test('an empty image leads the inspector, a filled one follows Layout (D347)', () => {
  for (const type of IMAGE_TYPES) {
    const empty = rows(renderInspector(type).slideForm);
    const filled = rows(renderInspector(type, { photo: true }).slideForm);
    const card = type === 'image-set-slide' ? 'Images' : 'Image';
    const hasCard = type !== 'gallery-slide' && type !== 'team-cards-slide';
    const hasLayout = IMAGE_CARD_TYPES.includes(type);
    if (hasCard && hasLayout) {
      assert.deepEqual(
        empty.slice(0, 2),
        [card, 'Layout row'],
        `${type} empty`,
      );
      assert.deepEqual(
        filled.slice(0, 2),
        ['Layout row', card],
        `${type} filled`,
      );
    } else if (hasCard) {
      // image-slide declares no layout variants: the card is first either way.
      assert.equal(empty[0], card, `${type} empty`);
      assert.equal(filled[0], card, `${type} filled`);
    } else {
      // No Slide-tab card: nothing image-shaped leads the Slide tab.
      assert.ok(!empty.includes('Image'), `${type}: no Slide-tab card`);
    }
  }
});

test('with "This image" open the Slide tab renders no second card (D347)', () => {
  for (const type of IMAGE_TYPES) {
    const { slideForm, elementForm } = renderInspector(type, {
      photo: true,
      selected: { kind: 'image', idx: 0 },
    });
    assert.equal(
      rows(elementForm)[0],
      'Image',
      `${type}: the card is in the tab`,
    );
    assert.ok(
      !rows(slideForm).includes('Image') &&
        !rows(slideForm).includes('Alt text'),
      `${type}: the Slide tab carries no copy of the card`,
    );
  }
});

test('the image role sits in the image card, under the alt text (D347)', () => {
  for (const type of ['image-slide', 'image-text-slide']) {
    const open = renderInspector(type, {
      photo: true,
      selected: { kind: 'image', idx: 0 },
    });
    const tab = rows(open.elementForm);
    assert.ok(
      tab.indexOf('Image role') > tab.indexOf('Alt text'),
      `${type}: role follows the alt text in "This image"`,
    );
    assert.ok(!rows(open.slideForm).includes('Image role'), `${type}: once`);
    const closed = rows(renderInspector(type, { photo: true }).slideForm);
    assert.equal(
      closed.filter((r) => r === 'Image role').length,
      1,
      `${type}: one role control on the Slide tab card`,
    );
    assert.equal(
      closed.indexOf('Image role'),
      closed.indexOf('Alt text') + 2,
      `${type}: role right under the alt text and its warning`,
    );
    assert.ok(
      !rows(renderInspector(type).slideForm).includes('Image role'),
      `${type}: no role before there is a picture`,
    );
  }
});

test('a value the form shortens when it renders is reported for the save notice (B875)', () => {
  const editorMount = document.createElement('div');
  document.body.append(editorMount);
  const longAlt = 'word '.repeat(80).trim();
  const slide = {
    id: 's1',
    type: 'image-slide',
    content: {
      ...structuredClone(SLIDE_TYPES['image-slide'].defaults),
      imageRole: 'content',
      alt: longAlt,
    },
  };
  const pres = {
    id: 'p1',
    slides: [slide],
    settings: {},
    i18n: { active: 'nl' },
  };
  const noop = () => {};
  const deps = {
    pres,
    user: {},
    markDirty: noop,
    scheduleUiRefresh: noop,
    rerenderEditor: noop,
    updateSelectedSlideListItem: noop,
    normalizeLang: (l) => l,
  };
  const reported = [];
  createRerenderEditor({
    ...deps,
    editorMount,
    SLIDE_TYPES,
    api: null,
    getSelectedSlideId: () => 's1',
    setSelectedSlideId: noop,
    editorState: {},
    requestSave: noop,
    rerenderSlideList: noop,
    rerenderPreview: noop,
    fieldRenderers: createFieldRenderers(deps),
    surface: 'fields',
    onFieldsNormalized: (fields) => reported.push(...fields),
  }).rerender();

  assert.ok(slide.content.alt.length <= 180, 'the buffer holds the short alt');
  assert.ok(slide.content.alt.endsWith('…'));
  assert.deepEqual(reported, [{ slideId: 's1', lang: 'nl', field: 'alt' }]);
  editorMount.remove();
});
