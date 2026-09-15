/**
 * A ghost chip spawns its field on a server-rendered slide type (B276).
 *
 * Fork types and fork overrides of a core name are drawn by the server:
 * `renderSlideElement()` returns a `slide-loading` placeholder and fills in the
 * real markup once `/render-slide` answers. `spawnFromGhost()` used to look up
 * the spawned `[data-inline-field]` synchronously right after the rerender, so
 * on such a type it found only the placeholder, reset the field and did
 * nothing. It now waits on `slideRendered()` for the slide on the canvas.
 *
 * The server is simulated by listing core `title-slide` and `end-slide` as fork
 * overrides (`window.__DECK_SERVER_RENDERED_TYPES__`, the same head global the
 * app shell injects) and answering the render request asynchronously with the
 * shared renderer's markup. That exercises the real render path, the real
 * descriptors and the real inline editor.
 *
 * Run with: node --test tests/inline-ghost-server-rendered.test.js
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

const { SLIDE_TYPES, renderSlideHtml } =
  await import('../shared/slide-types.js');
const { renderSlideElement, slideRendered, NO_DECK_LANG } =
  await import('../client/lib/slide-runtime/slide-render.js');
const { createInlineEditor } =
  await import('../client/views/editor/inline-edit/inline-editor.js');

const SENTINEL = '​';

window.__DECK_SERVER_RENDERED_TYPES__ = ['title-slide', 'end-slide'];

/** Resolve once `fn()` is truthy, or fail after `ms`. */
async function waitFor(fn, ms = 2000) {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/**
 * Mount an inline editor on one server-rendered slide, the way the editor
 * controller wires it: remount on rerender, redecorate after each mount and
 * again when the server markup lands.
 */
function setup(slide) {
  const requests = [];
  const server = { down: false };
  const api = async (url, { body }) => {
    const sent = JSON.parse(body);
    requests.push({ url, slide: sent.slide });
    await new Promise((r) => setTimeout(r, 20));
    if (server.down) throw new Error('render-slide unavailable');
    return { html: renderSlideHtml(sent.slide, { mode: sent.mode }) };
  };
  const stage = document.createElement('div');
  const thumb = document.createElement('div');
  stage.append(thumb);
  document.body.append(stage);
  const pres = { id: 'p1', slides: [slide] };

  let editor;
  const rerenderPreview = () => {
    if (editor.isEditing()) return;
    thumb.innerHTML = '';
    thumb.append(
      renderSlideElement(slide, {
        mode: 'edit',
        presentationId: pres.id,
        api,
        lang: NO_DECK_LANG,
      }),
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
    pres,
  });
  thumb.addEventListener('slide-server-rendered', () => editor.refresh());
  rerenderPreview();
  return {
    thumb,
    requests,
    server,
    ghost: (field) =>
      document.querySelector(`[data-ie-ghost="${field}"]`) || null,
    teardown: () => {
      editor.detach();
      stage.remove();
    },
  };
}

test('slideRendered: a client-rendered slide is ready at once, a deckless server one never', async () => {
  const clientEl = renderSlideElement(
    { id: 'c', type: 'content-slide', content: { title: 'T' } },
    { mode: 'edit', lang: NO_DECK_LANG },
  );
  assert.equal(await slideRendered(clientEl), true);

  const serverEl = renderSlideElement(
    { id: 's', type: 'title-slide', content: { title: 'T' } },
    { mode: 'edit', lang: NO_DECK_LANG },
  );
  assert.equal(serverEl.dataset.needsServerRender, '1');
  assert.equal(
    await slideRendered(serverEl),
    false,
    'without a deck nothing renders it, so waiting must settle, not hang',
  );
  assert.equal(await slideRendered(null), false);
});

test('a text ghost on a server-rendered type spawns the field with the caret in it', async () => {
  const slide = { id: 's1', type: 'title-slide', content: { title: 'Hello' } };
  const env = setup(slide);
  try {
    const chip = await waitFor(() => env.ghost('subheading'));
    chip.click();

    const field = await waitFor(() =>
      env.thumb.querySelector('[data-inline-field="subheading"].ie-editing'),
    );
    assert.equal(field.getAttribute('contenteditable'), 'plaintext-only');
    assert.equal(document.activeElement, field, 'the caret is in the field');
    assert.equal(slide.content.subheading, SENTINEL);
    assert.ok(
      env.requests.some((r) => r.slide.content.subheading === SENTINEL),
      'the server was asked to render the field with the spawn sentinel',
    );
  } finally {
    env.teardown();
  }
});

test('a markdown ghost on a server-rendered type spawns a rich in-place edit', async () => {
  const slide = { id: 's2', type: 'end-slide', content: { title: 'Thanks' } };
  const env = setup(slide);
  try {
    const chip = await waitFor(() => env.ghost('body'));
    chip.click();

    const field = await waitFor(() =>
      env.thumb.querySelector('[data-inline-field="body"].ie-editing-rich'),
    );
    assert.equal(field.getAttribute('contenteditable'), 'true');
    assert.equal(document.activeElement, field, 'the caret is in the field');
    assert.equal(field.innerHTML, '', 'a fresh field starts blank');
  } finally {
    env.teardown();
  }
});

test('a failed server render ends the spawn and leaves no sentinel behind', async () => {
  const slide = { id: 's3', type: 'title-slide', content: { title: 'Hello' } };
  // The first render has to succeed for the ghost to exist at all; the
  // server goes down before the chip is clicked.
  const env = setup(slide);
  const originalError = console.error;
  try {
    const chip = await waitFor(() => env.ghost('subheading'));
    env.server.down = true;
    env.requests.length = 0;
    console.error = () => {};
    chip.click();
    // Sentinel render, then the fallback render with the field reset.
    await waitFor(() => env.requests.length >= 2);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(env.requests[1].slide.content.subheading, '');
    assert.equal(slide.content.subheading, '');
    assert.equal(env.thumb.querySelector('.ie-editing'), null);
    assert.equal(env.thumb.querySelector('.ie-ghost-input'), null);
  } finally {
    console.error = originalError;
    env.teardown();
  }
});
