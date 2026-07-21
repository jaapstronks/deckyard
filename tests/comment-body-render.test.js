/**
 * renderCommentBodyNodes: comment bodies render @mention markers as inline
 * `.comment-mention-chip` spans and keep the rest as plain text. Shared by the
 * editor thread, share viewer, and preview lightbox so chips look identical
 * everywhere.
 *
 * Run with: node --test tests/comment-body-render.test.js
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

const { h } = await import('../client/lib/dom.js');
const { renderCommentBodyNodes } = await import('../client/lib/comments/comment-body.js');

function render(body) {
  const el = document.createElement('div');
  el.append(...renderCommentBodyNodes(body, h));
  return el;
}

test('a mention marker renders as a chip with @Name and email title', () => {
  const el = render('Hey @[Chris de Vries](user:chris@example.com), kijk mee');
  const chips = el.querySelectorAll('.comment-mention-chip');
  assert.equal(chips.length, 1);
  assert.equal(chips[0].textContent, '@Chris de Vries');
  assert.equal(chips[0].getAttribute('title'), 'chris@example.com');
  // The raw marker must not leak into the rendered text.
  assert.ok(!el.textContent.includes('user:'));
  assert.ok(!el.textContent.includes(']('));
  assert.equal(el.textContent, 'Hey @Chris de Vries, kijk mee');
});

test('multiple mentions each become their own chip', () => {
  const el = render('@[Sam](user:sam@x.com) en @[Chris](user:chris@x.com)');
  assert.equal(el.querySelectorAll('.comment-mention-chip').length, 2);
});

test('a plain body with no mentions renders as a single text node', () => {
  const el = render('gewoon een reactie zonder mention');
  assert.equal(el.querySelectorAll('.comment-mention-chip').length, 0);
  assert.equal(el.textContent, 'gewoon een reactie zonder mention');
});

test('an empty/undefined body renders nothing and does not throw', () => {
  assert.equal(render('').textContent, '');
  assert.equal(render(undefined).textContent, '');
});

test('markup-looking body text is not treated as HTML (rendered as text)', () => {
  const el = render('<b>@[X](user:x@x.com)</b>');
  // No <b> element: everything is text/chip nodes, so no injection.
  assert.equal(el.querySelectorAll('b').length, 0);
  assert.equal(el.querySelectorAll('.comment-mention-chip').length, 1);
});

/**
 * Links (phase 2a). A comment body may carry `[label](url)` alongside
 * mentions. The URL is allowlisted at parse time, so an unsafe scheme never
 * reaches an `href` — the markup just stays visible as text.
 */

test('a link renders as an anchor that is safe to open', () => {
  const el = render('zie [de roadmap](https://example.com/r) even');
  const a = el.querySelector('a.comment-body-link');
  assert.equal(a.getAttribute('href'), 'https://example.com/r');
  assert.equal(a.textContent, 'de roadmap');
  assert.equal(a.getAttribute('target'), '_blank');
  // noopener: an untrusted link must not get a handle on our window.
  const rel = a.getAttribute('rel');
  assert.ok(rel.includes('noopener'));
  assert.ok(rel.includes('noreferrer'));
  assert.equal(el.textContent, 'zie de roadmap even');
});

test('a mention and a link can sit in the same body', () => {
  const el = render('@[Ann](user:ann@x.com) zie [docs](https://d.example)');
  assert.equal(el.querySelectorAll('.comment-mention-chip').length, 1);
  assert.equal(el.querySelectorAll('a.comment-body-link').length, 1);
});

test('an unsafe URL produces no anchor at all', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x']) {
    const el = render(`klik [hier](${url})`);
    assert.equal(el.querySelectorAll('a').length, 0, `${url} must not become an anchor`);
    // The raw markup stays readable, which is the harmless outcome.
    assert.ok(el.textContent.includes('[hier]'), `${url} should stay literal`);
  }
});

test('mailto is allowed', () => {
  const el = render('mail [Ann](mailto:ann@x.com)');
  assert.equal(el.querySelector('a').getAttribute('href'), 'mailto:ann@x.com');
});
