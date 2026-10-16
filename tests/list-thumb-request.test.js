/**
 * Deck-grid thumbnail: the card asks, waits when the server says so, and
 * shows what comes back (B283, docs/reference/deck-thumbnails.md).
 *
 * The card used to set the raster as an `<img src>` and could not read the
 * 404 behind an `error` event, so "still rendering" and "will never render"
 * looked the same and the card guessed: one retry after 2.5 s, a safety net
 * after 5 s, a settle flag and a retry that survived the settle. The route now
 * answers `thumbnail_pending` with a `Retry-After` or `thumbnail_unavailable`,
 * and these tests pin that the card follows the answer instead of a clock.
 *
 * Run with: node --test tests/list-thumb-request.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(
  '<!doctype html><html><body><div id="app"></div></body></html>',
  { url: 'http://localhost/app' },
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

/** Controllable IntersectionObserver stub; a test decides when it fires. */
function installIOStub() {
  const instances = [];
  class FakeIO {
    constructor(cb) {
      this.cb = cb;
      instances.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
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

const { requestDeckThumbnail, THUMB_PENDING_RETRIES } =
  await import('../client/views/list/thumbnail-request.js');
const { createCardRenderer } =
  await import('../client/views/list/presentation-card.js');

const RASTER = new Uint8Array([0x52, 0x49, 0x46, 0x46]);

const raster = () =>
  new Response(RASTER, {
    status: 200,
    headers: { 'Content-Type': 'image/webp' },
  });
const pending = (retryAfter = '3') =>
  new Response(JSON.stringify({ ok: false, error: 'thumbnail_pending' }), {
    status: 404,
    headers: retryAfter ? { 'Retry-After': retryAfter } : {},
  });
const unavailable = () =>
  new Response(
    JSON.stringify({
      ok: false,
      error: 'thumbnail_unavailable',
      message: 'The browser that renders thumbnails did not start or crashed.',
    }),
    { status: 404 },
  );

/** A fetch that answers from a script and records what it was asked. */
function scriptedFetch(...answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  };
  return { fetchImpl, calls };
}

/** A wait that returns at once and records how long it was asked to wait. */
function recordedWait() {
  const waits = [];
  return { waits, wait: async (ms) => (waits.push(ms), true) };
}

// ── The request: one rule per answer ────────────────────────────────────────

test('a raster is fetched once from the bare endpoint', async () => {
  const { fetchImpl, calls } = scriptedFetch(raster);
  const result = await requestDeckThumbnail('deck-1', { fetchImpl });
  assert.ok(result.blob, 'the raster comes back as a blob');
  assert.equal(result.blob.size, RASTER.length);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    '/api/presentations/deck-1/thumbnail',
    'no cache buster: the endpoint is content-addressed (ETag + no-cache)',
  );
  assert.equal(calls[0].init.credentials, 'same-origin');
});

test('pending waits as long as Retry-After says, then shows the raster', async () => {
  const { fetchImpl, calls } = scriptedFetch(pending('3'), raster);
  const { wait, waits } = recordedWait();
  const result = await requestDeckThumbnail('deck-1', { fetchImpl, wait });
  assert.ok(result.blob);
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [3000]);
});

test('pending is asked again at most twice, then the placeholder', async () => {
  const { fetchImpl, calls } = scriptedFetch(pending, pending, pending, raster);
  const { wait } = recordedWait();
  const result = await requestDeckThumbnail('deck-1', { fetchImpl, wait });
  assert.deepEqual(result, { placeholder: true });
  assert.equal(THUMB_PENDING_RETRIES, 2);
  assert.equal(calls.length, 1 + THUMB_PENDING_RETRIES);
});

test('a missing or absurd Retry-After is bounded', async () => {
  const { fetchImpl } = scriptedFetch(pending(''), pending('3600'), raster);
  const { wait, waits } = recordedWait();
  await requestDeckThumbnail('deck-1', { fetchImpl, wait });
  assert.deepEqual(waits, [3000, 10000]);
});

