/**
 * Slide locks are taken on the first real change, not on selection (D112).
 *
 * A deck shared with the whole organization read as "you may not edit this":
 * whoever opened it first held slide 1 for as long as their tab stayed open,
 * and everyone after them landed on slide 1 and its "being edited by someone
 * else" banner. The lock manager now:
 * - takes no lock on init or selection, however many slides are clicked;
 * - asks for the lock once the selected slide's content actually changes, and
 *   leaves deck-level edits (title, settings) lock-free;
 * - refuses an edit on a slide another user holds, at once when that lock is
 *   known and when the acquire comes back held;
 * - releases a held lock after IDLE_RELEASE_MS without a change and when the
 *   tab is hidden, saving pending edits first.
 * Taking the refused change back out of the local copy is
 * restoreSlideFromServer, tested at the bottom.
 *
 * Run with: node --test tests/slide-lock-on-edit.test.js
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

let visibility = 'visible';
Object.defineProperty(dom.window.document, 'visibilityState', {
  configurable: true,
  get: () => visibility,
});

const { createSlideLockManager, IDLE_RELEASE_MS } =
  await import('../client/views/editor/slide-lock-manager.js');
const { restoreSlideFromServer } =
  await import('../client/views/editor/slide-lock-restore.js');

const ME = { id: 'u-me', email: 'me@example.com' };
const OTHER_LOCK = { holder: { id: 'u-other', displayName: 'Other' } };

/** Let queued lock ops (a promise chain) run to completion. */
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

function makeManager({ acquire } = {}) {
  const calls = [];
  const events = [];
  const deck = {
    slides: [
      { id: 's1', type: 'title', title: 'One' },
      { id: 's2', type: 'title', title: 'Two' },
    ],
  };
  let selected = 's1';
  const api = async (path, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push(`${method} ${path}`);
    if (path.endsWith('/slide-locks')) {
      return { ok: true, locks: {}, lockedByOthers: [] };
    }
    if (method === 'POST' && path.endsWith('/lock')) {
      if (acquire) return acquire(path);
      return { ok: true, lock: { holder: { id: ME.id } } };
    }
    return { ok: true };
  };
  const mgr = createSlideLockManager({
    api,
    presentationId: 'p1',
    user: ME,
    getSelectedSlideId: () => selected,
    getSlide: (sid) => deck.slides.find((s) => s.id === sid) || null,
    beforeRelease: async () => {
      events.push('beforeRelease');
    },
    onLockFailed: (info) => events.push({ failed: info }),
  });
  const select = (sid) => {
    selected = sid;
    return mgr.onSlideSelected(sid);
  };
  const edit = (sid, title) => {
    deck.slides.find((s) => s.id === sid).title = title;
    return mgr.onSlideEdited(sid);
  };
  const lockCalls = () =>
    calls.filter((c) => /\/slides\/[^/]+\/lock(\/refresh)?$/.test(c));
  return { mgr, deck, calls, events, select, edit, lockCalls };
}

function dispatchLock(type, data) {
  window.dispatchEvent(
    new dom.window.CustomEvent('sse:slide-lock', { detail: { type, data } }),
  );
}

test('opening a deck and clicking through its slides takes no lock', async () => {
  const { mgr, select, lockCalls } = makeManager();
  await mgr.init();
  await select('s1');
  await select('s2');
  await select('s1');
  await flush();
  assert.deepEqual(lockCalls(), []);
  assert.equal(mgr.getCurrentLockedSlideId(), null);
  await mgr.detach();
});

test('an edit that leaves the selected slide unchanged takes no lock', async () => {
  const { mgr, select, lockCalls } = makeManager();
  await mgr.init();
  await select('s1');
  // A deck-title or settings change reaches markDirty with the slide as-is.
  assert.equal(mgr.onSlideEdited('s1'), true);
  await flush();
  assert.deepEqual(lockCalls(), []);
  await mgr.detach();
});

test('the first change to a slide takes its lock, once', async () => {
  const { mgr, select, edit, lockCalls } = makeManager();
  await mgr.init();
  await select('s1');
  assert.equal(edit('s1', 'One!'), true);
  assert.equal(edit('s1', 'One!!'), true);
  await flush();
  assert.deepEqual(lockCalls(), ['POST /api/presentations/p1/slides/s1/lock']);
  assert.equal(mgr.getCurrentLockedSlideId(), 's1');
  await mgr.detach();
});

test('a change to a slide another user holds is refused with their lock', async () => {
  const { mgr, select, edit, events, lockCalls } = makeManager();
  await mgr.init();
  await select('s1');
  dispatchLock('slide:locked', { slideId: 's1', lock: OTHER_LOCK });
  assert.equal(edit('s1', 'Mine'), false);
  await flush();
  assert.deepEqual(lockCalls(), [], 'no acquire for a known lock');
  assert.deepEqual(events, [
    { failed: { slideId: 's1', reason: 'held', lock: OTHER_LOCK } },
  ]);
  await mgr.detach();
});

