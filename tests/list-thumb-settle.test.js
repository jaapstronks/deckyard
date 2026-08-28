/**
 * Deck-grid thumbnail: the skeleton shimmer must always reach a terminal state.
 *
 * Regression guard for the "shimmer on Recent never stops" bug. The three
 * class-clearing paths (showEmpty / showPlaceholder / img.onload) all hang off
 * the lazy loader, so any route where that chain doesn't complete — the
 * IntersectionObserver callback never firing for a visible card, or a thumbnail
 * response that resolves neither `load` nor `error` — used to leave `.thumb`
 * stuck in `.is-loading` forever. A safety-net timer now guarantees an end
 * state regardless of which path stalls.
 *
 * The net is a net, not the normal path: for a while it was the *only* path
 * that ever ran, because the image was created detached and lazy and so never
 * issued its request at all. `tests/list-lazy-thumbnails.test.js` guards that
 * invariant (img in the box before `src`); this file guards the fallback, and
 * that a raster arriving after the net still upgrades the card.
 *
 * Run with: node --test tests/list-thumb-settle.test.js
 */

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(
  '<!doctype html><html><body><div id="app"></div></body></html>',
  {
    url: 'http://localhost/app',
  },
);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = NoopResizeObserver;
window.ResizeObserver = NoopResizeObserver;

/** Controllable IntersectionObserver stub; a test decides if/when it fires. */
function installIOStub() {
  const instances = [];
  class FakeIO {
    constructor(cb) {
      this.cb = cb;
      this.observed = new Set();
      instances.push(this);
    }
    observe(el) {
      this.observed.add(el);
    }
    unobserve(el) {
      this.observed.delete(el);
    }
    disconnect() {
      this.observed.clear();
    }
    fire(els) {
      this.cb(
        els.map((target) => ({ target, isIntersecting: true })),
        this,
      );
    }
  }
  const prev = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = FakeIO;
  window.IntersectionObserver = FakeIO;
  return {
    instances,
    restore() {
      globalThis.IntersectionObserver = prev;
      window.IntersectionObserver = prev;
    },
  };
}

const { createCardRenderer } =
  await import('../client/views/list/presentation-card.js');

// Mirrors THUMB_SETTLE_TIMEOUT_MS in presentation-card.js. Kept as a local
// constant rather than imported: the point of these tests is that *some*
// bounded window exists, and a silent bump of that window should show up here
// as a deliberate edit.
const SETTLE_MS = 5000;

const baseDeck = (overrides = {}) => ({
  id: 'deck-1',
  title: 'Deck one',
  theme: 'default',
  modified: new Date('2020-01-01T00:00:00Z').toISOString(),
  hasSlides: true,
  ...overrides,
});

test('a card whose IntersectionObserver never fires still settles (candidate a)', () => {
  const io = installIOStub();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const detachThumbs = [];
    const { renderCard } = createCardRenderer({
      api: async () => ({}),
      nav: () => {},
      detachThumbs,
    });
    const card = renderCard(baseDeck());
    const thumb = card.querySelector('.thumb');

    // Deliberately never fire intersection — mimics the observer callback not
    // running for a visible card. Before the safety net this hung forever.
    assert.equal(
      thumb.classList.contains('is-loading'),
      true,
      'shimmer while pending',
    );

    mock.timers.tick(SETTLE_MS);

    assert.equal(
      thumb.classList.contains('is-loading'),
      false,
      'skeleton cleared by safety net',
    );
    assert.equal(
      thumb.classList.contains('is-placeholder'),
      true,
      'landed on the placeholder',
    );
    assert.equal(
      thumb.textContent.trim(),
      '',
      'placeholder is a bare field — the title lives on the card, not in it',
    );
  } finally {
    mock.timers.reset();
    io.restore();
  }
});

test('a thumbnail request that fires neither load nor error still settles (candidate b)', () => {
  const io = installIOStub();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const detachThumbs = [];
    const { renderCard } = createCardRenderer({
      api: async () => ({}),
      nav: () => {},
      detachThumbs,
    });
    const card = renderCard(baseDeck());
    const thumb = card.querySelector('.thumb');

    // Load starts (image request issued) but jsdom fires no load/error event —
    // the hung-response case.
    io.instances[0].fire([thumb]);
    assert.ok(
      thumb.querySelector('.thumb-img'),
      'image request was issued from inside the box',
    );
    assert.equal(
      thumb.classList.contains('is-loading'),
      true,
      'still loading before the net fires',
    );

    mock.timers.tick(SETTLE_MS);

    assert.equal(
      thumb.classList.contains('is-loading'),
      false,
      'skeleton cleared',
    );
    assert.equal(
      thumb.classList.contains('is-placeholder'),
      true,
      'landed on the placeholder',
    );
    assert.ok(
      thumb.querySelector('.thumb-img'),
      'the in-flight raster stays in the box, so a late arrival can still win',
    );
  } finally {
    mock.timers.reset();
    io.restore();
  }
});

test('once a card settles, the safety net does not clobber the resolved state', () => {
  const io = installIOStub();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const detachThumbs = [];
    const { renderCard } = createCardRenderer({
      api: async () => ({}),
      nav: () => {},
      detachThumbs,
    });
    const card = renderCard(baseDeck({ hasSlides: false }));
    const thumb = card.querySelector('.thumb');

    io.instances[0].fire([thumb]); // empty deck → showEmpty() settles immediately
    assert.ok(
      thumb.querySelector('.thumb-overlay'),
      'empty-state overlay shown',
    );

    mock.timers.tick(SETTLE_MS); // net fires but must be a no-op now

    assert.ok(thumb.querySelector('.thumb-overlay'), 'empty state preserved');
    assert.equal(
      thumb.classList.contains('is-placeholder'),
      false,
      'not overwritten by placeholder',
    );
  } finally {
    mock.timers.reset();
    io.restore();
  }
});

test('a stuck card upgrades to the real thumbnail if it loads after the net fires', () => {
  const io = installIOStub();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const detachThumbs = [];
    const { renderCard } = createCardRenderer({
      api: async () => ({}),
      nav: () => {},
      detachThumbs,
    });
    const card = renderCard(baseDeck());
    const thumb = card.querySelector('.thumb');

    io.instances[0].fire([thumb]);
    const img = thumb.querySelector('.thumb-img');
    mock.timers.tick(SETTLE_MS); // net → placeholder
    assert.equal(
      thumb.classList.contains('is-placeholder'),
      true,
      'placeholder after net',
    );

    img.onload(); // the real raster finally arrives
    assert.equal(
      thumb.classList.contains('is-placeholder'),
      false,
      'placeholder cleared',
    );
    assert.equal(thumb.classList.contains('is-loading'), false, 'not loading');
    assert.equal(
      thumb.querySelector('.thumb-img'),
      img,
      'real image swapped in',
    );
    assert.equal(
      img.classList.contains('is-pending'),
      false,
      'the raster is revealed once it decodes',
    );
  } finally {
    mock.timers.reset();
    io.restore();
  }
});

test('detachThumbs does not grow per rendered card (bounded cleanup)', () => {
  const io = installIOStub();
  try {
    const detachThumbs = [];
    const { renderCard } = createCardRenderer({
      api: async () => ({}),
      nav: () => {},
      detachThumbs,
    });

    const before = detachThumbs.length;
    for (let i = 0; i < 25; i += 1) renderCard(baseDeck({ id: `deck-${i}` }));

    assert.equal(
      detachThumbs.length,
      before,
      'per-card renders register no new view-level cleanup closures',
    );
  } finally {
    io.restore();
  }
});
