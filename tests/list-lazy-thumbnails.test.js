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
 * - Once it does scroll into view, the <img> is in the document *before* its
 *   `src` is assigned, and carries no `loading="lazy"`. A detached lazy image
 *   never starts its fetch in Chromium — no request, no `load`, no `error` —
 *   which is how every card silently fell through to the 8s safety net and the
 *   onerror retry became unreachable code. The deferral is the shared
 *   IntersectionObserver's job, not the attribute's.
 *
 * Run with: node --test tests/list-lazy-thumbnails.test.js
 */

import test from 'node:test';
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

    assert.equal(
      io.observed.has(el),
      true,
      'element is observed before it is seen',
    );
    assert.equal(calls, 0, 'callback does not run before intersection');

    const inst = io.instances[0];
    inst.fire([el]);
    assert.equal(calls, 1, 'callback runs on first intersection');
    assert.equal(
      io.observed.has(el),
      false,
      'element is unobserved after firing',
    );

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

const { createCardRenderer } =
  await import('../client/views/list/presentation-card.js');

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
    assert.equal(
      thumb.classList.contains('is-loading'),
      true,
      'skeleton shown before in-view',
    );
    assert.equal(
      io.observed.has(thumb),
      true,
      'thumb is registered with the in-view loader',
    );
    assert.equal(
      thumb.querySelector('.slide'),
      null,
      'no live slide rendered before the card scrolls into view',
    );
    assert.equal(
      thumb.querySelector('.thumb-img'),
      null,
      'no thumbnail image requested before the card scrolls into view',
    );
    assert.equal(apiCalls, 0, 'no per-card /api/presentations fetch');

    // The shared loader disconnect is collected for cleanup.
    assert.ok(
      detachThumbs.some((fn) => typeof fn === 'function'),
      'a cleanup function is registered',
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

    assert.equal(
      thumb.classList.contains('is-loading'),
      false,
      'skeleton cleared',
    );
    assert.ok(
      thumb.querySelector('.thumb-overlay'),
      'renders the empty-state overlay',
    );
    assert.equal(
      thumb.querySelector('.thumb-img'),
      null,
      'no image requested for an empty deck',
    );
  } finally {
    io.restore();
  }
});

/**
 * Spy on <img> creation, recording for every `src` assignment whether the
 * element was already in the document at that moment. Redefining `src` as an
 * own property is enough: the card assigns it as a property, and jsdom fetches
 * nothing, so the attribute round-trip is a faithful stand-in.
 */
function captureImageSrcAssignments() {
  const created = [];
  const orig = document.createElement.bind(document);
  document.createElement = (tag, ...rest) => {
    const el = orig(tag, ...rest);
    if (String(tag).toLowerCase() === 'img') {
      const assignments = [];
      Object.defineProperty(el, 'src', {
        configurable: true,
        get: () => el.getAttribute('src') || '',
        set: (value) => {
          assignments.push({ value: String(value), connected: el.isConnected });
          el.setAttribute('src', String(value));
        },
      });
      created.push({ el, assignments });
    }
    return el;
  };
  return {
    last: () => created[created.length - 1] || null,
    restore() {
      document.createElement = orig;
    },
  };
}

test('the thumbnail image is in the document before its src is set', () => {
  const io = installIOStub();
  const images = captureImageSrcAssignments();
  try {
    const detachThumbs = [];
    const { renderCard } = createCardRenderer({
      api: async () => ({}),
      nav: () => {},
      detachThumbs,
    });

    const card = renderCard({
      id: 'deck-1',
      title: 'Deck one',
      theme: 'default',
      revision: 7,
      modified: new Date().toISOString(),
      hasSlides: true,
    });
    // Connected for real: in the app the observer only ever fires for cards
    // that are in the document, and `isConnected` is what the browser's own
    // "should I fetch this?" decision hangs on.
    document.body.append(card);

    const thumb = card.querySelector('.thumb');
    io.instances[0].fire([thumb]);

    const img = images.last();
    assert.ok(img, 'an <img> was created for the thumbnail');
    assert.equal(
      img.el.parentElement,
      thumb,
      'the image lives in the thumb box',
    );
    assert.deepEqual(
      img.assignments.map((a) => a.connected),
      [true],
      'src assigned exactly once, with the image already in the document',
    );
    assert.match(
      img.assignments[0].value,
      /^\/api\/presentations\/deck-1\/thumbnail\?v=7$/,
      'requests the revisioned thumbnail endpoint',
    );
    assert.equal(
      img.el.hasAttribute('loading'),
      false,
      'no loading="lazy" — a detached lazy image never issues its request',
    );

    card.remove();
  } finally {
    images.restore();
    io.restore();
  }
});

test('a loaded thumbnail clears the skeleton and reveals the raster', () => {
  const io = installIOStub();
  try {
    const detachThumbs = [];
    const { renderCard } = createCardRenderer({
      api: async () => ({}),
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
    io.instances[0].fire([thumb]);

    const img = thumb.querySelector('.thumb-img');
    assert.ok(img, 'image present while loading');
    assert.equal(
      img.classList.contains('is-pending'),
      true,
      'held invisible until it decodes',
    );
    assert.equal(
      thumb.classList.contains('is-loading'),
      true,
      'shimmer still running',
    );

    img.onload();

    assert.equal(
      thumb.classList.contains('is-loading'),
      false,
      'shimmer cleared on load',
    );
    assert.equal(
      img.classList.contains('is-pending'),
      false,
      'raster revealed',
    );
    assert.equal(thumb.querySelector('.thumb-img'), img, 'raster is the box');
  } finally {
    io.restore();
  }
});
