/**
 * B417 — a data-source provider that fails refuses in its own words.
 *
 * `createDataSourceProvider().fetch` used to wrap every failure as
 * `Data source "x" fetch failed: <err.message>` and the data-source routes put
 * that message on the wire: for a non-`AppError` (a network error, the body of
 * an upstream error page, an unreadable body) that is internal text.
 *
 * Now an `AppError` from the provider goes out as it is, status and sentence,
 * and anything else is logged and answered `502 bad_gateway` with one fixed
 * sentence per provider. The provider's own input refusals (missing url, the
 * SSRF guard) are `400`s in their own words. The Notion provider's sentence is
 * pinned in `notion-upstream-error.test.js`.
 *
 * Run with: node --test tests/data-source-provider-refusal.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.LIVE_DATA_ENABLED = 'true';

const { handleDataSources } =
  await import('../server/routes/api/data-sources.js');

// A public IP literal: the SSRF guard passes it without DNS.
const PUBLIC_CSV_URL = 'http://203.0.114.1/data.csv';
const INTERNAL = '/srv/deckyard/server/utils/secret-module.js:42 ECONNRESET';
const REFUSAL = 'Data source "csv-url" could not be fetched';

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

/** Drive the mount handler the way the router does, capturing the log. */
async function call(pathname, body) {
  const payload = JSON.stringify(body);
  const req = {
    method: 'POST',
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload, 'utf8');
    },
  };
  const res = makeRes();
  const lines = [];
  console.error = (...args) => lines.push(args.map(String).join(' '));
  try {
    await handleDataSources({
      repoRoot: process.cwd(),
      req,
      res,
      url: new URL(`http://decks.example.test${pathname}`),
      authedUser: { email: 'olive@example.com', name: 'Olive' },
    });
  } finally {
    console.error = savedConsoleError;
  }
  return { res, log: lines.join('\n') };
}

const preview = (config) =>
  call('/api/data-sources/preview', { provider: 'csv-url', config });

const refresh = (config) =>
  call('/api/data-sources/refresh', {
    dataSource: {
      provider: 'csv-url',
      config,
      bindings: [{ target: 'title', source: 'A1' }],
      refresh: { mode: 'manual' },
    },
    content: { title: 'Old' },
  });

const FAILURES = [
  {
    name: 'fetch throws with a path and a stack',
    fetch: async () => {
      const err = new TypeError(`fetch failed: ${INTERNAL}`);
      err.stack = `TypeError: fetch failed\n    at ${INTERNAL}`;
      throw err;
    },
  },
  {
    name: 'the upstream answers 500 with an internal error page',
    fetch: async () =>
      new Response(`<html><pre>${INTERNAL}</pre></html>`, { status: 500 }),
  },
  {
    name: 'the upstream body cannot be read as CSV text',
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw new TypeError(`Invalid UTF-8 sequence in ${INTERNAL}`);
      },
    }),
  },
];

for (const failure of FAILURES) {
  for (const [route, send] of [
    ['preview', preview],
    ['refresh', refresh],
  ]) {
    test(`${route}: ${failure.name} → one fixed 502, internal text only in the log`, async () => {
      globalThis.fetch = failure.fetch;
      const { res, log } = await send({ url: PUBLIC_CSV_URL });
      assert.equal(res.statusCode, 502);
      assert.equal(res.body.error, 'bad_gateway');
      assert.equal(res.body.message, REFUSAL);
      assert.ok(
        !JSON.stringify(res.body).includes('secret-module'),
        'no internal text on the wire',
      );
      assert.match(log, /secret-module/, 'the cause is in the log');
    });
  }
}

test('a provider input refusal is a 400 in its own words', async () => {
  globalThis.fetch = async () => {
    throw new Error('fetch must not be reached');
  };
  for (const [config, message] of [
    [{}, 'url is required for csv-url provider'],
    [{ url: 'file:///etc/passwd' }, 'CSV URL must use HTTP or HTTPS'],
    [
      { url: 'http://127.0.0.1/x.csv' },
      'URL must not point to internal/private addresses',
    ],
  ]) {
    const { res } = await preview(config);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'bad_request');
    assert.equal(res.body.message, message);
  }
});
