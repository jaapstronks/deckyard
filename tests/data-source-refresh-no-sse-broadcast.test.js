/**
 * B69 — a data-source refresh must not write to any deck's SSE stream.
 *
 * The old behaviour trusted the request body: `POST /api/data-sources/refresh`
 * with `{presentationId, slideId}` broadcast `datasource:refreshed` onto that
 * presentation's event stream, so any authenticated user could emit events
 * onto any deck's stream — the route has no presentation context and never
 * checked deck authorization. Nothing listens to the event, so the broadcast
 * was dropped entirely (beta stance: no unauthorized side-channel kept alive
 * for a listener that doesn't exist). When a listener ships, the broadcast
 * comes back presentation-scoped and authz-checked.
 *
 * This test pins the fix at the route seam: a refresh that names a deck the
 * caller is not authorized on (here: any deck with a connected SSE client)
 * succeeds as a refresh but writes nothing to that deck's stream.
 *
 * Run with: node --test tests/data-source-refresh-no-sse-broadcast.test.js
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { handleDataSources } from '../server/routes/api/data-sources.js';
import { addClient, removeClient } from '../server/services/comment-events.js';

const FOREIGN_DECK_ID = 'deck-the-caller-cannot-read';

// A public (non-private-range) IP literal: the SSRF guard validates it
// directly, no DNS lookup, and the stubbed fetch never actually connects.
const PUBLIC_CSV_URL = 'http://203.0.114.1/data.csv';
const CSV_TEXT = 'Metric,Revenue\nQ1,100\n';

const originalFetch = globalThis.fetch;
const originalFlag = process.env.LIVE_DATA_ENABLED;

before(() => {
  process.env.LIVE_DATA_ENABLED = 'true';
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'text/csv' : null) },
    text: async () => CSV_TEXT,
    json: async () => { throw new Error('not json'); },
  });
});

after(() => {
  globalThis.fetch = originalFetch;
  if (originalFlag === undefined) delete process.env.LIVE_DATA_ENABLED;
  else process.env.LIVE_DATA_ENABLED = originalFlag;
});

/** An SSE client connection double that records every stream write. */
function fakeSseClient() {
  return { writes: [], write(msg) { this.writes.push(String(msg)); } };
}

function mockRes() {
  return {
    statusCode: null,
    body: '',
    headers: {},
    writeHead(code, headers) { this.statusCode = code; Object.assign(this.headers, headers ?? {}); },
    setHeader(k, v) { this.headers[k] = v; },
    end(chunk) { if (chunk) this.body += chunk; },
  };
}

/** A POST /api/data-sources/refresh context whose req streams `body` as JSON. */
function refreshCtx(body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'POST';
  req.headers = {};
  const res = mockRes();
  return {
    res,
    ctx: {
      storageScope: {},
      authedUser: { email: 'not-a-member-of-that-deck@example.test' },
      req,
      res,
      url: { pathname: '/api/data-sources/refresh', searchParams: new URLSearchParams() },
    },
  };
}

test('a refresh naming a foreign presentationId does not write to that deck\'s SSE stream', async () => {
  const foreignClient = fakeSseClient();
  addClient(FOREIGN_DECK_ID, foreignClient);
  try {
    const { ctx, res } = refreshCtx({
      dataSource: {
        provider: 'csv-url',
        config: { url: PUBLIC_CSV_URL },
        bindings: [{ target: 'title', source: 'A1' }],
        refresh: { mode: 'manual' },
      },
      content: { title: 'stale' },
      presentationId: FOREIGN_DECK_ID,
      slideId: 'slide-1',
    });

    const handled = await handleDataSources(ctx);

    // The refresh itself still works for the caller...
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).content.title, 'Metric');

    // ...but nothing reaches the named deck's stream.
    assert.deepEqual(
      foreignClient.writes,
      [],
      'no SSE event may be emitted onto a deck stream the caller merely named in the body'
    );
  } finally {
    removeClient(FOREIGN_DECK_ID, foreignClient);
  }
});