test('unavailable is the placeholder at once, without waiting', async () => {
  const { fetchImpl, calls } = scriptedFetch(unavailable, raster);
  const { wait, waits } = recordedWait();
  const result = await requestDeckThumbnail('deck-1', { fetchImpl, wait });
  assert.deepEqual(result, { placeholder: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, []);
});

test('any other failure is the placeholder; an abort is nothing at all', async () => {
  const offline = scriptedFetch(new TypeError('Failed to fetch'));
  assert.deepEqual(
    await requestDeckThumbnail('deck-1', { fetchImpl: offline.fetchImpl }),
    { placeholder: true },
  );
  const forbidden = scriptedFetch(
    () => new Response('{"ok":false,"error":"forbidden"}', { status: 403 }),
  );
  assert.deepEqual(
    await requestDeckThumbnail('deck-1', { fetchImpl: forbidden.fetchImpl }),
    { placeholder: true },
  );

  const controller = new AbortController();
  const waiting = requestDeckThumbnail('deck-1', {
    fetchImpl: scriptedFetch(pending).fetchImpl,
    signal: controller.signal,
  });
  controller.abort();
  assert.equal(await waiting, null, 'an unmounted list paints nothing');
});

// ── The card: shows what the request says ──────────────────────────────────

const baseDeck = (overrides = {}) => ({
  id: 'deck-1',
  title: 'Deck one',
  theme: 'default',
  modified: new Date('2020-01-01T00:00:00Z').toISOString(),
  hasSlides: true,
  thumbBg: 'rgb(10, 20, 30)',
  ...overrides,
});

/** Stub fetch and blob URLs for one card test; returns the restore. */
function stubNetwork(...answers) {
  const prevFetch = globalThis.fetch;
  const prevCreate = URL.createObjectURL;
  const prevRevoke = URL.revokeObjectURL;
  const revoked = [];
  globalThis.fetch = scriptedFetch(...answers).fetchImpl;
  URL.createObjectURL = () => 'blob:thumb-1';
  URL.revokeObjectURL = (url) => revoked.push(url);
  return {
    revoked,
    restore() {
      globalThis.fetch = prevFetch;
      URL.createObjectURL = prevCreate;
      URL.revokeObjectURL = prevRevoke;
    },
  };
}

/** Let the card's fetch chain run to its next await point. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function renderInView(deck, detachThumbs = []) {
  const { renderCard } = createCardRenderer({
    api: async () => ({}),
    nav: () => {},
    detachThumbs,
  });
  const card = renderCard(deck);
  const thumb = card.querySelector('.thumb');
  return { card, thumb, detachThumbs };
}

test('a fetched raster replaces the skeleton once it decodes', async () => {
  const io = installIOStub();
  const net = stubNetwork(raster);
  try {
    const { thumb } = renderInView(baseDeck());
    io.instances.at(-1).fire([thumb]);
    await flush();
    assert.equal(
      thumb.classList.contains('is-loading'),
      true,
      'shimmer until the image decodes',
    );
    assert.equal(
      thumb.querySelector('.thumb-img'),
      null,
      'not shown half-done',
    );
  } finally {
    net.restore();
    io.restore();
  }
});

test('the raster lands: skeleton gone, image in the box, blob URL released', async () => {
  const io = installIOStub();
  const net = stubNetwork(raster);
  const created = [];
  const orig = document.createElement.bind(document);
  document.createElement = (tag, ...rest) => {
    const el = orig(tag, ...rest);
    if (String(tag).toLowerCase() === 'img') created.push(el);
    return el;
  };
  try {
    const { thumb } = renderInView(baseDeck());
    io.instances.at(-1).fire([thumb]);
    await flush();
    const img = created.at(-1);
    assert.ok(img, 'an image was made for the raster');
    assert.equal(img.getAttribute('src'), 'blob:thumb-1');
    img.onload();
    assert.equal(thumb.classList.contains('is-loading'), false);
    assert.equal(thumb.classList.contains('is-placeholder'), false);
    assert.equal(thumb.querySelector('.thumb-img'), img);
    assert.deepEqual(net.revoked, ['blob:thumb-1']);
  } finally {
    document.createElement = orig;
    net.restore();
    io.restore();
  }
});

test('unavailable settles the card on its theme-colored placeholder', async () => {
  const io = installIOStub();
  const net = stubNetwork(unavailable);
  try {
    const { thumb } = renderInView(baseDeck());
    io.instances.at(-1).fire([thumb]);
    await flush();
    await flush();
    assert.equal(thumb.classList.contains('is-loading'), false);
    assert.equal(thumb.classList.contains('is-placeholder'), true);
    assert.equal(thumb.style.background, 'rgb(10, 20, 30)');
    assert.equal(thumb.querySelector('.thumb-img'), null);
  } finally {
    net.restore();
    io.restore();
  }
});

test('unmounting the list aborts a card that is still waiting', async () => {
  const io = installIOStub();
  const net = stubNetwork(pending, raster);
  try {
    const { thumb, detachThumbs } = renderInView(baseDeck());
    io.instances.at(-1).fire([thumb]);
    await flush();
    for (const detach of detachThumbs) detach();
    await flush();
    assert.equal(
      thumb.classList.contains('is-placeholder'),
      false,
      'a gone list is not painted',
    );
    assert.equal(thumb.querySelector('.thumb-img'), null);
  } finally {
    net.restore();
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
