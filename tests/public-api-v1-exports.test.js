/**
 * Contract tests for the public API v1 exports module (B40 PR 5+):
 * GET /api/v1/presentations/:id/export/{json,html,pdf,pptx}.
 *
 * The surface these pin, per docs/openapi.yaml: the portable JSON deck export
 * (format sentinel, canonical slide-type ids, attachment headers), the
 * standalone-HTML and print-HTML exports, the `lang` projection with its
 * filename suffix, and the shared gate ladder: `export` permission → daily
 * export limit → deck lookup → access check.
 *
 * The PPTX success path is NOT covered: `buildPptxBuffer` renders every slide
 * to a PNG in a headless browser, which the fake-db recipe deliberately does
 * not start (the browser lives in the export smoke test only) — noted as an
 * explicit opt-out in the B40 brief's Opt-out-log. Its gate ladder is shared
 * with the other three variants and pinned there; the pptx route's permission
 * gate is pinned here.
 *
 * Handler-import level against the database double, like the neighbours
 * (tests/public-api-partial-write.test.js). Negative assertions pin the
 * status code, not the error envelope (B39 deel 3 bevinding 11).
 *
 * Run with: node --test tests/public-api-v1-exports.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.AUTH_SECRET = ['deckyard', 'test', 'auth'].join('-').padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const KEY_OWNER = 'owner@example.com';
const DECK_ID = 'deck-to-export';
const FOREIGN_DECK_ID = 'deck-of-someone-else';
const KEY_ID = 'key-1';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/adapters/index.js');
const { handleExports } = await import('../server/routes/public-api/v1/exports.js');

/**
 * Install a freshly seeded double and point the storage facade at Postgres.
 * @param {Object} [options]
 * @param {number} [options.exportsUsedToday] - Today's spent export budget
 * @returns {Promise<Object>} The database double.
 */
async function installDb({ exportsUsedToday = 0 } = {}) {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    presentations: [
      deckRow({ id: DECK_ID, owner: KEY_OWNER }),
      deckRow({ id: FOREIGN_DECK_ID, owner: 'someone-else@example.com' }),
    ],
    api_usage_daily: exportsUsedToday
      ? [{
          id: 'usage-1',
          api_key_id: KEY_ID,
          date: new Date().toISOString().split('T')[0],
          request_count: exportsUsedToday,
          ai_request_count: 0,
          export_count: exportsUsedToday,
        }]
      : [],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

function deckRow({ id, owner }) {
  return {
    id,
    organization_id: ORG,
    owner_email: owner,
    created_by: owner,
    updated_by: owner,
    title: 'Export Me',
    description: null,
    theme: 'deckyard',
    lang: 'nl',
    visibility: 'private',
    revision: 1,
    settings: {},
    i18n: {
      active: 'nl',
      dominant: 'nl',
      versions: {
        nl: {
          title: 'Export Me',
          slides: [
            { id: 'slide-1', type: 'title-slide', content: { title: 'Hallo' }, parentId: null },
          ],
        },
        'en-GB': {
          title: 'Export Me (EN)',
          slides: [
            { id: 'slide-1', type: 'title-slide', content: { title: 'Hello' }, parentId: null },
          ],
        },
      },
    },
    slides: [
      { id: 'slide-1', type: 'title-slide', content: { title: 'Hallo' }, parentId: null },
    ],
    published: null,
    created_at: '2026-07-01T00:00:00.000Z',
    modified_at: '2026-07-01T00:00:00.000Z',
    trashed_at: null,
  };
}

/**
 * Request context for the exports handler, with the key already authenticated
 * (authenticateApiKey is a different seam with its own tests). Exports answer
 * raw payloads, so `res.body` keeps the raw string/buffer.
 * @param {string} method - HTTP method
 * @param {string} pathname - Request path
 * @param {Object} [options]
 * @param {string[]} [options.permissions] - API key permissions
 * @returns {Object} ctx, with `res.statusCode` / `res.body` / `res.headers` recorded
 */
function makeCtx(method, pathname, { permissions = ['read', 'export'] } = {}) {
  const req = Readable.from([]);
  req.method = method;
  req.headers = {};

  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    end(payload) { this.body = payload ?? null; },
  };

  return {
    req,
    res,
    url: new URL(`http://localhost${pathname}`),
    repoRoot: process.cwd(),
    storageScope: { repoRoot: process.cwd(), organizationId: ORG, actorEmail: KEY_OWNER },
    apiKey: { id: KEY_ID, tier: 'free', ownerEmail: KEY_OWNER, permissions, organizationId: ORG },
    authedUser: { id: null, email: KEY_OWNER, role: 'user', organizationId: ORG },
  };
}

function parseJsonBody(res) {
  return JSON.parse(String(res.body));
}

// ---------------------------------------------------------------------------
// GET /api/v1/presentations/:id/export/json
// ---------------------------------------------------------------------------

