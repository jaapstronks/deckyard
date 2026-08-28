/**
 * Inspector settings pane (editor-UI track, phase 3): the default (non
 * contentOnly) mode of createRerenderEditor renders ONLY settings/design
 * fields per the coverage-audit keeps map, plus Background and Accessibility.
 * Content fields live on the slide (wysiwyg) and in the bulk modal
 * (contentOnly mode, covered by bulk-edit-content-only.test.js).
 *
 * Run with: node --test tests/inspector-form.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

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
  await import('../client/views/editor/fields.js');
const { createRerenderEditor } =
  await import('../client/views/editor/editor-form.js');
const { getInspectorKeepKeys } =
  await import('../client/views/editor/editor-form/inspector-form.js');
const { SLIDE_TYPES } = await import('../shared/slide-types.js');
const { GLOBAL_SLIDE_FIELD_KEYS } =
  await import('../shared/slide-types/registry.js');

function renderForm({
  type,
  content = null,
  slideTypes = SLIDE_TYPES,
  contentOnly = false,
  selectedElement = null,
}) {
  const editorMount = document.createElement('div');
  document.body.append(editorMount);
  const slide = {
    id: 's1',
    type,
    content: content || structuredClone(slideTypes[type]?.defaults || {}),
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
    SLIDE_TYPES: slideTypes,
    api: null,
    getSelectedSlideId: () => 's1',
    setSelectedSlideId: noop,
    editorState: {},
    requestSave: noop,
    rerenderSlideList: noop,
    rerenderPreview: noop,
    fieldRenderers: createFieldRenderers(deps),
    contentOnly,
    getSelectedElement: () => selectedElement,
  }).rerender;
  rerender();
  return editorMount;
}

const fieldLabels = (mount) =>
  [...mount.querySelectorAll('label, .field-label')].map((el) =>
    el.textContent.trim().toLowerCase(),
  );

/** The slide form (the no-selection view / the "Slide" tab). */
const slideForm = (mount) =>
  [...mount.querySelectorAll('.editor-form')].find(
    (el) => !el.classList.contains('editor-element-form'),
  );

/** The element form (the "This image" / "This card" tab), if rendered. */
const elementFormOf = (mount) => mount.querySelector('.editor-element-form');

test('every keeps key exists in its slide-type schema (no audit/schema drift)', () => {
  for (const [type, def] of Object.entries(SLIDE_TYPES)) {
    const schemaKeys = new Set((def.fields || []).map((f) => f.key));
    for (const key of getInspectorKeepKeys(type, def)) {
      assert.ok(
        schemaKeys.has(key),
        `${type}: keeps key "${key}" is not a schema field`,
      );
    }
  }
});

test('inspector renders settings but no content text fields (content-slide)', () => {
  const mount = renderForm({ type: 'content-slide' });

  assert.ok(
    mount.querySelector('.editor-bg-color'),
    'background colour renders in the form',
  );
  assert.ok(
    mount.querySelector('.editor-bg-section'),
    'Background image section renders',
  );
  assert.equal(
    mount.querySelector('.editor-text-fields'),
    null,
    'Text section is gone',
  );

  const labels = fieldLabels(mount);
  // The content slide's layout enum only toggles 1/2 text columns, so it's
  // labelled "Text columns" (the toolbar chip owns the structural "Layout").
  assert.ok(
    labels.some((l) => l.includes('text columns')),
    'text-columns enum renders',
  );
  assert.ok(
    labels.some((l) => l.includes('text size')),
    'density enum renders',
  );
  // Content fields (title/body live on the slide + bulk modal) must not
  // render. Inputs inside the Background/Accessibility sections
  // (.editor-advanced) are settings and don't count.
  const form = mount.querySelector('.editor-form');
  const outsideSections = (sel) =>
    [...form.querySelectorAll(sel)].filter(
      (el) => !el.closest('.editor-advanced'),
    );
  assert.equal(
    outsideSections('textarea').length,
    0,
    'no body/markdown editor',
  );
  assert.equal(
    outsideSections('input[type="text"], input:not([type])').length,
    0,
    'no content text inputs in the inspector',
  );
});

