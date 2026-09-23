/**
 * B419 — a Giphy/Unsplash upstream failure is `502 bad_gateway` in our words.
 *
 * `apiFetch` used to throw a bare `Error` carrying the upstream status and
 * body; `withErrorHandler` in `stock-media.js` answered that as a fixed
 * `500 internal_error`. Nothing leaked, but "the upstream failed" is
 * `502 bad_gateway` with one fixed sentence at every other seam (ImageKit,
 * Notion, data sources): two statuses for one meaning.
 *
 * Now `apiFetch` is the stock-media seam: the upstream status and body (or the
 * network error) go to the log, with the path but never the query string
 * (Giphy's API key rides there), and the caller gets
 * `502 bad_gateway` "<Service> could not complete this request". The route
 * handler is DB-backed (the provider toggles), so the wire is asserted through
 * the same `withErrorHandler` the stock-media mount uses.
 *
 * B420 extends the seam to the success body: an unreadable 200 is the same
 * `502`; B421 does the same for a 200 that parses into the wrong shape. Cases
 * at the bottom.
 *
 * Run with: node --test tests/stock-media-upstream-error.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.GIPHY_API_KEY = 'giphy-secret-key';
process.env.UNSPLASH_ACCESS_KEY = 'unsplash-secret-key';

const { withErrorHandler } = await import('../server/utils/http.js');
const giphy = await import('../server/integrations/giphy.js');
const unsplash = await import('../server/integrations/unsplash.js');

const INTERNAL = '/srv/upstream/internal-module.js:42 quota exhausted';

const savedFetch = globalThis.fetch;
const savedConsoleError = console.error;

test.after(() => {
  globalThis.fetch = savedFetch;
  console.error = savedConsoleError;
});

/** A response double capturing the status/body the http helpers write. */
function makeRes() {
  return {
    statusCode: null,
    body: null,
    headersSent: false,
    writableEnded: false,
    writeHead(status) {
      this.statusCode = status;
      return this;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
      return this;
    },
  };
}

/** Run `call` behind the stock-media error handler, capturing the log. */
async function onTheWire(call) {
  const res = makeRes();
  const lines = [];
  console.error = (...args) =>
    lines.push(args.map((a) => (a?.stack ? a.stack : String(a))).join(' '));
  try {
    await withErrorHandler('stock-media', async () => {
      await call();
      return true;
    })({ res });
  } finally {
    console.error = savedConsoleError;
  }
  return { res, log: lines.join('\n') };
}

const FAILURES = [
  {
    name: 'the upstream answers 500 with its own error body',
    fetch: async () =>
      new Response(`{"message":"${INTERNAL}"}`, { status: 500 }),
  },
  {
    name: 'the upstream answers 401 on our key',
    fetch: async () =>
      new Response(`Unauthorized: ${INTERNAL}`, { status: 401 }),
  },
  {
    name: 'fetch throws before any answer',
    fetch: async () => {
      throw new TypeError(`fetch failed: ${INTERNAL}`);
    },
  },
];

const CALLS = [
  ['Giphy', 'search', () => giphy.searchGiphy({ query: 'cats' })],
  ['Giphy', 'trending', () => giphy.getTrendingGiphy()],
  ['Giphy', 'lookup', () => giphy.getGiphyGif('abc123')],
  [
    'Giphy',
    'download',
    () => giphy.downloadGif('https://media.giphy.com/a.gif'),
  ],
  ['Unsplash', 'search', () => unsplash.searchUnsplash({ query: 'cats' })],
  ['Unsplash', 'lookup', () => unsplash.getUnsplashPhoto('abc123')],
  [
    'Unsplash',
    'download',
    () => unsplash.downloadImage('https://images.unsplash.com/photo-1'),
  ],
];

for (const failure of FAILURES) {
  for (const [service, what, call] of CALLS) {
    test(`${service} ${what}: ${failure.name} → 502 in our words, cause in the log`, async () => {
      globalThis.fetch = failure.fetch;
      const { res, log } = await onTheWire(call);
      assert.equal(res.statusCode, 502);
      assert.deepEqual(res.body, {
        ok: false,
        error: 'bad_gateway',
        message: `${service} could not complete this request`,
      });
      assert.match(log, /internal-module/, 'the cause is in the log');
      assert.doesNotMatch(log, /secret-key/, 'no API key in the log');
    });
  }
}

