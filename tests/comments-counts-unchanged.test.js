/**
 * Comments panel: loadComments only notifies on a changed per-slide count map.
 *
 * onSlideCommentCountsChange rebuilds the whole slide list (to repaint the
 * per-slide comment indicators). loadComments used to call it unconditionally
 * on every load, so a reload that left the counts untouched — the common case
 * — still forced a full rebuild. The SSE handler already guards its
 * `comment:counts` echo this way; loadComments now matches it.
 *
 * Run with: node --test tests/comments-counts-unchanged.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/p1',
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

/** @param {{counts: Record<string, number>}} state - mutable counts source */
function makePanel(state) {
  const changeCalls = [];
  const api = async (path) => {
    if (String(path).includes('/comments/counts')) return { counts: state.counts };
    if (String(path).includes('/comments')) return { comments: [], openCount: 0 };
    return {};
  };
  const panel = createCommentsPanel({
    h,
    api,
    toast: { error: () => {} },
    presentationId: 'p1',
    pres: { id: 'p1', slides: [{ id: 's1' }] },
    user: { email: 'dev@local' },
    getSelectedSlideId: () => 's1',
    onSlideCommentCountsChange: (c) => changeCalls.push(c),
  });
  document.body.append(panel.panelEl);
  return { panel, changeCalls };
}

test('an unchanged count map does not call onSlideCommentCountsChange', async () => {
  const state = { counts: { s1: 2 } };
  const { panel, changeCalls } = makePanel(state);

  await panel.loadComments();
  assert.equal(changeCalls.length, 1, 'first load notifies');

  await panel.loadComments(); // identical counts
  assert.equal(changeCalls.length, 1, 'unchanged counts do not re-notify');

  panel.panelEl.remove();
});

test('a changed count map still notifies', async () => {
  const state = { counts: { s1: 2 } };
  const { panel, changeCalls } = makePanel(state);

  await panel.loadComments();
  assert.equal(changeCalls.length, 1, 'first load notifies');

  state.counts = { s1: 3 }; // a real change
  await panel.loadComments();
  assert.equal(changeCalls.length, 2, 'changed counts notify again');

  panel.panelEl.remove();
});
