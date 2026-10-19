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
 * Negative assertions pin the status code *and* the one converged error
 * envelope (B61): `{ error: '<machine_code>', message }`, snake_case code in
 * `error`, never the internal `{ ok:false, … }` shape. The former split (B39
 * deel 3 bevinding 11) is closed, so the shapes are pinned on purpose.
 *
 * Run with: node --test tests/public-api-v1-router.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.AUTH_SECRET = ['deckyard', 'test', 'auth']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
// The limiter runs on the same opt-in as tests/rate-limit-redis.test.js: a
// disposable Redis named by RATE_LIMIT_TEST_REDIS_URL, otherwise process
// memory. An ambient REDIS_URL is never used, so the run cannot touch a live DB.
const REDIS_TEST_URL = process.env.RATE_LIMIT_TEST_REDIS_URL;
if (REDIS_TEST_URL) {
  process.env.REDIS_URL = REDIS_TEST_URL;
  process.env.REDIS_ENABLED = 'true';
} else process.env.REDIS_ENABLED = 'false';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';
const KEY_OWNER = 'owner@example.com';
const VALID_KEY = 'dk_live_contract-test-key-000000000000';
const OTHER_KEY = 'dk_live_other-org-key-00000000000000';
const REVOKED_KEY = 'dk_live_revoked-key-0000000000000000';
const LIMIT_KEY = 'dk_live_limit-key-000000000000000000';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { hashToken } = await import('../server/utils/secure-tokens.js');
const { handlePublicApiV1 } =
  await import('../server/routes/public-api/v1/index.js');
const { SLIDE_TYPES } = await import('../shared/slide-types.js');
const { SLIDE_TYPE_IDS } = await import('../shared/slide-types/registry.js');
const { closeRedis, getRedisClient } =
  await import('../server/utils/redis-client.js');

/** Every key id below gets a bucket the moment it authenticates. */
const API_KEY_IDS = ['key-valid', 'key-other', 'key-revoked', 'key-limit'];

/**
 * Remove this file's buckets from the test Redis, so a second run against the
 * same instance starts from a full budget. A no-op on the memory backend.
 */
async function deleteRedisBuckets() {
  if (!REDIS_TEST_URL) return;
  const client = await getRedisClient();
  await client?.del(
    ...API_KEY_IDS.map((id) => `ratelimit:token-bucket:api:${id}`),
  );
}

// Before as well as after: a run that crashed mid-file left its buckets behind.
test.before(deleteRedisBuckets);
test.after(async () => {
  await deleteRedisBuckets();
  await closeRedis();
});

/**
 * Install a freshly seeded double and point the storage facade at Postgres.
 * @returns {Promise<Object>} The database double.
 */
async function installDb(customSlideTypes = []) {
  const db = createFakeDb({
    organizations: [
      { id: ORG, name: 'Default', slug: 'default' },
      { id: OTHER_ORG, name: 'Other', slug: 'other' },
    ],
    api_keys: [
      apiKeyRow({ id: 'key-valid', rawKey: VALID_KEY }),
      apiKeyRow({
        id: 'key-other',
        rawKey: OTHER_KEY,
        organization_id: OTHER_ORG,
      }),
      apiKeyRow({
        id: 'key-revoked',
        rawKey: REVOKED_KEY,
        revoked_at: '2026-08-01T00:00:00.000Z',
      }),
      apiKeyRow({ id: 'key-limit', rawKey: LIMIT_KEY }),
    ],
    custom_slide_types: customSlideTypes,
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

function apiKeyRow({ id, rawKey, revoked_at = null, organization_id = ORG }) {
  return {
    id,
    organization_id,
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
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    end(payload) {
      this.body = payload ?? null;
    },
  };

  return {
    req,
    res,
    url: new URL(`http://localhost${pathname}`),
    repoRoot: process.cwd(),
  };
}

function jsonBody(res) {
  return JSON.parse(String(res.body));
}

/**
 * Assert a response carries the one converged v1 error envelope: a snake_case
 * machine code in `error`, and crucially NOT the internal `ok:false` shape.
 * @param {Object} res - recorded response
 * @param {number} status - expected HTTP status
 * @param {string} code - expected machine code
 */
function assertV1Error(res, status, code) {
  assert.equal(
    res.statusCode,
    status,
    `expected ${status}, got ${res.statusCode}`,
  );
  const body = jsonBody(res);
  assert.equal(body.error, code, `error code should be ${code}`);
  assert.ok(
    !('ok' in body),
    'v1 envelope must not carry the internal `ok` discriminator',
  );
  assert.match(
    body.error,
    /^[a-z][a-z0-9_]*$/,
    'error is a snake_case machine code',
  );
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
  assert.ok(
    String(ctx.res.body).includes('/api/v1/openapi.yaml'),
    'the page loads the spec',
  );
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
      `the schema mentions ${name}`,
    );
  }
});