test('the background image section stays collapsed but never hides an active image', () => {
  // The declutter (2026-07-26) traded force-open for a summary thumbnail: the
  // section costs one row whether or not a background is set, and a set one is
  // still visible at a glance. Both halves matter — a collapsed section that
  // also hid the thumbnail would be the regression the brief warned about.
  const plain = renderForm({ type: 'content-slide' });
  const plainSection = plain.querySelector('.editor-bg-section');
  assert.equal(plainSection.open, false, 'closed with no background set');
  assert.ok(
    plainSection.querySelector('.editor-bg-status'),
    'says so in the summary',
  );
  assert.equal(
    plainSection.querySelector('.editor-bg-summary-thumb'),
    null,
    'no thumbnail',
  );

  const withImage = renderForm({
    type: 'content-slide',
    content: {
      ...structuredClone(SLIDE_TYPES['content-slide'].defaults),
      slideBgImage: '/uploads/bg.jpg',
    },
  });
  const setSection = withImage.querySelector('.editor-bg-section');
  assert.equal(
    setSection.open,
    false,
    'a set image no longer forces the panel open',
  );
  const thumb = setSection.querySelector('.editor-bg-summary-thumb');
  assert.ok(thumb, 'the active background shows as a summary thumbnail');
  assert.equal(thumb.getAttribute('src'), '/uploads/bg.jpg');
  // The crop/fit/overlay tail — the 581px that made the old section huge —
  // renders only once an image is set, and only inside the collapsed body.
  const body = setSection.querySelector('.editor-advanced-body');
  assert.ok(
    (body.textContent || '').toLowerCase().includes('focus'),
    'crop focus renders for a set image',
  );
});

test('chart inspector keeps the data editor but drops text and axis labels', () => {
  const mount = renderForm({ type: 'chart-slide' });
  const labels = fieldLabels(mount);
  assert.ok(
    labels.some((l) => l.includes('data')),
    'data editor renders',
  );
  assert.ok(
    labels.some((l) => l.includes('type')),
    'chartType renders',
  );
  assert.ok(
    !labels.some((l) => l.includes('x-axis') || l.includes('x axis')),
    'no axis labels',
  );
  assert.ok(!labels.some((l) => l === 'title'), 'no title field');
});

// Coverage audit (2026-07-21), now DERIVED from the registry instead of a
// hand-picked sample of eight (type, label) pins. The invariant is unchanged —
// SETTINGS/CONFIG/METADATA may never rely on the bulk modal as their only
// surface (content text may) — but it is asserted for every field of every
// type, not one representative per group.
//
// The set of fields the inspector is supposed to keep is itself derived:
// getInspectorKeepKeys returns exactly the settings/config/metadata keys for a
// type (schema minus the inline-covered content fields). Each of those must
// render somewhere in the inspector DOM. Iterating SLIDE_TYPES means adding or
// removing a slide type never touches this test — removing split-partner-title
// used to require deleting a hand-listed pin (#480). Org types from the builder
// UI live in the database and are not in SLIDE_TYPES at test time; the "unknown
// custom types fall back" test below covers that path. File-based fork types in
// custom/slide-types/ ARE loaded into SLIDE_TYPES, so a fork audits its own
// types here too, which is the point and also the trap below.
//
// A few keep-fields render only once their enabling content exists: image-slide
// zoom needs zoomSteps, and chart legend/pie/series labels are gated on
// chartType. Those preconditions live in RENDER_PRECONDITIONS. It is NOT a
// per-type coverage list — a type with no entry is still fully checked, and a
// stale entry for a removed type is simply never looked up (so removal stays
// zero-touch). A new type that ships a conditionally-rendered config field fails
// here until it either renders unconditionally or documents its precondition —
// the invariant doing its job, not maintenance churn.
// GLOBAL_SLIDE_FIELD_KEYS are excluded, because they are not per-type keeps at
// all: withGlobalSlideFields() injects them into every schema and the shared
// Background / Accessibility sections render them, on their own conditions (the
// background tail only appears once an image is set). getInspectorKeepKeys()
// documents its result as "excl. bg/a11y routing" and the hand-written
// keep-lists honour that, but its fallback branch (every schema field minus the
// inline-covered ones) cannot, so the injected keys arrive here for any type
// that declares no keeps. Every core type declares one; a file-based fork type
// in custom/slide-types/ typically does not, which is why this audit was green
// upstream and red in the CIIIC fork on its very first run (#501).
const GLOBAL_KEYS = new Set(GLOBAL_SLIDE_FIELD_KEYS);

const RENDER_PRECONDITIONS = {
  // Zoom level/positions only render with a selected image and zoom enabled;
  // 'custom' is the value that also surfaces zoomPositions.
  'image-slide': [
    {
      content: { image: '/a.jpg', alt: 'a', zoomSteps: 'custom' },
      selectedElement: { kind: 'image', idx: 0 },
    },
  ],
  // No single chart type shows all config: pie carries pieLabelMode + legend,
  // line carries the series labels. Two states cover the eight chart keeps.
  'chart-slide': [
    { content: { chartType: 'pie' } },
    { content: { chartType: 'line' } },
  ],
  // The target slide only means something in the "go to specific slide" mode;
  // the default ('stay') hides it, as it should.
  'poll-slide': [{ content: { onClose: 'goto' } }],
  'likert-slide': [{ content: { onClose: 'goto' } }],
  // The aside's text field only means something once a kind is chosen; the
  // default ('none') hides it, which is what makes "Aside" read as one control
  // instead of an always-present empty box (shared/slide-types/aside-field.js).
  'content-slide': [{ content: { asideVariant: 'note' } }],
  'list-slide': [{ content: { asideVariant: 'note' } }],
  'image-text-slide': [{ content: { asideVariant: 'note' } }],
};

