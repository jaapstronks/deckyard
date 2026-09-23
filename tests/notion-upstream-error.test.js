/**
 * B416 — the Notion seam refuses in our own words.
 *
 * `notionFetchJson` used to put Notion's `message` (or the raw text body, an
 * HTML error page included) into the error and forward Notion's status, and
 * `handleNotionError` then branched on that text (`'Could not find'`,
 * `'unauthorized'`) and let every other status through with Notion's sentence.
 *
 * The seam now decides the meaning by status alone: 404/401/403 is the
 * "share the page with your integration" hint as a 400, every other failure —
 * a 400, a 429, a 503 HTML page, no answer at all — is `502 bad_gateway` with
 * one sentence. Notion's payload goes to `logError` only, and that is pinned
 * too, for the Notion routes and for the Notion data-source provider.
 *
 * Run with: node --test tests/notion-upstream-error.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NOTION_SECRET = 'secret_test';
process.env.LIVE_DATA_ENABLED = 'true';

const { handleNotion } = await import('../server/routes/api/notion/index.js');
const { handleDataSources } =
  await import('../server/routes/api/data-sources.js');

const PAGE_ID = '0123456789abcdef0123456789abcdef';
const NOTION_WORDS = 'Could not find page with ID 0123-leaked';

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

/** Drive a mount handler the way the router does. */
async function call(handler, pathname, body) {
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
  await handler({
    repoRoot: process.cwd(),
    req,
    res,
    url: new URL(`http://decks.example.test${pathname}`),
    authedUser: { email: 'olive@example.com', name: 'Olive' },
  });
  return res;
}

/** Answer every Notion call with `status` and `body` (JSON unless a string). */
function notionAnswers(status, body) {
  globalThis.fetch = async () =>
    typeof body === 'string'
      ? new Response(body, {
          status,
          headers: { 'content-type': 'text/html' },
        })
      : Response.json(body, { status });
}

/** Capture what the seam logs while `fn` runs. */
async function logged(fn) {
  const lines = [];
  console.error = (...args) => lines.push(args);
  try {
    const res = await fn();
    return { res, log: JSON.stringify(lines) };
  } finally {
    console.error = savedConsoleError;
  }
}

const fetchPage = () =>
  call(handleNotion, '/api/notion/fetch', { url: PAGE_ID });

const UPSTREAM = [
  {
    name: '400',
    status: 400,
    body: { object: 'error', code: 'validation_error', message: NOTION_WORDS },
  },
  {
    name: '429',
    status: 429,
    body: { object: 'error', code: 'rate_limited', message: NOTION_WORDS },
  },
  {
    name: '503 with an HTML body',
    status: 503,
    body: `<html><body><h1>${NOTION_WORDS}</h1></body></html>`,
  },
];

for (const { name, status, body } of UPSTREAM) {
  test(`a Notion ${name} is 502 bad_gateway in our own words`, async () => {
    notionAnswers(status, body);
    const { res, log } = await logged(fetchPage);
    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, {
      ok: false,
      error: 'bad_gateway',
      message: 'Notion could not complete this request',
    });
    assert.ok(log.includes(NOTION_WORDS), 'the payload is logged');
    assert.ok(log.includes(String(status)), 'the upstream status is logged');
  });
}

test('an unreachable Notion is 502 bad_gateway in our own words', async () => {
  globalThis.fetch = async () => {
    throw new TypeError(`fetch failed: ${NOTION_WORDS}`);
  };
  const { res, log } = await logged(fetchPage);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'bad_gateway');
  assert.equal(res.body.message, 'Notion could not complete this request');
  assert.ok(log.includes('did not reach Notion'));
});

for (const status of [404, 401, 403]) {
  test(`a Notion ${status} is the share-with-your-integration hint, decided by status`, async () => {
    // Notion's wording is deliberately unlike 'Could not find'/'unauthorized':
    // the status alone decides.
    notionAnswers(status, {
      object: 'error',
      code: 'x',
      message: 'something else',
    });
    const { res, log } = await logged(fetchPage);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'bad_request');
    assert.match(
      res.body.message,
      /^(Notion page not found|Access denied)\. Make sure the page is shared with your Notion integration\.$/,
    );
    assert.ok(log.includes('something else'), 'the payload is logged');
  });
}

test('Notion wording no longer decides the meaning of another status', async () => {
  notionAnswers(400, {
    object: 'error',
    code: 'validation_error',
    message: 'Could not find property unauthorized',
  });
  const { res } = await logged(fetchPage);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'bad_gateway');
});

test('the Notion data-source provider carries the same sentence, not Notion text', async () => {
  notionAnswers(503, `<html>${NOTION_WORDS}</html>`);
  const { res } = await logged(() =>
    call(handleDataSources, '/api/data-sources/preview', {
      provider: 'notion-database',
      config: { databaseId: PAGE_ID },
    }),
  );
  assert.equal(res.statusCode, 502);
  assert.ok(!JSON.stringify(res.body).includes(NOTION_WORDS));
  assert.match(res.body.message, /Notion could not complete this request/);
});