test('GET /api/v1/schema/slide-types/:id.json serves one content schema, 404 unknown', async () => {
  await installDb();
  const known = makeCtx(
    'GET',
    '/api/v1/schema/slide-types/eu.deckyard.slide.content.json',
  );
  await handlePublicApiV1(known);
  assert.equal(known.res.statusCode, 200);
  assert.ok(jsonBody(known.res).properties, 'a JSON Schema object comes back');
  assert.match(jsonBody(known.res).$id, /eu\.deckyard\.slide\.content/);

  const unknown = makeCtx(
    'GET',
    '/api/v1/schema/slide-types/never-a-type.json',
  );
  await handlePublicApiV1(unknown);
  assertV1Error(unknown.res, 404, 'not_found');

  // B504: one spelling, one route. The bare registry key, a qualified form
  // and the retired descriptor route name no schema.
  for (const pathname of [
    '/api/v1/schema/slide-types/content-slide.json',
    '/api/v1/schema/slide-types/core/content-slide.json',
    '/api/v1/slide-types/content-slide/schema',
    '/api/v1/slide-types/eu.deckyard.slide.content/schema',
  ]) {
    const ctx = makeCtx('GET', pathname, { bearer: VALID_KEY });
    await handlePublicApiV1(ctx);
    assertV1Error(ctx.res, 404, 'not_found');
  }

  const junk = makeCtx('GET', '/api/v1/schema/otherwise');
  await handlePublicApiV1(junk);
  assertV1Error(junk.res, 404, 'not_found');
});

test('every registered type serves its schema at its published id', async () => {
  // The route's contract is "the id `slides[].type` carries", so every id the
  // registry publishes must reach it, the slash form included (`custom/hero`,
  // a fork type without a dotted authority). The fork CI run exercises that
  // form; here it is core only.
  await installDb();
  for (const [key, id] of Object.entries(SLIDE_TYPE_IDS)) {
    const ctx = makeCtx('GET', `/api/v1/schema/slide-types/${id}.json`);
    await handlePublicApiV1(ctx);
    assert.equal(ctx.res.statusCode, 200, `${key} at ${id}`);
  }
});

test('catalogue and authenticated schema expose only the API key organization types', async () => {
  await installDb([
    ...[ORG, OTHER_ORG].map((organization_id, index) => ({
      id: `cst-partner-wall-${index}`,
      organization_id,
      slug: 'partner-wall',
      label: `Partner wall ${index}`,
      base_type: null,
      fields: [{ key: `partner${index}`, type: 'string', required: true }],
      defaults: { [`partner${index}`]: `Organization ${index}` },
      defaults_by_lang: { nl: { [`partner${index}`]: `Organisatie ${index}` } },
      template: '<div class="slide"><div class="slide-inner"></div></div>',
      is_published: true,
      sort_order: 0,
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-01T00:00:00.000Z',
    })),
    {
      id: 'cst-private',
      organization_id: ORG,
      slug: 'private',
      label: 'Only first organization',
      fields: [],
      defaults: {},
      is_published: true,
    },
    {
      id: 'cst-draft',
      organization_id: ORG,
      slug: 'draft',
      label: 'Draft',
      fields: [],
      defaults: {},
      is_published: false,
    },
  ]);
  const pathname = '/api/v1/schema/slide-types/custom-partner-wall.json';
  // Alternate keys, then return to the first: no request may reuse another
  // organization's definition, even when both publish the same type slug.
  for (const [bearer, index] of [
    [VALID_KEY, 0],
    [OTHER_KEY, 1],
    [VALID_KEY, 0],
  ]) {
    const catalogue = makeCtx('GET', '/api/v1/slide-types', { bearer });
    await handlePublicApiV1(catalogue);
    assert.equal(catalogue.res.statusCode, 200);
    assert.equal(
      catalogue.storageScope.organizationId,
      index === 0 ? ORG : OTHER_ORG,
    );
    const { slideTypes, count } = jsonBody(catalogue.res);
    assert.equal(
      count,
      Object.keys(SLIDE_TYPES).length + (index === 0 ? 2 : 1),
    );
    assert.equal(Boolean(slideTypes['custom-private']), index === 0);
    assert.equal(slideTypes['custom-draft'], undefined);
    const type = slideTypes['custom-partner-wall'];
    assert.ok(type, 'the published organization type is in the catalogue');
    assert.equal(type.label, `Partner wall ${index}`);
    assert.equal(type.defaults[`partner${index}`], `Organization ${index}`);
    assert.equal(
      type.defaultsByLang.nl[`partner${index}`],
      `Organisatie ${index}`,
    );
    assert.ok(type.fields.some((f) => f.key === `partner${index}`));
    assert.ok(!type.fields.some((f) => f.key === `partner${1 - index}`));
    assert.equal(type.renderHtml, undefined);
    assert.equal(type.customId, undefined);

    const schema = makeCtx('GET', pathname, { bearer });
    await handlePublicApiV1(schema);
    assert.equal(schema.res.statusCode, 200);
    assert.ok(jsonBody(schema.res).properties[`partner${index}`]);
    assert.equal(
      jsonBody(schema.res).properties[`partner${1 - index}`],
      undefined,
    );
    assert.deepEqual(jsonBody(schema.res).required, [`partner${index}`]);
    assert.match(schema.res.headers['Cache-Control'], /^private/);
    const privateSchema = makeCtx(
      'GET',
      '/api/v1/schema/slide-types/custom-private.json',
      { bearer },
    );
    await handlePublicApiV1(privateSchema);
    assert.equal(privateSchema.res.statusCode, index === 0 ? 200 : 404);
  }

  const publicSchema = makeCtx('GET', pathname);
  await handlePublicApiV1(publicSchema);
  assertV1Error(publicSchema.res, 404, 'not_found');
  const invalidKey = makeCtx('GET', pathname, { bearer: 'not-a-key' });
  await handlePublicApiV1(invalidKey);
  assertV1Error(invalidKey.res, 401, 'unauthorized');
});

