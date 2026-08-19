/**
 * Contract tests for the public API v1 AI module (B40 PR 5+):
 * GET /api/v1/ai/vendors, POST /api/v1/ai/wizard and
 * POST /api/v1/ai/append-slides.
 *
 * The surface these pin: the vendors listing (the LLM status object as it
 * actually is), and the gate ladder of both generation endpoints — `ai`
 * permission → daily AI limit → body validation — with their status codes:
 * 403 without `ai`, 429 with rate-limit headers when the daily budget is
 * spent, 400 for a missing/empty `raw`.
 *
 * The generation success paths are NOT covered: both call the configured LLM
 * vendor and there is no vendor seam to observe without one — noted as an
 * explicit opt-out in the B40 brief's Opt-out-log, like the translation
 * endpoint (same seam). Everything up to that call is pinned.
 *
 * Handler-import level against the database double, like the neighbours
 * (tests/public-api-partial-write.test.js). Negative assertions pin the
 * status code, not the error envelope (B39 deel 3 bevinding 11).
 *
 * Run with: node --test tests/public-api-v1-ai.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.AUTH_SECRET = ['deckyard', 'test', 'auth']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const KEY_OWNER = 'owner@example.com';
const KEY_ID = 'key-1';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { handleAi } = await import('../server/routes/public-api/v1/ai.js');
const { getLlmStatus } = await import('../server/utils/llm/config.js');

/**
 * Install a freshly seeded double and point the storage facade at Postgres.
 * @param {Object} [options]
 * @param {number} [options.aiUsedToday] - Today's spent AI budget for the key
 * @returns {Promise<Object>} The database double.
 */
async function installDb({ aiUsedToday = 0 } = {}) {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    api_usage_daily: aiUsedToday
      ? [
          {
            id: 'usage-1',
            api_key_id: KEY_ID,
            date: new Date().toISOString().split('T')[0],
            request_count: aiUsedToday,
            ai_request_count: aiUsedToday,
            export_count: 0,
          },
        ]
      : [],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

/**
 * Request context for the AI handler, with the key already authenticated
 * (authenticateApiKey is a different seam with its own tests).
 * @param {string} method - HTTP method
 * @param {string} pathname - Request path
 * @param {Object} [options]
 * @param {Object|null} [options.body] - JSON body
 * @param {string[]} [options.permissions] - API key permissions
 * @returns {Object} ctx, with `res.statusCode` / `res.body` recorded
 */
function makeCtx(
  method,
  pathname,
  { body = null, permissions = ['read', 'ai'] } = {},
) {
  const req = Readable.from(
    body === null ? [] : [Buffer.from(JSON.stringify(body))],
  );
  req.method = method;
  req.headers = { 'content-type': 'application/json' };

  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };

  return {
    req,
    res,
    url: new URL(`http://localhost${pathname}`),
    repoRoot: process.cwd(),
    storageScope: {
      repoRoot: process.cwd(),
      organizationId: ORG,
      actorEmail: KEY_OWNER,
    },
    apiKey: {
      id: KEY_ID,
      tier: 'free',
      name: 'Test key',
      ownerEmail: KEY_OWNER,
      permissions,
      organizationId: ORG,
    },
    authedUser: {
      id: null,
      email: KEY_OWNER,
      role: 'user',
      organizationId: ORG,
    },
  };
}

// ---------------------------------------------------------------------------
// GET /api/v1/ai/vendors
// ---------------------------------------------------------------------------

test('GET /ai/vendors answers the LLM status object', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/ai/vendors');
  assert.equal(await handleAi(ctx), true);

  assert.equal(ctx.res.statusCode, 200);
  // Pins what the endpoint actually returns: the getLlmStatus() object
  // (knownVendors/configuredVendors/defaultVendor/vendorLabels). The OpenAPI
  // spec documented a different, per-vendor {available, name} map — recorded
  // as a B40 finding and corrected in the spec alongside it.
  assert.deepEqual(ctx.res.body.vendors, getLlmStatus());
  assert.ok(Array.isArray(ctx.res.body.vendors.knownVendors));
});

