/**
 * Shared swipe navigation: the thresholds are the whole behaviour, so they
 * are pinned here. A swipe must be clearly sideways (>=60px horizontal,
 * <=80px vertical) or vertical scrolling would steal slide changes, and the
 * `enabled` gate is what keeps the presenter's draw mode from flipping slides
 * mid-stroke.
 *
 * Run with: node --test tests/swipe-nav.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const { attachSwipeNavigation } = await import('../client/lib/dom/swipe-nav.js');

/** Dispatch one touch event with the given touch-list shape. */
function fire(el, type, { touches, changedTouches, target } = {}) {
  const ev = new dom.window.Event(type, { bubbles: true });
  if (touches) ev.touches = touches;
  if (changedTouches) ev.changedTouches = changedTouches;
  if (target) Object.defineProperty(ev, 'target', { value: target });
  el.dispatchEvent(ev);
  return ev;
}

/** Fire a touch gesture from (x0,y0) to (x1,y1) on `el`. */
function swipe(el, x0, y0, x1, y1, { touches = 1, target } = {}) {
  fire(el, 'touchstart', {
    touches: Array.from({ length: touches }, (_, i) => ({
      clientX: i === 0 ? x0 : x0 + 50,
      clientY: i === 0 ? y0 : y0 + 50,
    })),
    target,
  });
  fire(el, 'touchend', { changedTouches: [{ clientX: x1, clientY: y1 }] });
}

/** Attach to a fresh element and record which direction fired. */
function setup(opts = {}) {
  const el = document.createElement('div');
  document.body.append(el);
  const calls = [];
  const detach = attachSwipeNavigation(el, {
    onPrev: () => calls.push('prev'),
    onNext: () => calls.push('next'),
    ...opts,
  });
  return { el, calls, detach };
}

test('swiping left goes to the next slide, right to the previous', () => {
  const { el, calls } = setup();
  swipe(el, 200, 100, 100, 100);
  assert.deepEqual(calls, ['next']);
  swipe(el, 100, 100, 200, 100);
  assert.deepEqual(calls, ['next', 'prev']);
});

test('a swipe shorter than 60px is ignored', () => {
  const { el, calls } = setup();
  swipe(el, 200, 100, 141, 100); // 59px
  assert.deepEqual(calls, []);
  swipe(el, 200, 100, 140, 100); // exactly 60px
  assert.deepEqual(calls, ['next']);
});

test('a mostly-vertical drag is a scroll, not a swipe', () => {
  const { el, calls } = setup();
  swipe(el, 200, 100, 100, 181); // 100px across but 81px down
  assert.deepEqual(calls, [], 'past the vertical tolerance');
  swipe(el, 200, 100, 100, 180); // exactly 80px down
  assert.deepEqual(calls, ['next'], 'exactly at the tolerance still counts');
});

test('multi-touch is a pinch and never navigates', () => {
  const { el, calls } = setup();
  swipe(el, 200, 100, 100, 100, { touches: 2 });
  assert.deepEqual(calls, []);
});

test('a second finger cancels a gesture already in progress', () => {
  // The real sequence: one finger lands and starts tracking, then a second
  // finger lands. That is a pinch, and the pending gesture must be dropped.
  const { el, calls } = setup();
  fire(el, 'touchstart', { touches: [{ clientX: 200, clientY: 100 }] });
  fire(el, 'touchstart', {
    touches: [
      { clientX: 200, clientY: 100 },
      { clientX: 250, clientY: 150 },
    ],
  });
  fire(el, 'touchend', { changedTouches: [{ clientX: 100, clientY: 100 }] });
  assert.deepEqual(calls, []);
});

test('touchcancel drops the gesture', () => {
  const { el, calls } = setup();
  fire(el, 'touchstart', { touches: [{ clientX: 200, clientY: 100 }] });
  fire(el, 'touchcancel', {});
  fire(el, 'touchend', { changedTouches: [{ clientX: 100, clientY: 100 }] });
  assert.deepEqual(calls, []);
});

test('a drag inside a horizontally scrolling child scrolls, never navigates', () => {
  // Wide tables and charts on a slide are their own scroll containers; a
  // sideways drag there is scrolling that content, not changing slide.
  const { el, calls } = setup();
  const scroller = document.createElement('div');
  el.append(scroller);
  Object.defineProperty(scroller, 'scrollWidth', { value: 2000 });
  Object.defineProperty(scroller, 'clientWidth', { value: 300 });
  scroller.style.overflowX = 'auto';

  swipe(el, 200, 100, 100, 100, { target: scroller });
  assert.deepEqual(calls, [], 'inside the scroller: no navigation');

  swipe(el, 200, 100, 100, 100, { target: el });
  assert.deepEqual(calls, ['next'], 'outside it: normal navigation');
});

test('the enabled gate suppresses navigation without breaking later swipes', () => {
  let allowed = false;
  const { el, calls } = setup({ enabled: () => allowed });
  swipe(el, 200, 100, 100, 100);
  assert.deepEqual(calls, [], 'blocked while disabled');
  allowed = true;
  swipe(el, 200, 100, 100, 100);
  assert.deepEqual(calls, ['next'], 'works again once re-enabled');
});

test('detach removes the listeners', () => {
  const { el, calls, detach } = setup();
  detach();
  swipe(el, 200, 100, 100, 100);
  assert.deepEqual(calls, []);
});

test('a touchend without a matching touchstart does nothing', () => {
  const { el, calls } = setup();
  const end = new dom.window.Event('touchend');
  end.changedTouches = [{ clientX: 0, clientY: 100 }];
  el.dispatchEvent(end);
  assert.deepEqual(calls, []);
});