test('every inspector-keep field renders (no config field is bulk-modal-only)', () => {
  // Collected rather than asserted per key: the first failure used to hide the
  // rest, and a fork running this wants the whole list in one go.
  const orphaned = [];
  for (const [type, def] of Object.entries(SLIDE_TYPES)) {
    const keepKeys = [...getInspectorKeepKeys(type, def)].filter(
      (k) => !GLOBAL_KEYS.has(k),
    );
    if (!keepKeys.length) continue;
    const fieldByKey = new Map((def.fields || []).map((f) => [f.key, f]));
    // A keep-field may surface in the no-selection view, the selected-image
    // element tab, or the selected-card element tab; gather labels from all.
    const states = [
      { type },
      { type, selectedElement: { kind: 'image', idx: 0 } },
      { type, selectedElement: { kind: 'card', idx: 0 } },
      ...(RENDER_PRECONDITIONS[type] || []).map((s) => ({ type, ...s })),
    ];
    const rendered = new Set(states.flatMap((s) => fieldLabels(renderForm(s))));
    for (const key of keepKeys) {
      const label = (fieldByKey.get(key)?.label || key).toLowerCase();
      if (![...rendered].some((l) => l.includes(label))) {
        orphaned.push(`${type}: keep-field "${key}" (label "${label}")`);
      }
    }
  }
  assert.deepEqual(
    orphaned,
    [],
    'these settings/config/metadata fields render nowhere but the bulk modal, so ' +
      'the user cannot reach them from the inspector:\n' +
      orphaned.join('\n'),
  );
});

test('video/embed source fields render in the inspector (no orphaned fields)', () => {
  // `source`/`embedUrl` cannot be edited on the canvas (only the title is
  // inline-editable), so per the parity invariant the inspector must carry
  // them — before this they were orphaned to the bulk "All text" modal.
  const video = fieldLabels(renderForm({ type: 'video-slide' }));
  assert.ok(
    video.some((l) => l.includes('video url')),
    'video source renders',
  );
  assert.ok(
    video.some((l) => l.includes('autoplay')),
    'autoplay still renders',
  );
  const embed = fieldLabels(renderForm({ type: 'embed-slide' }));
  assert.ok(
    embed.some((l) => l.includes('url')),
    'embed url renders',
  );
});

test('unknown custom types fall back to rendering all non-inline-covered fields', () => {
  const customTypes = {
    'my-custom-slide': {
      label: 'Custom',
      fields: [
        { key: 'headline', label: 'Headline', type: 'string' },
        { key: 'mode', label: 'Mode', type: 'enum', options: ['a', 'b'] },
      ],
      defaults: { headline: '', mode: 'a' },
    },
  };
  const mount = renderForm({
    type: 'my-custom-slide',
    slideTypes: customTypes,
  });
  const labels = fieldLabels(mount);
  assert.ok(
    labels.some((l) => l.includes('headline')),
    'unaudited text field stays (parity)',
  );
  assert.ok(
    labels.some((l) => l.includes('mode')),
    'enum stays',
  );
});

// ---- Editing-surfaces tab split: Slide tab == no-selection view, and the
// element tab carries only the selected element's own settings. ----

const DUO_CONTENT = {
  layout: 'duo',
  title: 'T',
  body: 'B',
  images: [
    { src: '/uploads/a.jpg', alt: 'a' },
    { src: '/uploads/b.jpg', alt: 'b' },
  ],
};

test('image-text: Slide tab renders the same fields as the no-selection view', () => {
  const noSel = renderForm({
    type: 'image-text-slide',
    content: structuredClone(DUO_CONTENT),
  });
  const withSel = renderForm({
    type: 'image-text-slide',
    content: structuredClone(DUO_CONTENT),
    selectedElement: { kind: 'image', idx: 0 },
  });
  assert.ok(elementFormOf(withSel), 'element tab renders for a selected cell');
  assert.deepEqual(
    fieldLabels(slideForm(withSel)),
    fieldLabels(slideForm(noSel)),
    'Slide tab and no-selection view render identical fields',
  );
});

