/**
 * A selected text field keeps its ring while focus is elsewhere (B465).
 *
 * Clicking a text field selects it (`{kind:'text', fieldKey}`) and edits it in
 * place. After the edit blurs - focus moves to the sidebar to pick a colour -
 * the controller still holds the selection, and every remount the sidebar
 * change triggers must draw the ring again: the canvas mirrors the
 * controller's state (syncSelection), exactly as it does for a selected
 * image. Escape outside an edit drops the selection and the ring with it.
 *
 * The real inline editor runs on a real render in jsdom.
 *
 * Run with: node --test tests/inline-text-selection-ring.test.js
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
const { installDismissOnOutside } = await import('../client/lib/dom.js');

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

/**
 * The field keys whose outline carries the selection ring. Field outlines are
 * the first boxes drawn after a clear, in document order of the fields.
 */
function ringedFields(env) {
  const fields = [...env.thumb.querySelectorAll('[data-inline-field]')];
  const boxes = [...env.thumb.querySelectorAll('.ie-ol-outline')];
  return fields
    .filter((_, i) => boxes[i]?.classList.contains('is-selected'))
    .map((el) => el.getAttribute('data-inline-field'));
}

const click = (el) =>
  el.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  );
const escape = (el) =>
  el.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }),
  );

const SLIDE = {
  id: 's',
  type: 'title-slide',
  content: { title: 'Hello', subheading: 'World' },
};

test('a selected text field keeps its ring after the edit blurs and the slide remounts', () => {
  const env = mount(structuredClone(SLIDE));
  try {
    click(env.field('subheading'));
    assert.deepEqual(env.selected(), { kind: 'text', fieldKey: 'subheading' });
    // Focus leaves for the sidebar: the edit commits (no change) and the
    // canvas is redecorated.
    env.field('subheading').blur();
    assert.deepEqual(ringedFields(env), ['subheading']);
    // A colour pick in the sidebar remounts the preview.
    env.rerenderPreview();
    assert.deepEqual(
      ringedFields(env),
      ['subheading'],
      'the remount draws the ring again from the controller state',
    );
  } finally {
    env.teardown();
  }
});

test('Escape outside an edit drops the selection and its ring', () => {
  const env = mount(structuredClone(SLIDE));
  try {
    click(env.field('title'));
    env.field('title').blur();
    assert.deepEqual(ringedFields(env), ['title']);
    escape(document.body);
    assert.equal(env.selected(), null);
    assert.deepEqual(ringedFields(env), []);
  } finally {
    env.teardown();
  }
});

test('Escape inside an edit cancels the edit but keeps the selection', () => {
  const env = mount(structuredClone(SLIDE));
  try {
    click(env.field('title'));
    escape(env.field('title'));
    assert.deepEqual(env.selected(), { kind: 'text', fieldKey: 'title' });
    assert.deepEqual(ringedFields(env), ['title']);
  } finally {
    env.teardown();
  }
});

test('Escape typed into a form control belongs to that control', () => {
  const env = mount(structuredClone(SLIDE));
  const input = document.createElement('input');
  document.body.append(input);
  try {
    click(env.field('title'));
    env.field('title').blur();
    escape(input);
    assert.deepEqual(env.selected(), { kind: 'text', fieldKey: 'title' });
  } finally {
    input.remove();
    env.teardown();
  }
});

test('Escape that closes a sidebar dropdown leaves the selection alone', () => {
  // One layer per Escape: the dropdown consumes the key (defaultPrevented), so
  // the selection clear does not run on the same keypress. A second Escape,
  // with nothing open, drops the selection.
  const env = mount(structuredClone(SLIDE));
  const menu = document.createElement('div');
  const item = document.createElement('button');
  menu.append(item);
  document.body.append(menu);
  let open = true;
  const uninstall = installDismissOnOutside({
    rootEl: menu,
    isOpen: () => open,
    close: () => {
      open = false;
    },
  });
  try {
    click(env.field('title'));
    env.field('title').blur();
    escape(item);
    assert.equal(open, false, 'the dropdown closes');
    assert.deepEqual(env.selected(), { kind: 'text', fieldKey: 'title' });
    assert.deepEqual(ringedFields(env), ['title']);
    escape(item);
    assert.equal(env.selected(), null);
  } finally {
    uninstall();
    menu.remove();
    env.teardown();
  }
});
