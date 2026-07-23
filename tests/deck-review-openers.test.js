/**
 * Deck-review openers factory: the shared jumpToSlide guard + wiring. Guards
 * the extraction of the deck-overview / AI-review openers out of
 * editor-controller.js into client/views/editor/deck-review-openers.js. Only
 * jumpToSlide has testable logic without a DOM modal; the openers are thin
 * dep-spreading wrappers, so we assert they exist and that the jump behaves.
 *
 * Run with: node --test tests/deck-review-openers.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { createDeckReviewOpeners } = await import(
  '../client/views/editor/deck-review-openers.js'
);

function setup(pres) {
  const calls = { selected: [], rerenders: [] };
  const openers = createDeckReviewOpeners({
    h: () => {},
    root: {},
    api: {},
    pres,
    theme: {},
    SLIDE_TYPES: {},
    openOverlayClosers: new Set(),
    editorState: {},
    nav: {},
    setSelectedSlideId: (id) => calls.selected.push(id),
    rerenderSlideList: () => calls.rerenders.push('list'),
    rerenderEditor: () => calls.rerenders.push('editor'),
    rerenderPreview: () => calls.rerenders.push('preview'),
    getSlideListEl: () => null,
  });
  return { openers, calls };
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
      'repaints list, editor and preview'
    );
    assert.equal(rafRan, true, 'schedules the scroll-into-view frame');
  } finally {
    globalThis.requestAnimationFrame = prevRaf;
  }
});
