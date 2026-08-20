/**
 * Toast coerces a thrown Error to its message (A7.16 cluster 2).
 *
 * The canonical failure form is `catch (e) { toast.error(e, opts) }`: the
 * caught error itself is the argument, and the toast layer owns the
 * error→text spelling. Before this, every call site hand-rolled
 * `String(e?.message || e)` — 51 sites of one expression. This locks the
 * coercion so the swept sites keep rendering the same text.
 *
 * Run with: node --test tests/toast-error-coercion.test.js
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
globalThis.SVGElement = dom.window.SVGElement;

const { toast } = await import('../client/lib/dom/toast.js');

function lastToastText() {
  const els = document.querySelectorAll('.toast .toast-text');
  return els.length ? els[els.length - 1].textContent : null;
}

test('toast.error(err) renders the error message', () => {
  toast.error(new Error('Request failed (500)'));
  assert.equal(lastToastText(), 'Request failed (500)');
});

test('an Error without a message falls back to its String() form', () => {
  toast.error(new Error(''));
  assert.equal(lastToastText(), 'Error');
});

test('plain strings still pass through unchanged', () => {
  toast.error('Plain copy');
  assert.equal(lastToastText(), 'Plain copy');
});
