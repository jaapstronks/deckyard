/**
 * A comment marker on the slide is an icon-only button, so its tooltip and its
 * accessible name carry the author and the start of the comment. The author
 * comes from the D22 shape (`comment.author.displayName`); the old
 * `authorName || authorEmail` read made it "undefined: …" (B746).
 *
 * Run with: node --test tests/comment-marker-label.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;

const { createCommentMarkers } =
  await import('../client/views/comments/comment-markers.js');
const { commentExcerpt } =
  await import('../client/views/comments/comment-body.js');

/** A positioned comment as GET /comments returns it (D22). */
function d22Comment(overrides = {}) {
  return {
    id: 'c1',
    body: 'Source for this claim?',
    author: { id: 'u1', displayName: 'Ada Lovelace' },
    positionX: 40,
    positionY: 30,
    status: 'open',
    replies: [],
    ...overrides,
  };
}

function renderMarker(comment) {
  const containerEl = document.createElement('div');
  const markers = createCommentMarkers({ containerEl });
  markers.setComments([comment]);
  const marker = containerEl.querySelector('.comment-marker');
  markers.detach();
  return marker;
}

test('marker names the author and the comment start, as tooltip and accessible name', () => {
  const marker = renderMarker(d22Comment());
  const expected = 'Comment by Ada Lovelace: Source for this claim?';
  assert.equal(marker.getAttribute('aria-label'), expected);
  assert.equal(marker.getAttribute('title'), expected);
  assert.doesNotMatch(expected, /undefined/);
});

test('marker without an author falls back to the unknown-author word', () => {
  const marker = renderMarker(d22Comment({ author: null }));
  assert.equal(
    marker.getAttribute('aria-label'),
    'Comment by Unknown: Source for this claim?',
  );
});

test('an AI suggestion marker reads as the assistant', () => {
  const marker = renderMarker(d22Comment({ isAi: true }));
  assert.match(marker.getAttribute('aria-label'), /^Comment by AI Assistant: /);
});

test('the excerpt shows mentions and links as readers see them and cuts long text', () => {
  assert.equal(
    commentExcerpt(
      'Ask @[Grace](user:grace@example.com) about [the deck](https://example.com)',
    ),
    'Ask @Grace about the deck',
  );
  const long = 'word '.repeat(20);
  const cut = commentExcerpt(long);
  assert.ok(cut.endsWith('…'));
  assert.ok(cut.length <= 51);
  assert.equal(commentExcerpt('  two\n\nlines  '), 'two lines');
});
