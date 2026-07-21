/**
 * "This slide" scope on a deck with no slide to scope to.
 *
 * The slide scope is derived on every load: filter.slideId comes from the
 * current selection, and is only sent to the API when set. On a zero-slide
 * deck (or before the first selection lands) there is no id, so the request
 * went out unscoped and the API answered with every comment in the deck —
 * a deck-wide list under a switch that still read "This slide".
 *
 * Run with: node --test tests/comments-scope-no-slide.test.js
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
globalThis.EventSource = class {
  addEventListener() {}
  close() {}
};

const { h } = await import('../client/lib/dom.js');
const { createCommentsPanel } = await import(
  '../client/views/editor/comments-panel.js'
);

const DECK_COMMENTS = [
  {
    id: 'c1',
    body: 'Hoort bij slide 1',
    authorName: 'Test',
    status: 'open',
    createdAt: new Date().toISOString(),
    slideId: 's1',
  },
  {
    id: 'c2',
    body: 'Hoort bij slide 2',
    authorName: 'Test',
    status: 'open',
    createdAt: new Date().toISOString(),
    slideId: 's2',
  },
];

/** @param {{selectedSlideId?: string|null, slides?: object[]}} opts */
function makePanel({ selectedSlideId = null, slides = [] } = {}) {
  const requests = [];
  const api = async (path) => {
    requests.push(String(path));
    if (String(path).includes('/comments/counts')) return { counts: {} };
    if (String(path).includes('/comments')) {
      // Mirrors the server: no slideId filter means the whole deck.
      const wanted = new URL(String(path), 'http://x').searchParams.get('slideId');
      const comments = wanted
        ? DECK_COMMENTS.filter((c) => c.slideId === wanted)
        : DECK_COMMENTS;
      return { comments, openCount: DECK_COMMENTS.length };
    }
    return {};
  };
  const panel = createCommentsPanel({
    h,
    api,
    toast: { error: () => {} },
    presentationId: 'p1',
    pres: { id: 'p1', slides },
    user: { email: 'dev@local' },
    getSelectedSlideId: () => selectedSlideId,
  });
  document.body.append(panel.panelEl);
  return { panel, requests };
}

test('a deck with no slides shows no comments under the "This slide" scope', async () => {
  const { panel } = makePanel({ selectedSlideId: null, slides: [] });
  panel.show();
  await panel.loadComments();

  assert.equal(
    panel.panelEl.querySelector('[data-comment-id]'),
    null,
    'no deck-wide comments leaked into the slide scope'
  );
  assert.ok(panel.panelEl.querySelector('.comments-empty'), 'empty state shown');
  panel.panelEl.remove();
});

test('switching to "All slides" still shows the whole deck', async () => {
  const { panel } = makePanel({ selectedSlideId: null, slides: [] });
  panel.show();
  await panel.loadComments();
  panel.panelEl.querySelectorAll('.comments-scope-btn')[1].click();
  // setScope reloads asynchronously; let the load settle.
  await new Promise((r) => setTimeout(r, 0));
  await panel.loadComments();

  assert.ok(panel.panelEl.querySelector('[data-comment-id="c1"]'), 'c1 shown');
  assert.ok(panel.panelEl.querySelector('[data-comment-id="c2"]'), 'c2 shown');
  panel.panelEl.remove();
});

test('a selected slide still scopes to that slide', async () => {
  const { panel } = makePanel({ selectedSlideId: 's1', slides: [{ id: 's1' }, { id: 's2' }] });
  panel.show();
  await panel.loadComments();

  assert.ok(panel.panelEl.querySelector('[data-comment-id="c1"]'), 'own comment shown');
  assert.equal(
    panel.panelEl.querySelector('[data-comment-id="c2"]'),
    null,
    "other slide's comment hidden"
  );
  panel.panelEl.remove();
});
