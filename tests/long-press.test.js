/**
 * Long-press touch fallback for right-click. The behaviour that matters, and
 * the one that regressed once, is the compat-click guard: after a press fires
 * it swallows the synthetic ("ghost") click the browser may emit on release,
 * but it must stop guarding before the user can tap whatever the press opened
 * — otherwise it eats their first real tap. SYNTHETIC_CLICK_WINDOW_MS is that
 * boundary and is pinned here from both sides.
 *
 * Run with: node --test tests/long-press.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const { attachLongPress, SYNTHETIC_CLICK_WINDOW_MS } = await import(
  '../client/lib/dom/long-press.js'
);

/** Dispatch one touch event with the given touch-list shape. */
function fireTouch(el, type, { touches, target } = {}) {
  const ev = new dom.window.Event(type, { bubbles: true, cancelable: true });
  if (touches) ev.touches = touches;
  if (target) Object.defineProperty(ev, 'target', { value: target });
  el.dispatchEvent(ev);
  return ev;
}

/** A document-level click, as the browser would deliver on tap. */
function fireDocumentClick() {
  return document.dispatchEvent(
    new dom.window.Event('click', { bubbles: true, cancelable: true })
  );
}

/** Drive touchstart → (timer) → touchend, firing the press via mock timers. */
function longPress(el, timers, { x = 30, y = 40, delay = 500 } = {}) {
  fireTouch(el, 'touchstart', { touches: [{ clientX: x, clientY: y }] });
  timers.tick(delay);
  fireTouch(el, 'touchend');
}

test('a click within the window is swallowed once, the next one gets through', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const el = document.createElement('div');
  document.body.append(el);
  const seen = [];
  const spy = () => seen.push('click');
  document.addEventListener('click', spy);
  t.after(() => document.removeEventListener('click', spy));

  const fired = [];
  attachLongPress(el, { onLongPress: () => fired.push('press') });

  longPress(el, t.mock.timers);
  assert.deepEqual(fired, ['press'], 'the long press fired');

  // The ghost click the guard exists for: swallowed, so no listener sees it.
  fireDocumentClick();
  assert.deepEqual(seen, [], 'the synthetic click was swallowed');

  // Guard disarms after one catch, so a real follow-up click gets through.
  fireDocumentClick();
  assert.deepEqual(seen, ['click'], 'the next click is not swallowed');
});

test('the guard expires before a deliberate tap, so the first menu tap works', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const el = document.createElement('div');
  document.body.append(el);
  const seen = [];
  const spy = () => seen.push('click');
  document.addEventListener('click', spy);
  t.after(() => document.removeEventListener('click', spy));

  attachLongPress(el, { onLongPress: () => {} });
  longPress(el, t.mock.timers);

  // No synthetic click arrived (the iOS case, where touchend.preventDefault
  // already suppressed it). Once the window lapses the guard must be gone, or
  // it swallows the user's first tap on the menu the press opened.
  t.mock.timers.tick(SYNTHETIC_CLICK_WINDOW_MS + 50);
  fireDocumentClick();
  assert.deepEqual(seen, ['click'], 'a tap after the window is not swallowed');
});

test('the window is short enough to clear before a human can act', () => {
  // A guard that outlasts reaction time eats the first real tap. This is the
  // regression that shipped at 900ms; keep it well under that.
  assert.ok(
    SYNTHETIC_CLICK_WINDOW_MS <= 500,
    `expected a short guard window, got ${SYNTHETIC_CLICK_WINDOW_MS}ms`
  );
});
