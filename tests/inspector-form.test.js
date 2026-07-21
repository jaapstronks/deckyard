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

function renderForm({ type, content = null, slideTypes = SLIDE_TYPES, contentOnly = false }) {
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
  });
  rerender();
  return editorMount;
}

const fieldLabels = (mount) =>
  [...mount.querySelectorAll('label, .field-label')].map((el) =>
    el.textContent.trim().toLowerCase()
  );

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

test('bulk modal (contentOnly) still renders the content fields the inspector dropped', () => {
  const mount = renderForm({ type: 'content-slide', contentOnly: true });
  const labels = fieldLabels(mount);
  assert.ok(labels.some((l) => l.includes('title')), 'title renders in bulk modal');
  assert.ok(mount.querySelector('textarea, [contenteditable]'), 'body editor renders');
});
