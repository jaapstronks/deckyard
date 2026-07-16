/**
 * Comments as inspector pane (editor-UI track, fase 4).
 *
 * - The pane host owns visibility: the panel's x calls onRequestClose
 *   (dismiss the rail) instead of just hiding its own element.
 * - Threads carry data-comment-id so positioned markers on the canvas can
 *   highlight them; highlightComment scrolls + flashes the thread.
 *
 * Run with: node --test tests/comments-inspector-pane.test.js
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

const COMMENTS = [
  {
    id: 'c1',
    body: 'Eerste opmerking',
    authorName: 'Test',
    status: 'open',
    createdAt: new Date().toISOString(),
    slideId: 's1',
  },
  {
    id: 'c2',
    body: 'Tweede opmerking',
    authorName: 'Test',
    status: 'open',
    createdAt: new Date().toISOString(),
    slideId: 's1',
  },
];

function makePanel({ onRequestClose } = {}) {
  const api = async (path) => {
    if (String(path).includes('/comments/counts')) return { counts: {} };
    if (String(path).includes('/comments')) {
      return { comments: COMMENTS, openCount: COMMENTS.length };
    }
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
    onRequestClose,
  });
  document.body.append(panel.panelEl);
  return panel;
}

test('the header x asks the host to close instead of hiding itself', () => {
  let closeRequests = 0;
  const panel = makePanel({ onRequestClose: () => { closeRequests += 1; } });
  panel.show();
  const closeBtn = panel.panelEl.querySelector('.comments-close-btn');
  closeBtn.click();
  assert.equal(closeRequests, 1, 'onRequestClose called');
  assert.notEqual(panel.panelEl.style.display, 'none', 'panel not self-hidden');
  panel.panelEl.remove();
});

test('threads carry data-comment-id and highlightComment flags the thread', async () => {
  const panel = makePanel();
  panel.show();
  await panel.loadComments();
  assert.ok(
    panel.panelEl.querySelector('[data-comment-id="c2"]'),
    'thread rendered with data-comment-id'
  );
  await panel.highlightComment('c2');
  // highlightComment reloads the list, so re-query the (fresh) thread node.
  const thread = panel.panelEl.querySelector('[data-comment-id="c2"]');
  assert.ok(thread.classList.contains('is-highlighted'), 'thread highlighted');
  panel.panelEl.remove();
});

test('highlightComment is a no-op for unknown ids', async () => {
  const panel = makePanel();
  panel.show();
  await panel.loadComments();
  await panel.highlightComment('nope');
  assert.equal(panel.panelEl.querySelector('.is-highlighted'), null);
  panel.panelEl.remove();
});