// B420 — a 200 whose body is not JSON is the same refusal. The seam parses the
// body (`apiFetchJson`), so the callers never see a `SyntaxError` that
// `withErrorHandler` would answer as `500 internal_error`. The downloads read
// bytes, not JSON, and stay out of this case.
const JSON_CALLS = CALLS.filter(([, what]) => what !== 'download');

for (const [service, what, call] of JSON_CALLS) {
  test(`${service} ${what}: a 200 with an unreadable body → 502 in our words, cause in the log`, async () => {
    globalThis.fetch = async () =>
      new Response(`<html>${INTERNAL}</html>`, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    const { res, log } = await onTheWire(call);
    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, {
      ok: false,
      error: 'bad_gateway',
      message: `${service} could not complete this request`,
    });
    assert.match(log, /internal-module/, 'the unreadable body is in the log');
    assert.doesNotMatch(log, /secret-key/, 'no API key in the log');
  });
}

// B421 — a 200 that parses but lacks what the formatter reads is the same
// refusal. Each call declares its shape at the seam (`apiFetchJson`'s
// `isShaped`), so `formatGif`/`formatPhoto` never throw a `TypeError` that
// `withErrorHandler` would answer as `500 internal_error`.
const GIF = {
  id: 'g1',
  images: { original: { url: 'https://media.giphy.com/g1.gif', width: '2' } },
};
const PHOTO = {
  id: 'p1',
  urls: { thumb: 't', small: 's', regular: 'r', full: 'f', raw: 'w' },
  user: { name: 'N', username: 'n', links: { html: 'h' } },
  links: { download_location: 'd', html: 'h' },
};
const PAGINATION = { total_count: 1, offset: 0 };

const SHAPES = {
  'Giphy search': {
    good: { data: [GIF], pagination: PAGINATION },
    wrong: [
      ['not an object', [GIF]],
      ['no data list', { pagination: PAGINATION }],
      ['no pagination', { data: [GIF] }],
      [
        'a GIF without images',
        { data: [{ id: 'g1' }], pagination: PAGINATION },
      ],
    ],
  },
  'Giphy trending': {
    good: { data: [GIF], pagination: PAGINATION },
    wrong: [
      ['null', null],
      ['data is an object', { data: GIF, pagination: PAGINATION }],
    ],
  },
  'Giphy lookup': {
    good: { data: GIF },
    wrong: [
      ['no data', {}],
      ['a GIF without an original', { data: { id: 'g1', images: {} } }],
    ],
  },
  'Unsplash search': {
    good: { results: [PHOTO], total: 1, total_pages: 1 },
    wrong: [
      ['a string', 'ok'],
      ['no results list', { total: 1 }],
      ['a photo without a user', { results: [{ ...PHOTO, user: null }] }],
    ],
  },
  'Unsplash lookup': {
    good: PHOTO,
    wrong: [
      ['an array', [PHOTO]],
      ['a photo without links', { ...PHOTO, links: undefined }],
      [
        'a user without links',
        { ...PHOTO, user: { name: 'N', username: 'n' } },
      ],
    ],
  },
};

for (const [service, what, call] of JSON_CALLS) {
  const { good, wrong } = SHAPES[`${service} ${what}`];

  for (const [shape, body] of wrong) {
    test(`${service} ${what}: a 200 in the wrong shape (${shape}) → 502 in our words, body in the log`, async () => {
      globalThis.fetch = async () =>
        new Response(JSON.stringify(body), { status: 200 });
      const { res, log } = await onTheWire(call);
      assert.equal(res.statusCode, 502);
      assert.deepEqual(res.body, {
        ok: false,
        error: 'bad_gateway',
        message: `${service} could not complete this request`,
      });
      assert.match(log, /unexpected shape/, 'the shape is named in the log');
      assert.doesNotMatch(log, /secret-key/, 'no API key in the log');
    });
  }

  test(`${service} ${what}: a 200 in the expected shape still formats`, async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify(good), { status: 200 });
    const result = await call();
    const item = result.results ? result.results[0] : result;
    assert.equal(item.id, service === 'Giphy' ? 'g1' : 'p1');
  });
}
