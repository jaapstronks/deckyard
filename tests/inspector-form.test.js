/**
 * Inspector settings pane (editor-UI track, phase 3): the default
 * (`inspector`) surface of createRerenderEditor renders ONLY settings/design
 * fields per the coverage-audit keeps map, plus Background and Accessibility.
 * Content fields live on the slide (wysiwyg) and in the Fields form
 * (the `fields` surface, covered by editor-form-surfaces.test.js).
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
  await import('../client/views/editor/fields/index.js');
const { createRerenderEditor } =
  await import('../client/views/editor/editor-form/index.js');
const { getInspectorKeepKeys } =
  await import('../client/views/editor/editor-form/inspector-form.js');
const { SLIDE_TYPES } = await import('../shared/slide-types.js');
const { GLOBAL_SLIDE_FIELD_KEYS } =
  await import('../shared/slide-types/registry.js');

function renderForm({
  type,
  content = null,
  slideTypes = SLIDE_TYPES,
  surface = 'inspector',
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
    // A picker seam with a source and a direct upload, so image fields render
    // their entry buttons the way the editor does.
    openImagePicker: Object.assign(noop, {
      providers: [{ id: 'library' }],
      upload: noop,
    }),
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
    surface,
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
  // The layout enum's one/two-column values are the Layout row's own tiles,
  // so the form below the row renders no second control for it (D348).
  assert.ok(
    !labels.some((l) => l.includes('columns')),
    'no columns enum beside the Layout row',
  );
  assert.ok(
    labels.some((l) => l.includes('text density')),
    'density enum renders',
  );
  // Content fields (title/body live on the slide + Fields form) must not
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

test('the background image section opens by default on a type where the image is the first impression (B500)', () => {
  // A type declaring `autoBackgroundPreset` (the title slide) opens the
  // section; every other type keeps it closed. Each half has its own sticky
  // preference, so closing it on a content slide leaves the cover alone.
  const section = (type) =>
    renderForm({ type }).querySelector('.editor-bg-section');
  localStorage.clear();
  try {
    assert.equal(SLIDE_TYPES['title-slide'].autoBackgroundPreset, true);
    assert.equal(section('title-slide').open, true, 'cover: open by default');
    assert.equal(section('content-slide').open, false, 'others: closed');

    localStorage.setItem('editor.bgImageSection.open', '0');
    assert.equal(
      section('title-slide').open,
      true,
      "the other types' preference does not close the cover",
    );

    localStorage.setItem('editor.bgImageSection.imageFirst.open', '0');
    assert.equal(
      section('title-slide').open,
      false,
      'the cover remembers its own',
    );
    localStorage.setItem('editor.bgImageSection.open', '1');
    assert.equal(section('content-slide').open, true);
    assert.equal(section('title-slide').open, false);
  } finally {
    localStorage.clear();
  }
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
// SETTINGS/CONFIG/METADATA may never rely on the Fields form as their only
// surface (content text may; the Fields form renders no setting at all) — but it is asserted for every field of every
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
  // default ('none') hides it, which is what makes "Side note" read as one
  // control instead of an always-present empty box
  // (shared/slide-types/aside-field.js).
  'content-slide': [{ content: { asideVariant: 'note' } }],
  'list-slide': [{ content: { asideVariant: 'note' } }],
  // The image role and the colour behind a letterboxed image wait for a
  // picture (`media.withImage`, D336), so these states carry one.
  'image-text-slide': [
    { content: { asideVariant: 'note', image: '/a.jpg', alt: 'a' } },
  ],
  'image-set-slide': [
    {
      content: {
        asideVariant: 'note',
        images: [{ src: '/a.jpg', alt: 'a' }, { src: '' }],
      },
    },
  ],
};

test('every inspector-keep field renders (no config field is Fields-only)', () => {
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
    'these settings/config/metadata fields do not render in the inspector, and ' +
      'the Fields form renders no setting, so the user cannot reach them:\n' +
      orphaned.join('\n'),
  );
});

test('video/embed source fields render in the inspector (no orphaned fields)', () => {
  // `source`/`embedUrl` cannot be edited on the canvas (only the title is
  // inline-editable), so per the parity invariant the inspector must carry
  // them — before this they were orphaned to the bulk "All text" modal.
  const video = fieldLabels(renderForm({ type: 'video-slide' }));
  assert.ok(
    video.some((l) => l.replaceAll('*', '').trim() === 'video'),
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

const SET_CONTENT = {
  layout: 'beside',
  title: 'T',
  body: 'B',
  images: [
    { src: '/uploads/a.jpg', alt: 'a' },
    { src: '/uploads/b.jpg', alt: 'b' },
  ],
};

const TEXT_CONTENT = {
  layout: 'split',
  title: 'T',
  body: 'B',
  image: '/uploads/a.jpg',
  alt: 'a',
};

test('image-set: Slide tab renders the same fields as the no-selection view', () => {
  const noSel = renderForm({
    type: 'image-set-slide',
    content: structuredClone(SET_CONTENT),
  });
  const withSel = renderForm({
    type: 'image-set-slide',
    content: structuredClone(SET_CONTENT),
    selectedElement: { kind: 'image', idx: 0 },
  });
  assert.ok(elementFormOf(withSel), 'element tab renders for a selected cell');
  assert.deepEqual(
    fieldLabels(slideForm(withSel)),
    fieldLabels(slideForm(noSel)),
    'Slide tab and no-selection view render identical fields',
  );
});

test('image-set: element tab shows only the selected cell, slide form only slide-wide settings', () => {
  const mount = renderForm({
    type: 'image-set-slide',
    content: structuredClone(SET_CONTENT),
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
  // options" wrapper is gone); the `layout` enum itself is absent because the
  // Layout row owns it (B703 PR 3) — which is what the inspectorKeeps of both
  // image types say.
  assert.ok(
    sLabels.some((l) => l.includes('image position')),
    'image side on the Slide tab',
  );
  assert.ok(
    sLabels.some((l) => l.includes('image width')),
    'image width on the Slide tab',
  );
  const sForm = slideForm(mount);
  assert.ok(sForm.querySelector('.layout-row'), 'the Layout row renders');
  assert.equal(
    [...sForm.querySelectorAll('label, .field-label')].filter(
      (n) =>
        n.textContent.trim().toLowerCase() === 'layout' &&
        !n.closest('.layout-row'),
    ).length,
    0,
    'the layout variant is the Layout row, not a field',
  );
});

/**
 * A label list minus the image card's labels, one occurrence each: the
 * background section is labelled "Image" too, and it stays.
 */