test('an acquire that comes back held refuses the edit after the fact', async () => {
  const { mgr, select, edit, events } = makeManager({
    acquire: () => {
      const err = new Error('held');
      err.code = 'held';
      err.details = { lock: OTHER_LOCK };
      throw err;
    },
  });
  await mgr.init();
  await select('s1');
  assert.equal(edit('s1', 'Mine'), true, 'allowed while the acquire runs');
  await flush();
  assert.deepEqual(events, [
    { failed: { slideId: 's1', reason: 'held', lock: OTHER_LOCK } },
  ]);
  assert.equal(mgr.getCurrentLockedSlideId(), null);
  assert.equal(mgr.isLockedByOther('s1'), true);
  await mgr.detach();
});

test('switching slides saves pending edits, then releases the held lock', async () => {
  const { mgr, select, edit, events, lockCalls } = makeManager();
  await mgr.init();
  await select('s1');
  edit('s1', 'One!');
  await flush();
  await select('s2');
  await flush();
  assert.deepEqual(lockCalls(), [
    'POST /api/presentations/p1/slides/s1/lock',
    'DELETE /api/presentations/p1/slides/s1/lock',
  ]);
  assert.deepEqual(events, ['beforeRelease']);
  assert.equal(mgr.getCurrentLockedSlideId(), null);
  await mgr.detach();
});

test('a slide replaced from the server is no edit after resyncSlide', async () => {
  const { mgr, deck, select, lockCalls } = makeManager();
  await mgr.init();
  await select('s1');
  deck.slides[0] = { id: 's1', type: 'title', title: 'Remote' };
  mgr.resyncSlide('s1');
  assert.equal(mgr.onSlideEdited('s1'), true);
  await flush();
  assert.deepEqual(lockCalls(), []);
  await mgr.detach();
});

test('a held lock is released after idle, but kept while editing continues', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const { mgr, select, edit, events, lockCalls } = makeManager();
  await mgr.init();
  await select('s1');
  edit('s1', 'One!');
  await flush();

  // Still editing: each refresh tick keeps the lock.
  for (let i = 1; i <= 5; i += 1) {
    t.mock.timers.tick(30 * 1000);
    edit('s1', `One ${i}`);
    await flush();
  }
  assert.equal(mgr.getCurrentLockedSlideId(), 's1');
  assert.ok(
    lockCalls().includes('POST /api/presentations/p1/slides/s1/lock/refresh'),
  );
  assert.ok(!lockCalls().some((c) => c.startsWith('DELETE')));

  // Then nothing changes for IDLE_RELEASE_MS: the next tick lets go.
  t.mock.timers.tick(IDLE_RELEASE_MS + 30 * 1000);
  await flush();
  assert.equal(mgr.getCurrentLockedSlideId(), null);
  assert.equal(
    lockCalls().at(-1),
    'DELETE /api/presentations/p1/slides/s1/lock',
  );
  assert.deepEqual(events, ['beforeRelease']);

  // Editing again asks for the lock again.
  edit('s1', 'Back');
  await flush();
  assert.equal(lockCalls().at(-1), 'POST /api/presentations/p1/slides/s1/lock');
  await mgr.detach();
});

test('hiding the tab releases a held lock', async () => {
  const { mgr, select, edit, lockCalls } = makeManager();
  const cleanup = await mgr.init();
  await select('s1');
  edit('s1', 'One!');
  await flush();
  visibility = 'hidden';
  document.dispatchEvent(new dom.window.Event('visibilitychange'));
  await flush();
  visibility = 'visible';
  assert.equal(mgr.getCurrentLockedSlideId(), null);
  assert.equal(
    lockCalls().at(-1),
    'DELETE /api/presentations/p1/slides/s1/lock',
  );
  cleanup();
  await mgr.detach();
});

test('restoreSlideFromServer replaces the local slide with the server copy of the active language', async () => {
  const requested = [];
  const api = async (path) => {
    requested.push(path);
    return {
      slides: [
        { id: 's1', type: 'title', title: 'Server' },
        { id: 's2', type: 'title', title: 'Two' },
      ],
    };
  };
  const pres = {
    i18n: { active: 'nl' },
    slides: [
      { id: 's1', type: 'title', title: 'Refused', notes: '' },
      { id: 's2', type: 'title', title: 'Two (local)', notes: '' },
    ],
  };
  const restored = await restoreSlideFromServer({
    api,
    presentationId: 'p1',
    pres,
    slideId: 's1',
  });
  assert.equal(restored, true);
  assert.deepEqual(requested, ['/api/presentations/p1?lang=nl']);
  assert.deepEqual(pres.slides[0], {
    id: 's1',
    type: 'title',
    title: 'Server',
    notes: '',
  });
  assert.equal(pres.slides[1].title, 'Two (local)', 'other slides untouched');
});