test('POST on a meta endpoint answers 405 in the v1 envelope with Allow', async () => {
  await installDb();
  for (const pathname of [
    '/api/v1/',
    '/api/v1/docs',
    '/api/v1/openapi.yaml',
    '/api/v1/schema/deck.json',
  ]) {
    const ctx = makeCtx('POST', pathname);
    await handlePublicApiV1(ctx);
    assertV1Error(ctx.res, 405, 'method_not_allowed');
    assert.ok(
      ctx.res.headers['Allow'],
      `${pathname} names the accepted methods`,
    );
  }
});

// ---------------------------------------------------------------------------
// The authentication chain
// ---------------------------------------------------------------------------

test('a request without an Authorization header is refused with 401', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/presentations');
  assert.equal(await handlePublicApiV1(ctx), true);
  assertV1Error(ctx.res, 401, 'unauthorized');
});

test('a malformed, unknown or revoked key is refused with 401', async () => {
  await installDb();
  for (const bearer of [
    'not-a-key',
    'dk_live_unknown-key-00000000000000000',
    REVOKED_KEY,
  ]) {
    const ctx = makeCtx('GET', '/api/v1/presentations', { bearer });
    await handlePublicApiV1(ctx);
    assertV1Error(ctx.res, 401, 'unauthorized');
  }
});

test('a valid key reaches the feature handlers with its own organization scope', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/slide-types', { bearer: VALID_KEY });
  assert.equal(await handlePublicApiV1(ctx), true);

  assert.equal(
    ctx.res.statusCode,
    200,
    'the chain auth → ctx → handler completes',
  );
  const body = jsonBody(ctx.res);
  assert.equal(body.count, Object.keys(SLIDE_TYPES).length);
});

test('a valid key on an unknown v1 route answers 404 in the v1 envelope', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/never-a-route', { bearer: VALID_KEY });
  assert.equal(await handlePublicApiV1(ctx), true);
  assertV1Error(ctx.res, 404, 'not_found');
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

test('request headers count down to the same 429 decision', async () => {
  await installDb();

  // Free tier: 60 requests/minute. The limiter is keyed on the api key id and
  // lives in process memory, or in the test Redis when one is named, so a
  // dedicated key keeps this loop from interfering with the other tests.
  let last = null;
  for (let i = 0; i < 61; i++) {
    last = makeCtx('GET', '/api/v1/slide-types', { bearer: LIMIT_KEY });
    await handlePublicApiV1(last);
    if (i < 60) {
      assert.equal(
        last.res.statusCode,
        200,
        `request ${i + 1} passes the limiter`,
      );
      assert.equal(last.res.headers['X-RateLimit-Limit'], '60');
      assert.equal(last.res.headers['X-RateLimit-Remaining'], String(59 - i));
      assert.ok(
        Number(last.res.headers['X-RateLimit-Reset']) > Date.now() / 1000,
      );
    }
  }

  assertV1Error(last.res, 429, 'rate_limited');
  assert.equal(last.res.headers['X-RateLimit-Limit'], '60');
  assert.equal(last.res.headers['X-RateLimit-Remaining'], '0');
  assert.ok(Number(last.res.headers['X-RateLimit-Reset']) > Date.now() / 1000);
  assert.ok(Number(last.res.headers['Retry-After']) > 0);
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
