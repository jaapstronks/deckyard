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
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.ResizeObserver =
  dom.window.ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

const { h } = await import('../client/lib/dom.js');
const { createFieldRenderers } = await import('../client/views/editor/fields.js');
const { createRerenderEditor } = await import('../client/views/editor/editor-form.js');
const { getInspectorKeepKeys } = await import(
  '../client/views/editor/editor-form/inspector-form.js'
);
const { SLIDE_TYPES } = await import('../shared/slide-types/index.js');

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
    h,
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
    openOverlayClosers: new Set(),
    contentOnly,
    getSelectedElement: () => selectedElement,
  });
  rerender();
  return editorMount;
}

const fieldLabels = (mount) =>
  [...mount.querySelectorAll('label, .field-label')].map((el) =>
    el.textContent.trim().toLowerCase()
  );

/** The slide form (the no-selection view / the "Slide" tab). */
const slideForm = (mount) =>
  [...mount.querySelectorAll('.editor-form')].find(
    (el) => !el.classList.contains('editor-element-form')
  );

/** The element form (the "This image" / "This card" tab), if rendered. */
const elementFormOf = (mount) => mount.querySelector('.editor-element-form');

test('every keeps key exists in its slide-type schema (no audit/schema drift)', () => {
  for (const [type, def] of Object.entries(SLIDE_TYPES)) {
    const schemaKeys = new Set((def.fields || []).map((f) => f.key));
    for (const key of getInspectorKeepKeys(type, def)) {
      assert.ok(
        schemaKeys.has(key),
        `${type}: keeps key "${key}" is not a schema field`
      );
    }
  }
});

test('inspector renders settings but no content text fields (content-slide)', () => {
  const mount = renderForm({ type: 'content-slide' });

  assert.ok(mount.querySelector('.editor-form-header'), 'header renders');
  assert.ok(mount.querySelector('.editor-bg-section'), 'Background section renders');
  assert.equal(mount.querySelector('.editor-text-fields'), null, 'Text section is gone');

  const labels = fieldLabels(mount);
  // The content slide's layout enum only toggles 1/2 text columns, so it's
  // labelled "Text columns" (the toolbar chip owns the structural "Layout").
  assert.ok(labels.some((l) => l.includes('text columns')), 'text-columns enum renders');
  assert.ok(labels.some((l) => l.includes('text size')), 'density enum renders');
  // Content fields (title/body live on the slide + bulk modal) must not
  // render. Inputs inside the Background/Accessibility sections
  // (.editor-advanced) are settings and don't count.
  const form = mount.querySelector('.editor-form');
  const outsideSections = (sel) =>
    [...form.querySelectorAll(sel)].filter((el) => !el.closest('.editor-advanced'));
  assert.equal(outsideSections('textarea').length, 0, 'no body/markdown editor');
  assert.equal(
    outsideSections('input[type="text"], input:not([type])').length,
    0,
    'no content text inputs in the inspector'
  );
});

