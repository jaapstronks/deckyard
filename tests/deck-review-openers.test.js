/**
 * Deck-review openers factory: the shared jumpToSlide guard + wiring. Guards
 * the extraction of the deck-overview / AI-review openers out of
 * editor-controller.js into client/views/editor/deck-review-openers.js. The openers
 * are thin dep-spreading wrappers, so we assert the jump behaves and that
 * openDeckOverview really mounts (and tears down) an overlay under jsdom.
 * This file used to hand the factory a no-op `h` stub instead — the last
 * consumer of the `h`-as-parameter seam (A7.33).
 *
 * Run with: node --test tests/deck-review-openers.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/editor/test-id',
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
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame =
  dom.window.cancelAnimationFrame || clearTimeout;

const { createDeckReviewOpeners } =
  await import('../client/views/editor/deck-review-openers.js');

function setup(pres) {
  const calls = { selected: [], rerenders: [] };
  const root = document.createElement('div');
  document.body.append(root);
  const openers = createDeckReviewOpeners({
    root,
    api: {},
    pres,
    theme: {},
    SLIDE_TYPES: {},
    editorState: {},
    setSelectedSlideId: (id) => calls.selected.push(id),
    rerenderSlideList: () => calls.rerenders.push('list'),
    rerenderEditor: () => calls.rerenders.push('editor'),
    rerenderPreview: () => calls.rerenders.push('preview'),
    getSlideListEl: () => null,
  });
  return { openers, calls, root };
}

test('factory returns the three openers', () => {
  const { openers } = setup({ slides: [] });
  assert.equal(typeof openers.jumpToSlide, 'function');
  assert.equal(typeof openers.openDeckOverview, 'function');
  assert.equal(typeof openers.openAiDeckReview, 'function');
});

test('jumpToSlide ignores unknown / empty slide ids', () => {
  const prevRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => {};
  try {
    const { openers, calls } = setup({ slides: [{ id: 's1' }] });
    openers.jumpToSlide('');
    openers.jumpToSlide('nope');
    assert.deepEqual(calls.selected, [], 'no selection for unknown ids');
    assert.deepEqual(calls.rerenders, [], 'no rerenders for unknown ids');
  } finally {
    globalThis.requestAnimationFrame = prevRaf;
  }
});

test('jumpToSlide selects and repaints for a known slide', () => {
  const prevRaf = globalThis.requestAnimationFrame;
  let rafRan = false;
  globalThis.requestAnimationFrame = (cb) => {
    rafRan = true;
    cb();
  };
  try {
    const { openers, calls } = setup({ slides: [{ id: 's1' }, { id: 's2' }] });
    openers.jumpToSlide('s2');
    assert.deepEqual(calls.selected, ['s2'], 'selects the target slide');
    assert.deepEqual(
      calls.rerenders,
      ['list', 'editor', 'preview'],
      'repaints list, editor and preview',
    );
    assert.equal(rafRan, true, 'schedules the scroll-into-view frame');
  } finally {
    globalThis.requestAnimationFrame = prevRaf;
  }
});

test('openDeckOverview mounts a real overlay and Escape tears it down', () => {
  const { openers, root } = setup({
    id: 'p1',
    slides: [{ id: 's1', type: 'content' }],
  });

  openers.openDeckOverview();

  const backdrop = root.querySelector('.modal-backdrop');
  assert.ok(backdrop, 'the overview modal mounts into the editor root');
  const modal = backdrop.querySelector('.modal-deck-grid');
  assert.ok(modal, 'it carries the deck-grid modal class');
  assert.equal(modal.getAttribute('aria-modal'), 'true');

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(
    root.querySelector('.modal-backdrop'),
    null,
    'Escape closes the overlay',
  );
});
