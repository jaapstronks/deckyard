/**
 * Slide lock manager: emitLocksChanged is a no-op on unchanged state.
 *
 * A second editor's SSE stream floods the panel with slide:locked /
 * slide:unlocked / slide:locks-changed echoes. Most leave the *visible* lock
 * state untouched, yet each emit used to trigger a full slide-list rebuild
 * (measured: ~44 rebuilds / 751 ms blocked main thread over 60 s idle on an
 * 80-slide deck). The manager now suppresses emits whose broadcast signature
 * is identical to the last one, while still firing when a lock is genuinely
 * taken or released — the indicator must appear AND disappear.
 *
 * Run with: node --test tests/slide-lock-rerender-guard.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/p1',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.EventSource = class {
  addEventListener() {}
  close() {}
};

const { createSlideLockManager } =
  await import('../client/views/editor/slide-lock-manager.js');

function makeManager() {
  let calls = 0;
  const api = async (path) => {
    // Initial fetchLocks (init) and release-all (destroy) both hit this.
    if (String(path).endsWith('/slide-locks')) {
      return { ok: true, locks: {}, lockedByOthers: [] };
    }
    return { ok: true };
  };
  const mgr = createSlideLockManager({
    api,
    presentationId: 'p1',
    getSelectedSlideId: () => null,
    onLocksChanged: () => {
      calls += 1;
    },
  });
  return { mgr, getCalls: () => calls };
}

function dispatchLock(type, data) {
  window.dispatchEvent(
    new dom.window.CustomEvent('sse:slide-lock', { detail: { type, data } }),
  );
}

test('a second identical lock event produces zero onLocksChanged calls', async () => {
  const { mgr, getCalls } = makeManager();
  await mgr.init();

  const baseline = getCalls(); // initial fetchLocks emit

  dispatchLock('slide:locked', {
    slideId: 's1',
    lock: { holderEmail: 'other@example.com', holderName: 'Other' },
  });
  const afterFirst = getCalls();
  assert.equal(afterFirst, baseline + 1, 'first lock event notifies once');

  dispatchLock('slide:locked', {
    slideId: 's1',
    lock: { holderEmail: 'other@example.com', holderName: 'Other' },
  });
  assert.equal(getCalls(), afterFirst, 'byte-identical repeat is a no-op');

  await mgr.detach();
});

test('a lock refresh that only advances expiresAt is suppressed', async () => {
  const { mgr, getCalls } = makeManager();
  await mgr.init();

  dispatchLock('slide:locked', {
    slideId: 's1',
    lock: {
      holderEmail: 'other@example.com',
      holderName: 'Other',
      expiresAt: '2026-01-01T00:00:00.000Z',
    },
  });
  const afterFirst = getCalls();

  // Same holder on the same slide, only the TTL advanced — nothing on screen
  // changes, so this must not re-notify. This is the dominant storm source.
  dispatchLock('slide:locked', {
    slideId: 's1',
    lock: {
      holderEmail: 'other@example.com',
      holderName: 'Other',
      expiresAt: '2026-01-01T00:00:30.000Z',
    },
  });
  assert.equal(getCalls(), afterFirst, 'expiresAt-only churn is suppressed');

  await mgr.detach();
});

test('a real lock take and release each notify (indicator appears and disappears)', async () => {
  const { mgr, getCalls } = makeManager();
  await mgr.init();

  const baseline = getCalls();

  // Another user takes a lock on a new slide -> indicator must appear.
  dispatchLock('slide:locked', {
    slideId: 's2',
    lock: { holderEmail: 'other@example.com', holderName: 'Other' },
  });
  const afterTake = getCalls();
  assert.equal(afterTake, baseline + 1, 'taking a lock notifies');

  // ...and releases it -> indicator must disappear.
  dispatchLock('slide:unlocked', { slideId: 's2' });
  assert.equal(getCalls(), afterTake + 1, 'releasing the lock notifies');

  // A repeated unlock of an already-unlocked slide changes nothing.
  dispatchLock('slide:unlocked', { slideId: 's2' });
  assert.equal(getCalls(), afterTake + 1, 'redundant unlock is a no-op');

  await mgr.detach();
});
