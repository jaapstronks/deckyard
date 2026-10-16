/**
 * A rebuild of the editor form while a press on it is held waits until the
 * press is released (B730). Otherwise the button under the pointer is
 * replaced between `pointerdown` and `click` and the browser drops the
 * click: in Chrome, typing on the canvas and then pressing L or a layout tile
 * blurred the field, the blur-commit rebuilt the form, and nothing happened.
 *
 * Run with: node --test tests/editor-form-press-defer.test.js
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
const { SLIDE_TYPES } = await import('../shared/slide-types.js');

function mountForm() {
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
  const form = createRerenderEditor({
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
    surface: 'inspector',
  });
  form.rerender();
  return { editorMount, form };
}

const press = (el, type) =>
  el.dispatchEvent(new window.Event(type, { bubbles: true }));
const nextTask = () => new Promise((r) => setTimeout(r, 0));

test('without a press a rerender rebuilds the form at once', () => {
  const { editorMount, form } = mountForm();
  const btn = editorMount.querySelector('button');
  assert.ok(btn, 'the form renders a button');
  form.rerender();
  assert.equal(btn.isConnected, false);
  form.detach();
});

test('a rerender during a press waits for the release, then runs once', async () => {
  const { editorMount, form } = mountForm();
  const btn = editorMount.querySelector('button');

  press(btn, 'pointerdown');
  form.rerender(); // the blur-commit
  form.rerender();
  assert.equal(btn.isConnected, true, 'the pressed button survives');

  press(btn, 'pointerup');
  assert.equal(btn.isConnected, true, 'still there when the click lands');
  await nextTask();
  assert.equal(btn.isConnected, false, 'the deferred rebuild ran');
  form.detach();
});

test("a click handler's own rerender after the release is synchronous", async () => {
  const { editorMount, form } = mountForm();
  const btn = editorMount.querySelector('button');

  press(btn, 'pointerdown');
  form.rerender();
  press(btn, 'pointerup');
  form.rerender(); // what a click handler does
  assert.equal(btn.isConnected, false);
  const rebuilt = editorMount.querySelector('button');
  await nextTask();
  assert.equal(rebuilt.isConnected, true, 'no second rebuild after it');
  form.detach();
});

test('a cancelled press releases too', async () => {
  const { editorMount, form } = mountForm();
  const btn = editorMount.querySelector('button');
  press(btn, 'pointerdown');
  form.rerender();
  press(btn, 'pointercancel');
  await nextTask();
  assert.equal(btn.isConnected, false);
  form.detach();
});
