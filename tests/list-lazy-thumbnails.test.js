/**
 * Deck-list front-page performance, phase 1: lazy thumbnails + skeletons.
 *
 * - createInViewLoader defers a callback until its element intersects, runs it
 *   exactly once, unobserves it, and cleans up on disconnect. With no
 *   IntersectionObserver it degrades to running callbacks immediately.
 * - renderCard shows a skeleton (.thumb.is-loading), registers the thumb with
 *   the loader, and does NOT fetch /api/presentations/:id per card (the list
 *   route ships a hasSlides flag). The thumbnail image loads only once the card
 *   scrolls into view; empty decks show "No slides yet" instead.
 *
 * Run with: node --test tests/list-lazy-thumbnails.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/app',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;

// jsdom ships neither ResizeObserver (used by attachThumbScale) nor
// IntersectionObserver; provide a no-op RO so card rendering doesn't throw.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = NoopResizeObserver;
window.ResizeObserver = NoopResizeObserver;

/**
 * Minimal controllable IntersectionObserver stub. Captures observed elements
 * and lets a test fire intersection manually.
 */
function installIOStub() {
  const observed = new Set();
  const instances = [];
  let disconnected = 0;

  class FakeIO {
    constructor(cb, opts) {
      this.cb = cb;
      this.opts = opts;
      instances.push(this);
    }
    observe(el) {
      observed.add(el);
    }
    unobserve(el) {
      observed.delete(el);
    }
    disconnect() {
      disconnected += 1;
      observed.clear();
    }
    /** Fire an intersection for the given elements (isIntersecting: true). */
    fire(els) {
      const entries = els.map((target) => ({ target, isIntersecting: true }));
      this.cb(entries, this);
    }
  }

  const prev = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = FakeIO;
  window.IntersectionObserver = FakeIO;

  return {
    observed,
    instances,
    get disconnected() {
      return disconnected;
    },
    restore() {
      globalThis.IntersectionObserver = prev;
      window.IntersectionObserver = prev;
    },
  };
}

const { createInViewLoader } = await import('../client/lib/dom/in-view.js');

test('createInViewLoader runs the callback once on intersection, then unobserves', () => {
  const io = installIOStub();
  try {
    const loader = createInViewLoader({ rootMargin: '10px' });
    assert.equal(loader.supported, true, 'reports supported when IO exists');

    const el = document.createElement('div');
    let calls = 0;
    loader.observe(el, () => {
      calls += 1;
    });

    assert.equal(io.observed.has(el), true, 'element is observed before it is seen');
    assert.equal(calls, 0, 'callback does not run before intersection');

    const inst = io.instances[0];
    inst.fire([el]);
    assert.equal(calls, 1, 'callback runs on first intersection');
    assert.equal(io.observed.has(el), false, 'element is unobserved after firing');

    // A second intersection for the same element must not re-run the callback.
    inst.fire([el]);
    assert.equal(calls, 1, 'callback runs at most once');

    loader.disconnect();
    assert.equal(io.disconnected, 1, 'disconnect releases the observer');
  } finally {
    io.restore();
  }
});

test('createInViewLoader runs immediately when IntersectionObserver is unavailable', () => {
  const prev = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = undefined;
  window.IntersectionObserver = undefined;
  try {
    const loader = createInViewLoader();
    assert.equal(loader.supported, false, 'reports unsupported');
    let calls = 0;
    loader.observe(document.createElement('div'), () => {
      calls += 1;
    });
    assert.equal(calls, 1, 'callback runs eagerly without IO support');
  } finally {
    globalThis.IntersectionObserver = prev;
    window.IntersectionObserver = prev;
  }
});

const { createCardRenderer } = await import('../client/views/list/presentation-card.js');

test('renderCard shows a skeleton, defers rendering, and does not fetch per card', () => {
  const io = installIOStub();
  try {
    let apiCalls = 0;
    const api = async (...args) => {
      apiCalls += 1;
      return {};
    };
    const detachThumbs = [];

    const { renderCard } = createCardRenderer({
      api,
      nav: () => {},
      detachThumbs,
    });

    const card = renderCard({
      id: 'deck-1',
      title: 'Deck one',
      theme: 'default',
      modified: new Date().toISOString(),
      hasSlides: true,
    });

    const thumb = card.querySelector('.thumb');
    assert.ok(thumb, 'thumb element exists');
    assert.equal(thumb.classList.contains('is-loading'), true, 'skeleton shown before in-view');
    assert.equal(io.observed.has(thumb), true, 'thumb is registered with the in-view loader');
    assert.equal(
      thumb.querySelector('.slide'),
      null,
      'no live slide rendered before the card scrolls into view'
    );
    assert.equal(
      thumb.querySelector('.thumb-img'),
      null,
      'no thumbnail image requested before the card scrolls into view'
    );
    assert.equal(apiCalls, 0, 'no per-card /api/presentations fetch');

    // The shared loader disconnect is collected for cleanup.
    assert.ok(
      detachThumbs.some((fn) => typeof fn === 'function'),
      'a cleanup function is registered'
    );
  } finally {
    io.restore();
  }
});

test('renderCard shows "No slides yet" for an empty deck once in view', () => {
  const io = installIOStub();
  try {
    const detachThumbs = [];
    const { renderCard } = createCardRenderer({
      api: async () => ({}),
      nav: () => {},
      detachThumbs,
    });

    const card = renderCard({
      id: 'deck-empty',
      title: 'Empty deck',
      theme: 'default',
      modified: new Date().toISOString(),
      hasSlides: false,
    });

    const thumb = card.querySelector('.thumb');
    io.instances[0].fire([thumb]);

    assert.equal(thumb.classList.contains('is-loading'), false, 'skeleton cleared');
    assert.ok(thumb.querySelector('.thumb-overlay'), 'renders the empty-state overlay');
    assert.equal(thumb.querySelector('.thumb-img'), null, 'no image requested for an empty deck');
  } finally {
    io.restore();
  }
});
