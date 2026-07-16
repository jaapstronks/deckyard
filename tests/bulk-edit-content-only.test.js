/**
 * Bulk-edit modal (editor-UI track, phase 2): createRerenderEditor's
 * contentOnly mode renders ONLY the per-type content fields - no header, no
 * Background/Accessibility sections - and inline-covered text fields render
 * in place instead of tucked behind the collapsed Text section. The bulk
 * modal mounts this mode, so these assertions ARE the parity contract.
 *
 * Run with: node --test tests/bulk-edit-content-only.test.js
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
const { SLIDE_TYPES } = await import('../shared/slide-types/index.js');

function renderForm({ contentOnly }) {
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
    SLIDE_TYPES,
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

test('contentOnly renders content fields without panel chrome or settings sections', () => {
  const mount = renderForm({ contentOnly: true });

  assert.ok(mount.querySelector('.editor-form'), 'form container renders');
  assert.equal(mount.querySelector('.editor-form-header'), null, 'no header');
  assert.equal(mount.querySelector('.editor-bg-section'), null, 'no Background section');
  assert.equal(mount.querySelector('.editor-text-fields'), null, 'no collapsed Text section');
  assert.equal(mount.querySelector('.ai-iterate-panel'), null, 'no AI refine box');

  // Inline-covered text fields (title/subheading) render IN PLACE - the whole
  // point of the bulk surface. Background/a11y fields must not render at all.
  const labels = [...mount.querySelectorAll('label, .field-label')].map((el) =>
    el.textContent.trim().toLowerCase()
  );
  assert.ok(labels.some((l) => l.includes('title')), 'title field renders inline');
  assert.ok(!labels.some((l) => l.includes('background')), 'no background field');
  const editables = mount.querySelectorAll('input, textarea, [contenteditable]');
  assert.ok(editables.length > 0, 'editable content fields present');
});

test('default mode keeps the header and the settings sections', () => {
  const mount = renderForm({ contentOnly: false });
  assert.ok(mount.querySelector('.editor-form-header'), 'header renders');
  assert.ok(mount.querySelector('.editor-bg-section'), 'Background section renders');
});
