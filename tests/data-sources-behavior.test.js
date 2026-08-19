/**
 * B67 — behavioral tests for the data-sources subsystem
 * (server/utils/data-source/): per-provider happy paths through
 * refreshSlideData/fetchProviderData, the binding engine, and the
 * binding-level SSRF refusal on the csv-url sink.
 *
 * The existing coverage was dispatch-smoke only (routing + 401/405 in
 * c8-routes-batch-2-dispatch, error typing in notion-datasource-app-error);
 * nothing exercised what a refresh actually does to slide content, and the
 * csv-url SSRF guard was only covered at the ssrf-guard unit level — not at
 * the seam where a user-supplied dataSource config reaches it. These tests
 * stub `globalThis.fetch` (all providers fetch through it) and use IP-literal
 * URLs so the SSRF guard classifies addresses without DNS.
 *
 * Reference: docs/reference/data-sources.md.
 *
 * Run with: node --test tests/data-sources-behavior.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  refreshSlideData,
  fetchProviderData,
} from '../server/utils/data-source/index.js';
import { applyBindings } from '../server/utils/data-source/bindings.js';
import { isAppError, ValidationError } from '../server/utils/errors.js';

// A public (non-private-range) IP literal: the SSRF guard validates it
// directly, no DNS lookup, and the stubbed fetch never actually connects.
const PUBLIC_CSV_URL = 'http://203.0.114.1/data.csv';

const CSV_TEXT = ['Metric,Revenue,Note', 'Q1,100,strong', 'Q2,250,record'].join(
  '\n',
);

const originalFetch = globalThis.fetch;
let fetchCalls;

function stubFetch(responder) {
  fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    return responder(String(url), options);
  };
}

function fakeResponse(body, { status = 200, contentType = 'text/plain' } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k) =>
        String(k).toLowerCase() === 'content-type' ? contentType : null,
    },
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

function csvDataSource(overrides = {}) {
  return {
    provider: 'csv-url',
    config: { url: PUBLIC_CSV_URL },
    bindings: [{ target: 'title', source: 'A1' }],
    refresh: { mode: 'manual' },
    ...overrides,
  };
}

beforeEach(() => {
  fetchCalls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.NOTION_SECRET;
});

// ─── csv-url provider ──────────────────────────────────────────────────────

describe('csv-url provider', () => {
  it('refresh maps cell references and named columns into slide content', async () => {
    stubFetch(() => fakeResponse(CSV_TEXT, { contentType: 'text/csv' }));

    const result = await refreshSlideData(
      csvDataSource({
        bindings: [
          { target: 'metrics[0].label', source: 'A2' }, // Excel-style, 1-indexed rows
          { target: 'metrics[0].value', source: 'B2' },
          { target: 'metrics[1].value', source: 'row[1].Revenue' }, // named column, 0-indexed data rows
          { target: 'title', source: 'A1' },
        ],
      }),
      { title: 'stale', metrics: [{ label: 'old', value: '0' }] },
    );

    assert.equal(result.applied, 4);
    assert.deepEqual(result.errors, []);
    assert.equal(result.content.title, 'Metric');
    assert.equal(result.content.metrics[0].label, 'Q1');
    assert.equal(result.content.metrics[0].value, '100');
    assert.equal(result.content.metrics[1].value, '250');
    assert.ok(
      !Number.isNaN(Date.parse(result.lastSync)),
      'lastSync is a timestamp',
    );

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, PUBLIC_CSV_URL);
    assert.equal(
      fetchCalls[0].options.redirect,
      'error',
      'redirects must not be followed (SSRF)',
    );
  });

  it('refresh does not mutate the current content object', async () => {
    stubFetch(() => fakeResponse(CSV_TEXT, { contentType: 'text/csv' }));
    const current = { title: 'stale' };
    const result = await refreshSlideData(
      csvDataSource({ bindings: [{ target: 'title', source: 'A1' }] }),
      current,
    );
    assert.equal(current.title, 'stale', 'input untouched');
    assert.equal(result.content.title, 'Metric');
  });

  it('an unmapped source key surfaces as a binding error, not a throw', async () => {
    stubFetch(() => fakeResponse(CSV_TEXT, { contentType: 'text/csv' }));
    const result = await refreshSlideData(
      csvDataSource({
        bindings: [
          { target: 'title', source: 'A1' },
          { target: 'body', source: 'row[9].DoesNotExist' }, // resolves to ''
          { target: 'note', source: 'nonsense-key' }, // matches no format at all
        ],
      }),
      {},
    );
    assert.equal(result.content.title, 'Metric');
    assert.equal(
      result.content.body,
      '',
      'out-of-range named column maps to empty string',
    );
    assert.equal(result.applied, 2);
    assert.deepEqual(result.errors, [
      'Source "nonsense-key" not found in fetched data',
    ]);
  });

  it('forwards custom headers but strips credential-bearing ones', async () => {
    stubFetch(() => fakeResponse(CSV_TEXT, { contentType: 'text/csv' }));
    await refreshSlideData(
      csvDataSource({
        config: {
          url: PUBLIC_CSV_URL,
          headers: {
            'X-Api-Key': 'ok-to-send',
            Authorization: 'Bearer secret',
            Cookie: 'session=stolen',
            Host: 'internal',
          },
        },
      }),
      {},
    );
    const sent = fetchCalls[0].options.headers;
    assert.equal(sent['X-Api-Key'], 'ok-to-send');
    assert.equal(sent.Authorization, undefined, 'Authorization is blocked');
    assert.equal(sent.Cookie, undefined, 'Cookie is blocked');
    assert.equal(sent.Host, undefined, 'Host is blocked');
  });

  it('preview (fetchProviderData) returns the raw parsed grid', async () => {
    stubFetch(() => fakeResponse(CSV_TEXT, { contentType: 'text/csv' }));
    const grid = await fetchProviderData('csv-url', { url: PUBLIC_CSV_URL });
    assert.deepEqual(grid, [
      ['Metric', 'Revenue', 'Note'],
      ['Q1', '100', 'strong'],
      ['Q2', '250', 'record'],
    ]);
  });
});

// ─── csv-url SSRF refusal at the binding seam ──────────────────────────────

describe('csv-url SSRF guard (binding level)', () => {
  // The url in a dataSource config is user-controlled and the fetched body
  // comes back to the caller — a read-SSRF sink. The refusal must happen on
  // the full refresh path (user payload → provider → guard), and the network
  // must never be touched.
  const refusals = [
    ['loopback', 'http://127.0.0.1/x.csv', /internal\/private/],
    ['private range', 'http://10.0.0.5/x.csv', /internal\/private/],
    [
      'cloud metadata',
      'http://169.254.169.254/latest/meta-data',
      /internal\/private/,
    ],
    ['IPv6 loopback', 'http://[::1]/x.csv', /internal\/private/],
    ['non-http scheme', 'file:///etc/passwd', /must use HTTP or HTTPS/],
    ['garbage', 'not a url at all', /Invalid CSV URL/],
  ];

  for (const [label, url, message] of refusals) {
    it(`refuses ${label} (${url})`, async () => {
      stubFetch(() => {
        throw new Error('fetch must not be reached');
      });
      await assert.rejects(
        () => refreshSlideData(csvDataSource({ config: { url } }), {}),
        (err) => {
          // provider-base wraps fetch-stage failures as a 502 AppError and
          // keeps the guard's message.
          assert.ok(isAppError(err), 'typed AppError');
          assert.equal(err.statusCode, 502);
          assert.match(err.message, message);
          return true;
        },
      );
      assert.equal(fetchCalls.length, 0, 'no network request was made');
    });
  }
});

// ─── notion providers ──────────────────────────────────────────────────────

describe('notion-database provider', () => {
  it('refresh maps row[N].Property sources onto slide content', async () => {
    process.env.NOTION_SECRET = 'secret_test_token';
    stubFetch(() =>
      fakeResponse(
        {
          results: [
            {
              id: 'page-1',
              properties: {
                Name: { type: 'title', title: [{ plain_text: 'Q1 revenue' }] },
                Revenue: { type: 'number', number: 1250 },
                Status: { type: 'select', select: { name: 'Final' } },
              },
            },
          ],
        },
        { contentType: 'application/json' },
      ),
    );

    const result = await refreshSlideData(
      {
        provider: 'notion-database',
        config: { databaseId: 'db-123' },
        bindings: [
          { target: 'metrics[0].label', source: 'row[0].Name' },
          { target: 'metrics[0].value', source: 'row[0].Revenue' },
          { target: 'metrics[0].note', source: 'row[0].Status' },
          { target: 'metrics[1].value', source: 'row[9].Revenue' }, // no such row
        ],
        refresh: { mode: 'manual' },
      },
      {},
    );

    assert.equal(result.content.metrics[0].label, 'Q1 revenue');
    assert.equal(
      result.content.metrics[0].value,
      '1250',
      'numbers arrive as strings',
    );
    assert.equal(result.content.metrics[0].note, 'Final');
    assert.equal(result.applied, 3);
    assert.deepEqual(result.errors, [
      'Source "row[9].Revenue" not found in fetched data',
    ]);

    assert.equal(fetchCalls.length, 1);
    assert.match(
      fetchCalls[0].url,
      /^https:\/\/api\.notion\.com\/v1\/databases\/db-123\/query$/,
    );
    assert.equal(fetchCalls[0].options.method, 'POST');
  });

  it('an unconfigured Notion refuses with the typed 501 before any fetch', async () => {
    delete process.env.NOTION_SECRET;
    stubFetch(() => {
      throw new Error('fetch must not be reached');
    });
    await assert.rejects(
      () =>
        refreshSlideData(
          {
            provider: 'notion-database',
            config: { databaseId: 'db-123' },
            bindings: [{ target: 'title', source: 'row[0].Name' }],
            refresh: { mode: 'manual' },
          },
          {},
        ),
      (err) => isAppError(err) && err.statusCode === 501,
    );
    assert.equal(fetchCalls.length, 0);
  });
});

describe('notion-block provider', () => {
  it('refresh maps block[N] text and type onto slide content', async () => {
    process.env.NOTION_SECRET = 'secret_test_token';
    stubFetch(() =>
      fakeResponse(
        {
          results: [
            {
              id: 'b1',
              type: 'heading_1',
              heading_1: { rich_text: [{ plain_text: 'The plan' }] },
            },
            {
              id: 'b2',
              type: 'paragraph',
              paragraph: { rich_text: [{ plain_text: 'Ship it.' }] },
            },
            { id: 'b3', type: 'divider', divider: {} }, // no text → skipped
          ],
          has_more: false,
        },
        { contentType: 'application/json' },
      ),
    );

    const result = await refreshSlideData(
      {
        provider: 'notion-block',
        config: { pageId: 'page-9' },
        bindings: [
          { target: 'title', source: 'block[0]' }, // bare form defaults to .text
          { target: 'body', source: 'block[1].text' },
          { target: 'note', source: 'block[1].type' },
        ],
        refresh: { mode: 'manual' },
      },
      {},
    );

    assert.equal(result.content.title, 'The plan');
    assert.equal(result.content.body, 'Ship it.');
    assert.equal(result.content.note, 'paragraph');
    assert.equal(result.applied, 3);
    assert.deepEqual(result.errors, []);
    assert.match(fetchCalls[0].url, /\/v1\/blocks\/page-9\/children/);
  });
});

// ─── dispatcher semantics ──────────────────────────────────────────────────

describe('refreshSlideData dispatcher', () => {
  it('frozen mode returns current content untouched and never fetches', async () => {
    stubFetch(() => {
      throw new Error('fetch must not be reached');
    });
    const current = { title: 'as-is' };
    const result = await refreshSlideData(
      csvDataSource({
        refresh: { mode: 'frozen' },
        lastSync: '2026-01-01T00:00:00.000Z',
      }),
      current,
    );
    assert.equal(result.content, current, 'same reference, no clone/refetch');
    assert.equal(result.applied, 0);
    assert.deepEqual(result.errors, []);
    assert.equal(result.lastSync, '2026-01-01T00:00:00.000Z');
    assert.equal(fetchCalls.length, 0);
  });

  it('an invalid dataSource is a 400 ValidationError', async () => {
    await assert.rejects(
      () =>
        refreshSlideData(
          {
            provider: 'csv-url',
            config: {},
            bindings: [],
            refresh: { mode: 'sometimes' },
          },
          {},
        ),
      (err) => err instanceof ValidationError && err.statusCode === 400,
    );
  });

  it("the retired 'on-view' mode is invalid, not silently tolerated", async () => {
    // Removed 2026-08-16 (B70): it never triggered a refresh. Stored legacy
    // values fold to 'manual' at the slide write seam (normalizeSlides);
    // the refresh payload contract knows only 'frozen' and 'manual'.
    stubFetch(() => {
      throw new Error('fetch must not be reached');
    });
    await assert.rejects(
      () =>
        refreshSlideData(csvDataSource({ refresh: { mode: 'on-view' } }), {}),
      (err) =>
        err instanceof ValidationError &&
        /Invalid refresh mode/.test(err.message),
    );
    assert.equal(fetchCalls.length, 0);
  });

  it('an unknown provider on the preview path is a 400 ValidationError', async () => {
    await assert.rejects(
      () => fetchProviderData('no-such-provider', {}),
      (err) =>
        err instanceof ValidationError &&
        /Unknown data source provider/.test(err.message),
    );
  });
});

// ─── binding engine ────────────────────────────────────────────────────────

describe('applyBindings', () => {
  it('creates intermediate objects and arrays for deep targets', () => {
    const { content, applied, errors } = applyBindings(
      {},
      [
        { target: 'metrics[1].value', source: 'v' },
        { target: 'nested.deep.title', source: 't' },
      ],
      { v: '42', t: 'hello' },
    );
    assert.deepEqual(content.metrics[1], { value: '42' });
    assert.equal(content.nested.deep.title, 'hello');
    assert.equal(applied, 2);
    assert.deepEqual(errors, []);
  });

  it('reports missing sources without dropping the rest', () => {
    const { content, applied, errors } = applyBindings(
      { title: 'old' },
      [
        { target: 'title', source: 'present' },
        { target: 'body', source: 'absent' },
      ],
      { present: 'new' },
    );
    assert.equal(content.title, 'new');
    assert.equal(content.body, undefined);
    assert.equal(applied, 1);
    assert.deepEqual(errors, ['Source "absent" not found in fetched data']);
  });
});
