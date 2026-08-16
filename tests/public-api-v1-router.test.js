/**
 * Contract tests for the public API v1 router and meta endpoints (B40 PR 5+):
 * `handlePublicApiV1` in server/routes/public-api/v1/index.js.
 *
 * The surface these pin, per docs/openapi.yaml: the unauthenticated meta
 * endpoints (`/`, `/docs`, `/openapi.yaml`, `/schema/deck.json`,
 * `/schema/slide-types/{type}.json`), the API-key authentication chain
 * (missing header, malformed key, unknown key, revoked key → 401; the ctx a
 * valid key produces reaches the feature handlers), the per-minute request
 * limiter (free tier: 60/min → 429), and the unknown-route 404 behind auth.
 *
 * Unlike the per-module contract tests, these enter through the real router
 * with only `{ repoRoot, req, res, url }` — authentication is the subject
 * here, not a pre-authenticated seam.
 *
 * Negative assertions pin the status code, not the error envelope: v1's
 * envelope split is a recorded finding (B39 deel 3 bevinding 11) scheduled to
 * converge, and pinning the shapes would cement it.
 *
 * Run with: node --test tests/public-api-v1-router.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.AUTH_SECRET = ['deckyard', 'test', 'auth'].join('-').padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const KEY_OWNER = 'owner@example.com';
const VALID_KEY = 'dk_live_contract-test-key-000000000000';
const REVOKED_KEY = 'dk_live_revoked-key-0000000000000000';
const LIMIT_KEY = 'dk_live_limit-key-000000000000000000';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/adapters/index.js');
const { hashToken } = await import('../server/utils/secure-tokens.js');
const { handlePublicApiV1 } = await import('../server/routes/public-api/v1/index.js');
const { SLIDE_TYPES } = await import('../shared/slide-types.js');

/**
 * Install a freshly seeded double and point the storage facade at Postgres.
 * @returns {Promise<Object>} The database double.
 */
async function installDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    api_keys: [
      apiKeyRow({ id: 'key-valid', rawKey: VALID_KEY }),
      apiKeyRow({ id: 'key-revoked', rawKey: REVOKED_KEY, revoked_at: '2026-08-01T00:00:00.000Z' }),
      apiKeyRow({ id: 'key-limit', rawKey: LIMIT_KEY }),
    ],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

function apiKeyRow({ id, rawKey, revoked_at = null }) {
  return {
    id,
    organization_id: ORG,
    owner_email: KEY_OWNER,
    name: `Key ${id}`,
    key_prefix: rawKey.slice(0, 12),
    key_hash: hashToken(rawKey),
    tier: 'free',
    permissions: ['read', 'write'],
    revoked_at,
    last_used_at: null,
    created_at: '2026-07-01T00:00:00.000Z',
  };
}

/**
 * Bare request context for the router — authentication is under test, so
 * nothing is pre-attached; the router builds apiKey/authedUser/storageScope.
 * @param {string} method - HTTP method
 * @param {string} pathname - Request path
 * @param {Object} [options]
 * @param {string|null} [options.bearer] - Authorization bearer token
 * @returns {Object} ctx, with `res.statusCode` / `res.body` recorded
 */
function makeCtx(method, pathname, { bearer = null } = {}) {
  const req = Readable.from([]);
  req.method = method;
  req.headers = bearer === null ? {} : { authorization: `Bearer ${bearer}` };

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

  return { req, res, url: new URL(`http://localhost${pathname}`), repoRoot: process.cwd() };
}

function jsonBody(res) {
  return JSON.parse(String(res.body));
}

// ---------------------------------------------------------------------------
// Meta endpoints — no authentication required
// ---------------------------------------------------------------------------

test('GET /api/v1/ answers the API info without authentication', async () => {
  await installDb();
  for (const pathname of ['/api/v1', '/api/v1/']) {
    const ctx = makeCtx('GET', pathname);
    assert.equal(await handlePublicApiV1(ctx), true);
    assert.equal(ctx.res.statusCode, 200, `${pathname} must answer`);
    const body = jsonBody(ctx.res);
    assert.equal(body.name, 'Deckyard Public API');
    assert.equal(body.version, 'v1');
    assert.equal(body.documentation, '/api/v1/docs');
    assert.ok(body.endpoints.presentations);
  }
});

test('GET /api/v1/docs serves the Swagger UI page without authentication', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/docs');
  assert.equal(await handlePublicApiV1(ctx), true);
  assert.equal(ctx.res.statusCode, 200);
  assert.match(ctx.res.headers['Content-Type'], /text\/html/);
  assert.ok(String(ctx.res.body).includes('/api/v1/openapi.yaml'), 'the page loads the spec');
});

