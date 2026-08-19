/**
 * Editor-side enforcement of theme override locks.
 *
 * A lock has to hold in two places: the renderer ignores the override (covered
 * by theme-locks.test.js) and the editor stops offering the control. If only
 * the renderer enforced it, the editor would present a background picker whose
 * every value is silently discarded — worse than no control at all.
 *
 * Run with: node --test tests/theme-locks-editor.test.js
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

const { h } = await import('../client/lib/dom.js');
const { createFieldRenderers } =
  await import('../client/views/editor/fields.js');
const { createRerenderEditor } =
  await import('../client/views/editor/editor-form.js');
const { SLIDE_TYPES } = await import('../shared/slide-types.js');

function renderForm({ theme = null } = {}) {
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
    openOverlayClosers: new Set(),
    theme,
  }).rerender();
  return editorMount;
}

// Since the 2026-07-26 declutter the background lives on two surfaces: the
// colour is a plain field in the form, the image machinery a collapsed section.
// A lock has to reach both.
const hasColourPicker = (mount) =>
  Boolean(mount.querySelector('.editor-bg-color .bg-picker'));
const imageBodyText = (mount) =>
  (
    mount.querySelector('.editor-bg-section .editor-advanced-body')
      ?.textContent || ''
  ).toLowerCase();
const mountText = (mount) => (mount.textContent || '').toLowerCase();

test('an unlocked theme still offers the background controls', () => {
  const mount = renderForm({ theme: { id: 't', locks: {} } });
  assert.ok(hasColourPicker(mount), 'colour control is offered');
  assert.ok(
    imageBodyText(mount).includes('upload'),
    'image control is offered',
  );
  assert.ok(!mountText(mount).includes('set by the theme'), 'no lock note');
});

test('no theme at all behaves exactly as unlocked', () => {
  // The editor must degrade to today's behaviour when the theme is missing.
  const mount = renderForm({ theme: null });
  assert.ok(hasColourPicker(mount));
  assert.ok(imageBodyText(mount).includes('upload'));
  assert.ok(!mountText(mount).includes('set by the theme'));
});

test('a locked background removes its controls and explains why', () => {
  const mount = renderForm({
    theme: { id: 't', locks: { background: 'locked' } },
  });

  assert.ok(
    mountText(mount).includes('set by the theme'),
    'the absence is explained',
  );
  assert.ok(!hasColourPicker(mount), 'colour control is gone');
  assert.ok(!imageBodyText(mount).includes('upload'), 'image control is gone');
  // The section itself survives — the corner logo still lives there.
  assert.ok(
    mount.querySelector('.editor-bg-section'),
    'Background image section renders',
  );
});

test('locking the logo leaves the background controls alone', () => {
  const mount = renderForm({ theme: { id: 't', locks: { logo: 'locked' } } });
  assert.ok(imageBodyText(mount).includes('set by the theme'));
  assert.ok(hasColourPicker(mount), 'background colour is still editable');
  assert.ok(
    imageBodyText(mount).includes('upload'),
    'image control is untouched',
  );
});