test('image-text: element tab shows only the selected cell, slide form only slide-wide settings', () => {
  const mount = renderForm({
    type: 'image-text-slide',
    content: structuredClone(DUO_CONTENT),
    selectedElement: { kind: 'image', idx: 1 },
  });
  const elForm = elementFormOf(mount);
  const elLabels = fieldLabels(elForm);
  // The selected cell's own controls...
  assert.ok(
    elLabels.some((l) => l.includes('alt text')),
    'alt renders in element tab',
  );
  assert.ok(
    elLabels.some((l) => l.includes('image fit')),
    'fit renders in element tab',
  );
  assert.ok(
    elLabels.some((l) => l.includes('image focus')),
    'focus renders in element tab',
  );
  // ...and nothing of the collection or the slide-wide settings.
  assert.ok(
    !elLabels.some((l) => l === 'images'),
    'no collection manager in element tab',
  );
  assert.equal(
    [...elForm.querySelectorAll('button')].filter((b) =>
      b.textContent.includes('Add image'),
    ).length,
    0,
    'no add button in element tab',
  );
  assert.ok(
    !elLabels.some((l) => l.includes('layout')),
    'no layout settings in element tab',
  );

  const sLabels = fieldLabels(slideForm(mount));
  assert.ok(
    !sLabels.some((l) => l.includes('alt text')),
    'no per-image alt on the Slide tab',
  );
  assert.ok(
    !sLabels.some((l) => l.includes('image fit')),
    'no per-image fit on the Slide tab',
  );
  assert.ok(
    !sLabels.some((l) => l.includes('image focus')),
    'no per-image focus on the Slide tab',
  );
  assert.ok(
    sLabels.some((l) => l === 'images'),
    'slim collection section on the Slide tab',
  );
  // The layout settings render as plain keep fields since step 5 (the "Layout
  // options" wrapper is gone); `layout` itself is absent because the toolbar
  // chip owns it — which is what image-text's inspectorKeeps has always said.
  assert.ok(
    sLabels.some((l) => l.includes('image position')),
    'image side on the Slide tab',
  );
  assert.ok(
    sLabels.some((l) => l.includes('image width')),
    'image width on the Slide tab',
  );
  assert.ok(
    !sLabels.some((l) => l === 'layout'),
    'layout variant belongs to the toolbar chip',
  );
});

test('image-text: layout settings render as plain fields, behind no collapsible', () => {
  const mount = renderForm({
    type: 'image-text-slide',
    content: structuredClone(DUO_CONTENT),
  });
  const form = slideForm(mount);
  const sideLabel = [...form.querySelectorAll('.field-label')].find((el) =>
    el.textContent.toLowerCase().includes('image position'),
  );
  assert.ok(sideLabel, 'image side renders on the Slide tab');
  assert.equal(
    sideLabel.closest('details'),
    null,
    'layout settings are not tucked behind a collapsible',
  );
  // Side and width declare `formLayout: 'pair'`, so the generic loop puts them
  // on one row — the declaration replacing the helper's hand-built fieldGrid.
  const grid = sideLabel.closest('.field-grid');
  assert.ok(grid, 'image side sits in a paired row');
  assert.ok(
    grid.textContent.toLowerCase().includes('image width'),
    'image width shares that row',
  );
});

test('image-slide: image controls live in the element tab only; Slide tab == no-selection view', () => {
  const content = { title: '', image: '/uploads/a.jpg', alt: 'a' };
  const noSel = renderForm({
    type: 'image-slide',
    content: structuredClone(content),
  });
  const noSelLabels = fieldLabels(slideForm(noSel));
  assert.ok(
    !noSelLabels.some((l) => l.includes('image fit')),
    'no fit in the no-selection view',
  );
  assert.ok(
    !noSelLabels.some((l) => l.includes('edge-to-edge')),
    'no bleed in the no-selection view',
  );

  const withSel = renderForm({
    type: 'image-slide',
    content: structuredClone(content),
    selectedElement: { kind: 'image', idx: 0 },
  });
  const elLabels = fieldLabels(elementFormOf(withSel));
  assert.ok(
    elLabels.some((l) => l.includes('image fit')),
    'fit renders in element tab',
  );
  assert.ok(
    elLabels.some((l) => l.includes('edge-to-edge')),
    'bleed renders in element tab',
  );
  assert.ok(
    elLabels.some((l) => l.includes('alt text')),
    'alt renders in element tab',
  );

  assert.deepEqual(
    fieldLabels(slideForm(withSel)),
    fieldLabels(slideForm(noSel)),
    'Slide tab and no-selection view render identical fields',
  );
});

test('bulk modal (contentOnly) still renders the content fields the inspector dropped', () => {
  const mount = renderForm({ type: 'content-slide', contentOnly: true });
  const labels = fieldLabels(mount);
  assert.ok(
    labels.some((l) => l.includes('title')),
    'title renders in bulk modal',
  );
  assert.ok(
    mount.querySelector('textarea, [contenteditable]'),
    'body editor renders',
  );
});
