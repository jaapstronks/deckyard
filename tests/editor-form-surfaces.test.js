/**
 * Editor form surfaces (D171): createRerenderEditor takes a `surface` name from
 * the declared table in client/views/editor/editor-form/surfaces.js and every
 * surface-dependent part of the form reads one capability from that row.
 *
 * - `bulk` (the "Edit all text" modal) renders ONLY the per-type content
 *   fields - no header, no Background/Accessibility sections - and
 *   inline-covered text fields render in place instead of tucked behind the
 *   collapsed Text section. These assertions ARE the bulk parity contract.
 * - `inspector` keeps the rail chrome and the settings sections.
 * - `library` (the slide-library editor) renders all fields plus Background
 *   and Accessibility, and none of the deck-bound chrome.
 *
 * Run with: node --test tests/editor-form-surfaces.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
const { SLIDE_TYPES } = await import('../shared/slide-types.js');
const { FORM_SURFACES, surfaceCapabilities } =
  await import('../client/views/editor/editor-form/surfaces.js');

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

test('bulk renders content fields without panel chrome or settings sections', () => {
  const mount = renderForm({
    surface: 'bulk',
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
  // point of the bulk surface. Background/a11y fields must not render at all.
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
  const actionsEl = document.createElement('div');
  const mount = renderForm({
    surface: 'library',
    setInspectorCollapsed: () => {},
    slideToolbar: { leftEl, actionsEl },
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
  assert.equal(actionsEl.childNodes.length, 0, 'no slide-actions menu');
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

test('bulk renders a11y keys nowhere', () => {
  const mount = renderForm({ surface: 'bulk' });
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
    'headerActions',
    'deckTools',
    'elementTabs',
    'background',
    'a11y',
  ];
  assert.deepEqual(Object.keys(FORM_SURFACES).sort(), [
    'bulk',
    'inspector',
    'library',
  ]);
  for (const [name, row] of Object.entries(FORM_SURFACES)) {
    assert.deepEqual(Object.keys(row).sort(), [...keys].sort(), name);
    assert.ok(['keeps', 'all'].includes(row.fields), name);
  }
  assert.throws(
    () => surfaceCapabilities('panel'),
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
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name === 'vendor' || name === 'i18n') continue;
        walk(path);
      } else if (name.endsWith('.js') && !allowed.has(path)) {
        if (readFileSync(path, 'utf8').includes('contentOnly')) {
          offenders.push(path);
        }
      }
    }
  };
  walk('client');
  assert.deepEqual(offenders, [], 'use a surface from editor-form/surfaces.js');
});