function withoutCard(labels, cardLabels) {
  const rest = [...labels];
  for (const label of cardLabels) {
    const at = rest.indexOf(label);
    if (at !== -1) rest.splice(at, 1);
  }
  return rest;
}

test('image-text: the element tab is the one image, and it carries the ImageRef', () => {
  // The singleton counterpart of the block above: image-text has exactly one
  // cell, so index 0 is the only selectable element and its controls are the
  // slide-level flat keys - the same shape image-slide has (D100). Since D336
  // the Slide tab opens on the same card while no image is selected (D347).
  const noSel = renderForm({
    type: 'image-text-slide',
    content: structuredClone(TEXT_CONTENT),
  });
  const noSelLabels = fieldLabels(slideForm(noSel));
  for (const label of ['alt text', 'image fit', 'image focus']) {
    assert.ok(
      noSelLabels.some((l) => l.includes(label)),
      `${label} in the no-selection view (the image card, D336)`,
    );
  }

  const withSel = renderForm({
    type: 'image-text-slide',
    content: structuredClone(TEXT_CONTENT),
    selectedElement: { kind: 'image', idx: 0 },
  });
  const elLabels = fieldLabels(elementFormOf(withSel));
  for (const label of ['alt text', 'image fit', 'image focus']) {
    assert.ok(
      elLabels.some((l) => l.includes(label)),
      `${label} renders in the element tab`,
    );
  }
  assert.ok(
    !elLabels.some((l) => l === 'images'),
    'a singleton has no collection manager',
  );

  // One card per picture (D347): with "This image" open the Slide tab is the
  // no-selection view minus the card, which lives in the element tab alone.
  assert.deepEqual(
    fieldLabels(slideForm(withSel)),
    withoutCard(fieldLabels(slideForm(noSel)), elLabels),
    'Slide tab is the no-selection view without the image card',
  );
});

