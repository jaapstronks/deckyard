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

/** Capture <img> elements as they are created (they're only appended on load). */
function captureImages() {
  const imgs = [];
  const orig = document.createElement.bind(document);
  document.createElement = (tag, ...rest) => {
    const el = orig(tag, ...rest);
    if (String(tag).toLowerCase() === 'img') imgs.push(el);
    return el;
  };
  return {
    last: () => imgs[imgs.length - 1] || null,
    restore() {
      document.createElement = orig;
    },
  };
}

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

    mock.timers.tick(8000);

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
    assert.ok(
      thumb.querySelector('.thumb-placeholder-title'),
      'placeholder title rendered',
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
    const images = captureImages();
    const card = renderCard(baseDeck());
    const thumb = card.querySelector('.thumb');

    // Load starts (image request issued) but jsdom fires no load/error event —
    // the hung-response case. The <img> exists but is only appended on load, so
    // we detect the request via the capture spy, not the DOM.
    io.instances[0].fire([thumb]);
    assert.ok(images.last(), 'image request was issued');
    images.restore();
    assert.equal(
      thumb.classList.contains('is-loading'),
      true,
      'still loading before the net fires',
    );

    mock.timers.tick(8000);

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

    mock.timers.tick(8000); // net fires but must be a no-op now

    assert.ok(thumb.querySelector('.thumb-overlay'), 'empty state preserved');
    assert.equal(
      thumb.querySelector('.thumb-placeholder-title'),
      null,
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
    const images = captureImages();
    const card = renderCard(baseDeck());
    const thumb = card.querySelector('.thumb');

    io.instances[0].fire([thumb]);
    const img = images.last();
    images.restore();
    mock.timers.tick(8000); // net → placeholder
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