test('GET /ai/vendors without the read permission is refused with 403', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/ai/vendors', { permissions: ['ai'] });
  await handleAi(ctx);
  assert.equal(ctx.res.statusCode, 403);
});

test('POST /ai/vendors answers 405 with the allowed methods', async () => {
  await installDb();
  const ctx = makeCtx('POST', '/api/v1/ai/vendors');
  await handleAi(ctx);
  assert.equal(ctx.res.statusCode, 405);
  assert.equal(ctx.res.headers.Allow ?? ctx.res.headers.allow, 'GET');
});

// ---------------------------------------------------------------------------
// POST /api/v1/ai/wizard — the gate ladder
// ---------------------------------------------------------------------------

test('POST /ai/wizard without the ai permission is refused with 403', async () => {
  await installDb();
  const ctx = makeCtx('POST', '/api/v1/ai/wizard', {
    body: { raw: 'A deck about tests' },
    permissions: ['read', 'write'],
  });
  await handleAi(ctx);
  assert.equal(ctx.res.statusCode, 403);
});

test('POST /ai/wizard answers 429 with limit details when the daily AI budget is spent', async () => {
  await installDb({ aiUsedToday: 10 }); // free tier: 10 AI calls/day
  const ctx = makeCtx('POST', '/api/v1/ai/wizard', {
    body: { raw: 'A deck about tests' },
  });
  await handleAi(ctx);

  assert.equal(ctx.res.statusCode, 429);
  // B61: the one v1 envelope — machine code in `error`, limit facts in `details`.
  assert.equal(ctx.res.body.error, 'rate_limited');
  assert.equal(ctx.res.body.details.limit, 10);
  assert.equal(ctx.res.body.details.used, 10);
  assert.ok(ctx.res.body.details.resetAt, 'the details name the reset moment');
  assert.equal(ctx.res.headers['X-RateLimit-Remaining'], '0');
});

test('POST /ai/wizard without raw content answers 400', async () => {
  await installDb();
  for (const body of [null, {}, { raw: '' }, { raw: '   ' }]) {
    const ctx = makeCtx('POST', '/api/v1/ai/wizard', { body });
    await handleAi(ctx);
    assert.equal(
      ctx.res.statusCode,
      400,
      `${JSON.stringify(body)} must be refused`,
    );
  }
});

test('GET /ai/wizard answers 405 with the allowed methods', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/ai/wizard');
  await handleAi(ctx);
  assert.equal(ctx.res.statusCode, 405);
  assert.equal(ctx.res.headers.Allow ?? ctx.res.headers.allow, 'POST');
});

// ---------------------------------------------------------------------------
// POST /api/v1/ai/append-slides — the gate ladder
// ---------------------------------------------------------------------------

test('POST /ai/append-slides without the ai permission is refused with 403', async () => {
  await installDb();
  const ctx = makeCtx('POST', '/api/v1/ai/append-slides', {
    body: { raw: 'More slides' },
    permissions: ['read', 'write', 'export'],
  });
  await handleAi(ctx);
  assert.equal(ctx.res.statusCode, 403);
});

test('POST /ai/append-slides answers 429 when the daily AI budget is spent', async () => {
  await installDb({ aiUsedToday: 10 });
  const ctx = makeCtx('POST', '/api/v1/ai/append-slides', {
    body: { raw: 'More slides' },
  });
  await handleAi(ctx);
  assert.equal(ctx.res.statusCode, 429);
});

test('POST /ai/append-slides without raw content answers 400', async () => {
  await installDb();
  for (const body of [null, {}, { raw: '' }]) {
    const ctx = makeCtx('POST', '/api/v1/ai/append-slides', { body });
    await handleAi(ctx);
    assert.equal(
      ctx.res.statusCode,
      400,
      `${JSON.stringify(body)} must be refused`,
    );
  }
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test('a pathname outside the AI surface is not handled', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/presentations');
  assert.equal(await handleAi(ctx), false);
  assert.equal(ctx.res.statusCode, null, 'no response was written');
});