test('image-text: layout settings render as plain fields, behind no collapsible', () => {
  const mount = renderForm({
    type: 'image-text-slide',
    content: structuredClone(TEXT_CONTENT),
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
  // The width is not a keep (B731): the three split tiles of the Layout row
  // write narrow/half/wide, so the Slide tab offers no second control for it.
  const labels = fieldLabels(form);
  assert.ok(
    !labels.some((l) => l.includes('image width')),
    'image width has one home, the Layout row',
  );
});

test('image-slide: the Slide tab opens on the image card; with the image selected it is in the tab alone', () => {
  const content = { title: '', image: '/uploads/a.jpg', alt: 'a' };
  const noSel = renderForm({
    type: 'image-slide',
    content: structuredClone(content),
  });
  const noSelLabels = fieldLabels(slideForm(noSel));
  assert.ok(
    noSelLabels.some((l) => l.includes('image fit')),
    'fit in the no-selection view (the image card, D336)',
  );
  assert.ok(
    noSelLabels.some((l) => l.includes('edge-to-edge')),
    'bleed in the no-selection view (the image card, D336)',
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

  // One card per picture (D347): with "This image" open the Slide tab is the
  // no-selection view minus the card, which lives in the element tab alone.
  assert.deepEqual(
    fieldLabels(slideForm(withSel)),
    withoutCard(fieldLabels(slideForm(noSel)), elLabels),
    'Slide tab is the no-selection view without the image card',
  );
});

// D336 (B705): an image slide's inspector starts with the image itself, right
// under the Layout row that leads every `layoutVariants` type (D335, B703 PR
// 3). The helpers below read the fields after that row.

/** Outside the Layout row: the fields D336 orders. */
const outsideLayoutRow = (n) => !n.closest('.layout-row');

/** Field labels of a panel, in document order. */
const labelsInOrder = (el) =>
  [...el.querySelectorAll('.field-label, label')]
    .filter(outsideLayoutRow)
    .map((n) => n.textContent.trim().toLowerCase());

/** Button texts of a panel, in document order. */
const buttonTexts = (el) =>
  [...el.querySelectorAll('button')]
    .filter(outsideLayoutRow)
    .map((b) => b.textContent.trim());

/** The alt warning, if the card rendered one. */
const altWarning = (el) => el.querySelector('.help.is-warning');

test('D336: an empty image-text slide opens on the picker, without role, alt, fit or image background', () => {
  const mount = renderForm({ type: 'image-text-slide' });
  const form = slideForm(mount);
  const labels = labelsInOrder(form);
  assert.equal(labels[0], 'image', 'the image field is the first field');
  const buttons = buttonTexts(form);
  assert.equal(buttons[0], 'Choose image…', 'Choose comes first');
  assert.ok(buttons.includes('Upload from computer'), 'Upload is offered');
  for (const absent of [
    'alt text',
    'image role',
    'image fit',
    'image focus',
    'image background',
  ]) {
    assert.ok(
      !labels.some((l) => l.includes(absent)),
      `no ${absent} before there is an image`,
    );
  }
  // The side shapes the empty slot too, so it stays; the width does as well,
  // but its home is the Layout row's split tiles (B731).
  assert.ok(
    labels.some((l) => l.includes('image position')),
    'image position stays on the empty slide',
  );
});

test('D336: a filled image-text slide shows picture, Replace and alt at the top, then role and image background', () => {
  const mount = renderForm({
    type: 'image-text-slide',
    content: { ...structuredClone(TEXT_CONTENT), alt: '' },
  });
  const form = slideForm(mount);
  const labels = labelsInOrder(form);
  assert.deepEqual(labels.slice(0, 2), ['image', 'alt text']);
  assert.ok(form.querySelector('img.editor-img-preview'), 'a thumbnail');
  assert.equal(buttonTexts(form)[0], 'Replace…', 'Replace leads');
  assert.ok(
    labels.indexOf('image role') > labels.indexOf('alt text'),
    'the role renders once there is an image',
  );
  assert.ok(
    labels.some((l) => l.includes('image background')),
    'the image background renders once there is an image',
  );

  const warning = altWarning(form);
  assert.ok(warning && !warning.hidden, 'a missing alt is flagged');
  assert.match(warning.textContent, /Decorative/, 'and names the way out');
  // The picker has no text input, so the first one is the alt under it.
  const altInput = form.querySelector('input.form-input');
  altInput.value = 'A harbour at dusk';
  altInput.dispatchEvent(new window.Event('input'));
  assert.equal(warning.hidden, true, 'typing an alt clears the warning');
});

test('D336: a decorative image is not flagged, the publish gate does not want its alt', () => {
  const mount = renderForm({
    type: 'image-text-slide',
    content: {
      ...structuredClone(TEXT_CONTENT),
      alt: '',
      imageRole: 'decorative',
    },
  });
  const warning = altWarning(slideForm(mount));
  assert.ok(!warning || warning.hidden, 'no warning on a decorative image');
});

test('D336: an empty image slide opens on the picker, without role or zoom', () => {
  const mount = renderForm({ type: 'image-slide' });
  const labels = labelsInOrder(slideForm(mount));
  assert.equal(labels[0], 'image', 'the image field is the first field');
  for (const absent of ['image role', 'zoom steps', 'alt text', 'image fit']) {
    assert.ok(
      !labels.some((l) => l.includes(absent)),
      `no ${absent} before there is an image`,
    );
  }
});

test('D336: image-set, gallery and team-cards cards start with the picker and put alt under the picture', () => {
  const cases = [
    {
      type: 'image-set-slide',
      empty: { images: [{ src: '' }, { src: '' }] },
      filled: { images: [{ src: '/a.jpg', alt: '' }, { src: '' }] },
    },
    {
      type: 'gallery-slide',
      empty: { images: [{ src: '' }] },
      filled: { images: [{ src: '/a.jpg', alt: '' }] },
    },
    {
      type: 'team-cards-slide',
      empty: { members: [{ image: '' }] },
      filled: { members: [{ image: '/a.jpg', alt: '' }] },
    },
  ];
  for (const { type, empty, filled } of cases) {
    const selectedElement = { kind: 'image', idx: 0 };
    const emptyCard = elementFormOf(
      renderForm({ type, content: empty, selectedElement }),
    );
    assert.ok(emptyCard, `${type}: the empty cell has a card`);
    assert.equal(buttonTexts(emptyCard)[0], 'Choose image…', type);
    assert.ok(
      !labelsInOrder(emptyCard).some((l) => l.includes('alt text')),
      `${type}: no alt before there is an image`,
    );

    const card = elementFormOf(
      renderForm({ type, content: filled, selectedElement }),
    );
    assert.deepEqual(
      labelsInOrder(card).slice(0, 2),
      ['image', 'alt text'],
      type,
    );
    assert.equal(buttonTexts(card)[0], 'Replace…', type);
    const warning = altWarning(card);
    assert.ok(warning && !warning.hidden, `${type}: a missing alt is flagged`);
  }
});

test('D336: a team member named by their heading is not flagged, publishing reads the name', () => {
  const card = elementFormOf(
    renderForm({
      type: 'team-cards-slide',
      content: {
        members: [{ image: '/a.jpg', alt: '', name: 'Ada Lovelace' }],
      },
      selectedElement: { kind: 'image', idx: 0 },
    }),
  );
  const warning = altWarning(card);
  assert.ok(!warning || warning.hidden, 'the name is the alt of last resort');
});

test('D336: mediaHoldsImage reads every media shape', async () => {
  const { mediaHoldsImage } =
    await import('../client/views/editor/inline-edit/descriptors.js');
  const flat = { imageField: 'image' };
  assert.equal(mediaHoldsImage({ image: '' }, flat), false);
  assert.equal(mediaHoldsImage({ image: ' /a.jpg ' }, flat), true);
  const list = { list: 'images', imageField: 'src' };
  assert.equal(mediaHoldsImage({ images: [{ src: '' }, {}] }, list), false);
  assert.equal(
    mediaHoldsImage({ images: [{}, { src: '/b.jpg' }] }, list),
    true,
  );
  assert.equal(mediaHoldsImage({}, list), false);
  const slots = { list: 'quotes', slots: 2, imageField: 'authorImage{n}' };
  assert.equal(
    mediaHoldsImage({ quotes: [{ authorImage2: '/c.jpg' }] }, slots),
    true,
  );
  // A flat {n} window cannot be counted: never hide on it.
  assert.equal(mediaHoldsImage({}, { imageField: 'col{n}Image' }), true);
});

test('the Fields form (fields surface) still renders the content fields the inspector dropped', () => {
  const mount = renderForm({ type: 'content-slide', surface: 'fields' });
  const labels = fieldLabels(mount);
  assert.ok(
    labels.some((l) => l.includes('title')),
    'title renders in the Fields form',
  );
  assert.ok(
    mount.querySelector('textarea, [contenteditable]'),
    'body editor renders',
  );
});