test('GET /api/v1/openapi.yaml serves the specification without authentication', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/openapi.yaml');
  assert.equal(await handlePublicApiV1(ctx), true);
  assert.equal(ctx.res.statusCode, 200);
  assert.match(ctx.res.headers['Content-Type'], /text\/yaml/);
  assert.match(String(ctx.res.body), /^openapi: 3\.0\.\d/);
});

test('GET /api/v1/schema/deck.json serves the generated deck schema', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/schema/deck.json');
  assert.equal(await handlePublicApiV1(ctx), true);
  assert.equal(ctx.res.statusCode, 200);

  const schema = jsonBody(ctx.res);
  assert.ok(schema.$defs, 'the deck schema carries per-type content schemas');
  // Generated from the registry, so every slide type is present.
  for (const name of Object.keys(SLIDE_TYPES)) {
    assert.ok(
      JSON.stringify(schema).includes(name),
      `the schema mentions ${name}`
    );
  }
});

test('GET /api/v1/schema/slide-types/:name.json serves one content schema, 404 unknown', async () => {
  await installDb();
  const known = makeCtx('GET', '/api/v1/schema/slide-types/content-slide.json');
  await handlePublicApiV1(known);
  assert.equal(known.res.statusCode, 200);
  assert.ok(jsonBody(known.res).properties, 'a JSON Schema object comes back');

  const unknown = makeCtx('GET', '/api/v1/schema/slide-types/never-a-type.json');
  await handlePublicApiV1(unknown);
  assert.equal(unknown.res.statusCode, 404);

  const junk = makeCtx('GET', '/api/v1/schema/otherwise');
  await handlePublicApiV1(junk);
  assert.equal(junk.res.statusCode, 404);
});

test('POST on a meta endpoint answers 405', async () => {
  await installDb();
  for (const pathname of ['/api/v1/', '/api/v1/docs', '/api/v1/openapi.yaml', '/api/v1/schema/deck.json']) {
    const ctx = makeCtx('POST', pathname);
    await handlePublicApiV1(ctx);
    assert.equal(ctx.res.statusCode, 405, `${pathname} must refuse POST`);
  }
});

// ---------------------------------------------------------------------------
// The authentication chain
// ---------------------------------------------------------------------------

test('a request without an Authorization header is refused with 401', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/presentations');
  assert.equal(await handlePublicApiV1(ctx), true);
  assert.equal(ctx.res.statusCode, 401);
});

test('a malformed, unknown or revoked key is refused with 401', async () => {
  await installDb();
  for (const bearer of ['not-a-key', 'dk_live_unknown-key-00000000000000000', REVOKED_KEY]) {
    const ctx = makeCtx('GET', '/api/v1/presentations', { bearer });
    await handlePublicApiV1(ctx);
    assert.equal(ctx.res.statusCode, 401, `${bearer.slice(0, 16)}… must be refused`);
  }
});

test('a valid key reaches the feature handlers with its own organization scope', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/slide-types', { bearer: VALID_KEY });
  assert.equal(await handlePublicApiV1(ctx), true);

  assert.equal(ctx.res.statusCode, 200, 'the chain auth → ctx → handler completes');
  const body = jsonBody(ctx.res);
  assert.equal(body.count, Object.keys(SLIDE_TYPES).length);
});

test('a valid key on an unknown v1 route answers 404', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/never-a-route', { bearer: VALID_KEY });
  assert.equal(await handlePublicApiV1(ctx), true);
  assert.equal(ctx.res.statusCode, 404);
});

test('authentication stamps last_used_at on the key row', async () => {
  const db = await installDb();
  const ctx = makeCtx('GET', '/api/v1/slide-types', { bearer: VALID_KEY });
  await handlePublicApiV1(ctx);

  const row = db.__tables.api_keys.find((r) => r.id === 'key-valid');
  assert.ok(row.last_used_at, 'validateApiKey records the use');
});

// ---------------------------------------------------------------------------
// Per-minute request limiter
// ---------------------------------------------------------------------------

test('the 61st request within a minute is refused with 429 and Retry-After', async () => {
  await installDb();

  // Free tier: 60 requests/minute. The limiter is keyed on the api key id and
  // lives in process memory under test, so a dedicated key keeps this loop
  // from interfering with the other tests.
  let last = null;
  for (let i = 0; i < 61; i++) {
    last = makeCtx('GET', '/api/v1/never-a-route', { bearer: LIMIT_KEY });
    await handlePublicApiV1(last);
    if (i < 60) {
      assert.equal(last.res.statusCode, 404, `request ${i + 1} passes the limiter`);
    }
  }

  assert.equal(last.res.statusCode, 429);
  assert.ok(last.res.headers['Retry-After'], 'the limiter names a retry moment');
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test('a pathname outside /api/v1 is not handled', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/presentations');
  assert.equal(await handlePublicApiV1(ctx), false);
  assert.equal(ctx.res.statusCode, null, 'no response was written');
});