test('GET /export/json answers the portable deck as an attachment', async () => {
  await installDb();
  const ctx = makeCtx('GET', `/api/v1/presentations/${DECK_ID}/export/json`);
  assert.equal(await handleExports(ctx), true);

  assert.equal(ctx.res.statusCode, 200);
  assert.match(ctx.res.headers['Content-Type'], /application\/json/);
  assert.equal(ctx.res.headers['Content-Disposition'], 'attachment; filename="Export-Me.json"');
  assert.ok(ctx.res.headers['X-RateLimit-Limit'], 'export rate-limit headers ride along');

  const deck = parseJsonBody(ctx.res);
  assert.equal(deck.format, 'deckyard.deck');
  assert.equal(deck.version, 1);
  assert.equal(deck.title, 'Export Me');
  assert.equal(deck.slides.length, 1);
  assert.equal(
    deck.slides[0].type,
    'eu.deckyard.slide.title',
    'the export emits the canonical reverse-DNS id, not the registry key'
  );
});

test('GET /export/json?lang=en-GB projects that language and suffixes the filename', async () => {
  await installDb();
  const ctx = makeCtx('GET', `/api/v1/presentations/${DECK_ID}/export/json?lang=en-GB`);
  await handleExports(ctx);

  assert.equal(ctx.res.statusCode, 200);
  const deck = parseJsonBody(ctx.res);
  assert.equal(deck.title, 'Export Me (EN)');
  assert.equal(deck.slides[0].content.title, 'Hello');
  assert.match(ctx.res.headers['Content-Disposition'], /-EN\.json"$/);
});

test('GET /export/json tracks the export in the daily usage', async () => {
  const db = await installDb();
  const ctx = makeCtx('GET', `/api/v1/presentations/${DECK_ID}/export/json`);
  await handleExports(ctx);
  assert.equal(ctx.res.statusCode, 200);

  const usage = db.__tables.api_usage_daily.find((row) => row.api_key_id === KEY_ID);
  assert.equal(usage?.export_count, 1, 'the export counted against the daily budget');
});

// ---------------------------------------------------------------------------
// GET /api/v1/presentations/:id/export/html and /export/pdf
// ---------------------------------------------------------------------------

test('GET /export/html answers a standalone HTML document', async () => {
  await installDb();
  const ctx = makeCtx('GET', `/api/v1/presentations/${DECK_ID}/export/html`);
  await handleExports(ctx);

  assert.equal(ctx.res.statusCode, 200);
  assert.match(ctx.res.headers['Content-Type'], /text\/html/);
  assert.equal(ctx.res.headers['Content-Disposition'], 'attachment; filename="Export-Me.html"');
  const html = String(ctx.res.body);
  assert.match(html, /<!doctype html>/i);
  assert.ok(html.includes('Hallo'), 'the slide content is embedded');
});

test('GET /export/pdf answers print-ready HTML with the -print filename', async () => {
  await installDb();
  const ctx = makeCtx('GET', `/api/v1/presentations/${DECK_ID}/export/pdf`);
  await handleExports(ctx);

  assert.equal(ctx.res.statusCode, 200);
  assert.match(ctx.res.headers['Content-Type'], /text\/html/);
  assert.equal(ctx.res.headers['Content-Disposition'], 'attachment; filename="Export-Me-print.html"');
  assert.match(String(ctx.res.body), /<!doctype html>/i);
});

// ---------------------------------------------------------------------------
// The shared gate ladder
// ---------------------------------------------------------------------------

test('every export variant is refused with 403 without the export permission', async () => {
  await installDb();
  for (const variant of ['json', 'html', 'pdf', 'pptx']) {
    const ctx = makeCtx('GET', `/api/v1/presentations/${DECK_ID}/export/${variant}`, {
      permissions: ['read', 'write'],
    });
    await handleExports(ctx);
    assert.equal(ctx.res.statusCode, 403, `${variant} must require the export permission`);
  }
});

test('exports answer 429 with limit details when the daily export budget is spent', async () => {
  await installDb({ exportsUsedToday: 50 }); // free tier: 50 exports/day
  const ctx = makeCtx('GET', `/api/v1/presentations/${DECK_ID}/export/json`);
  await handleExports(ctx);

  assert.equal(ctx.res.statusCode, 429);
  const body = parseJsonBody(ctx.res);
  // B61: the one v1 envelope — machine code in `error`, limit facts in `details`.
  assert.equal(body.error, 'rate_limited');
  assert.equal(body.details.limit, 50);
  assert.equal(body.details.used, 50);
  assert.ok(body.details.resetAt, 'the details name the reset moment');
  assert.equal(ctx.res.headers['X-RateLimit-Remaining'], '0');
});

test("exporting someone else's private deck is refused with 403", async () => {
  await installDb();
  const ctx = makeCtx('GET', `/api/v1/presentations/${FOREIGN_DECK_ID}/export/json`);
  await handleExports(ctx);
  assert.equal(ctx.res.statusCode, 403);
});

test('exporting an unknown deck answers 404', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/presentations/never-a-deck/export/json');
  await handleExports(ctx);
  assert.equal(ctx.res.statusCode, 404);
});

test('POST on an export route answers 405 with the allowed methods', async () => {
  await installDb();
  const ctx = makeCtx('POST', `/api/v1/presentations/${DECK_ID}/export/json`);
  await handleExports(ctx);
  assert.equal(ctx.res.statusCode, 405);
  assert.equal(ctx.res.headers.Allow ?? ctx.res.headers.allow, 'GET');
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test('a pathname outside the export surface is not handled', async () => {
  await installDb();
  const ctx = makeCtx('GET', `/api/v1/presentations/${DECK_ID}`);
  assert.equal(await handleExports(ctx), false);
  assert.equal(ctx.res.statusCode, null, 'no response was written');
});
