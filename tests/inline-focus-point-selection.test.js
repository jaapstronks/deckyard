/**
 * The focal point waits for the selection (D347, B723).
 *
 * The handle sits in the middle of the picture by default, exactly where a
 * user clicks to select the image, so a handle on every image turned that
 * first click into a focus drag. It now shows only on the selected image: the
 * first click selects, only then is the point there to drag.
 *
 * The real inline editor runs on a real render in jsdom.
 *
 * Run with: node --test tests/inline-focus-point-selection.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/editor/p1',
  pretendToBeVisual: true,
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
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver =
  dom.window.IntersectionObserver || NoopObserver;
globalThis.ResizeObserver = dom.window.ResizeObserver || NoopObserver;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = clearTimeout;

const { SLIDE_TYPES } = await import('../shared/slide-types.js');
const { renderSlideElement, NO_DECK_LANG } =
  await import('../client/lib/slide-runtime/slide-render.js');
const { createInlineEditor } =
  await import('../client/views/editor/inline-edit/inline-editor.js');

/** Mount the inline editor with a controller-like selection it mirrors. */
function mount(slide) {
  const stage = document.createElement('div');
  const thumb = document.createElement('div');
  stage.append(thumb);
  document.body.append(stage);
  let selected = null;
  let editor;
  const rerenderPreview = () => {
    if (editor.isEditing()) return;
    thumb.innerHTML = '';
    thumb.append(
      renderSlideElement(slide, { mode: 'edit', lang: NO_DECK_LANG }),
    );
    editor.refresh();
  };
  editor = createInlineEditor({
    thumb,
    previewStage: stage,
    getSlide: () => slide,
    getSlideDef: (type) => SLIDE_TYPES[type],
    getCanEdit: () => true,
    markDirty: () => {},
    rerenderPreview,
    openImagePicker: () => {},
    pres: { id: 'p1', slides: [slide] },
    onSelectElement: (el) => {
      selected = el || null;
    },
    getSelectedElement: () => selected,
  });
  rerenderPreview();
  return {
    thumb,
    rerenderPreview,
    selected: () => selected,
    field: (key) => thumb.querySelector(`[data-inline-field="${key}"]`),
    teardown: () => {
      editor.detach();
      stage.remove();
    },
  };
}

const click = (el) =>
  el.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  );

for (const type of ['image-text-slide', 'image-slide']) {
  test(`${type}: the focal point shows only on the selected image`, () => {
    const content = structuredClone(SLIDE_TYPES[type].defaults);
    content.image = 'https://example.com/photo.jpg';
    content.fit = 'cover';
    const env = mount({ id: 's', type, content });
    try {
      const point = () => env.thumb.querySelector('.ie-focus-point');
      assert.ok(point(), 'a cropped image carries a focal point');
      assert.equal(point().hidden, true, 'hidden before the image is selected');
      click(env.thumb.querySelector('[data-inline-photo]'));
      assert.deepEqual(env.selected(), { kind: 'image', idx: 0 });
      assert.equal(point().hidden, false, 'draggable once it is selected');
      env.rerenderPreview();
      assert.equal(
        point().hidden,
        false,
        'a remount keeps it on the selection',
      );
    } finally {
      env.teardown();
    }
  });
}