test('chart inspector keeps the data editor but drops text and axis labels', () => {
  const mount = renderForm({ type: 'chart-slide' });
  const labels = fieldLabels(mount);
  assert.ok(labels.some((l) => l.includes('data')), 'data editor renders');
  assert.ok(labels.some((l) => l.includes('type')), 'chartType renders');
  assert.ok(!labels.some((l) => l.includes('x-axis') || l.includes('x axis')), 'no axis labels');
  assert.ok(!labels.some((l) => l === 'title'), 'no title field');
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
  const mount = renderForm({ type: 'my-custom-slide', slideTypes: customTypes });
  const labels = fieldLabels(mount);
  assert.ok(labels.some((l) => l.includes('headline')), 'unaudited text field stays (parity)');
  assert.ok(labels.some((l) => l.includes('mode')), 'enum stays');
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
  const noSel = renderForm({ type: 'image-text-slide', content: structuredClone(DUO_CONTENT) });
  const withSel = renderForm({
    type: 'image-text-slide',
    content: structuredClone(DUO_CONTENT),
    selectedElement: { kind: 'image', idx: 0 },
  });
  assert.ok(elementFormOf(withSel), 'element tab renders for a selected cell');
  assert.deepEqual(
    fieldLabels(slideForm(withSel)),
    fieldLabels(slideForm(noSel)),
    'Slide tab and no-selection view render identical fields'
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
  assert.ok(elLabels.some((l) => l.includes('alt text')), 'alt renders in element tab');
  assert.ok(elLabels.some((l) => l.includes('image fit')), 'fit renders in element tab');
  assert.ok(elLabels.some((l) => l.includes('image focus')), 'focus renders in element tab');
  // ...and nothing of the collection or the slide-wide settings.
  assert.ok(!elLabels.some((l) => l === 'images'), 'no collection manager in element tab');
  assert.equal(
    [...elForm.querySelectorAll('button')].filter((b) => b.textContent.includes('Add image')).length,
    0,
    'no add button in element tab'
  );
  assert.ok(!elLabels.some((l) => l.includes('layout')), 'no layout settings in element tab');

  const sLabels = fieldLabels(slideForm(mount));
  assert.ok(!sLabels.some((l) => l.includes('alt text')), 'no per-image alt on the Slide tab');
  assert.ok(!sLabels.some((l) => l.includes('image fit')), 'no per-image fit on the Slide tab');
  assert.ok(!sLabels.some((l) => l.includes('image focus')), 'no per-image focus on the Slide tab');
  assert.ok(sLabels.some((l) => l === 'images'), 'slim collection section on the Slide tab');
  assert.ok(sLabels.some((l) => l.includes('layout')), 'layout options on the Slide tab');
});

test('image-text: layout options render flat on the Slide tab (no collapsed toggle)', () => {
  const mount = renderForm({ type: 'image-text-slide', content: structuredClone(DUO_CONTENT) });
  const form = slideForm(mount);
  const layoutLabel = [...form.querySelectorAll('.field-label')].find((el) =>
    el.textContent.toLowerCase().includes('layout')
  );
  assert.ok(layoutLabel, 'layout options header renders');
  assert.equal(
    layoutLabel.closest('details'),
    null,
    'layout options are not tucked behind a collapsible'
  );
});

test('image-slide: image controls live in the element tab only; Slide tab == no-selection view', () => {
  const content = { title: '', image: '/uploads/a.jpg', alt: 'a' };
  const noSel = renderForm({ type: 'image-slide', content: structuredClone(content) });
  const noSelLabels = fieldLabels(slideForm(noSel));
  assert.ok(!noSelLabels.some((l) => l.includes('image fit')), 'no fit in the no-selection view');
  assert.ok(!noSelLabels.some((l) => l.includes('edge-to-edge')), 'no bleed in the no-selection view');

  const withSel = renderForm({
    type: 'image-slide',
    content: structuredClone(content),
    selectedElement: { kind: 'image', idx: 0 },
  });
  const elLabels = fieldLabels(elementFormOf(withSel));
  assert.ok(elLabels.some((l) => l.includes('image fit')), 'fit renders in element tab');
  assert.ok(elLabels.some((l) => l.includes('edge-to-edge')), 'bleed renders in element tab');
  assert.ok(elLabels.some((l) => l.includes('alt text')), 'alt renders in element tab');

  assert.deepEqual(
    fieldLabels(slideForm(withSel)),
    fieldLabels(slideForm(noSel)),
    'Slide tab and no-selection view render identical fields'
  );
});

test('bulk modal (contentOnly) still renders the content fields the inspector dropped', () => {
  const mount = renderForm({ type: 'content-slide', contentOnly: true });
  const labels = fieldLabels(mount);
  assert.ok(labels.some((l) => l.includes('title')), 'title renders in bulk modal');
  assert.ok(mount.querySelector('textarea, [contenteditable]'), 'body editor renders');
});
