/**
 * Contract tests for the public API v1 resources module (B40 PR 5+):
 * GET /api/v1/themes, /api/v1/slide-types
 * and /api/v1/image-library.
 *
 * The surface these pin, per docs/openapi.yaml: status codes, the documented
 * response shapes, org-scoping (a key only sees its own organization's custom
 * themes and images) and the permission gate (every endpoint requires `read`).
 * Handler-import level against the database double, like the neighbours
 * (tests/public-api-partial-write.test.js) — no HTTP server involved.
 *
 * Negative assertions pin the status code, not the error envelope: v1
 * currently answers cross-cutting rejections in the internal machine-code
 * envelope and endpoint errors in its own prose envelope, and that split is
 * scheduled to converge (B39 deel 3 bevinding 11). Pinning both shapes here
 * would cement the inconsistency.
 *
 * Run with: node --test tests/public-api-v1-resources.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.AUTH_SECRET = ['amethyst', 'test', 'auth']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
delete process.env.SANDBOX_MODE;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';
const KEY_OWNER = 'owner@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { handleResources } =
  await import('../server/routes/public-api/v1/resources.js');
const { SLIDE_TYPES } = await import('../shared/slide-types.js');

/**
 * Install a freshly seeded double and point the storage facade at Postgres.
 * @returns {Promise<Object>} The database double.
 */
async function installDb() {
  const db = createFakeDb({
    organizations: [
      {
        id: ORG,
        name: 'Default',
        slug: 'default',
        settings: { defaultThemeId: '11111111-1111-4111-8111-111111111111' },
      },
      {
        id: OTHER_ORG,
        name: 'Other',
        slug: 'other',
        settings: { defaultThemeId: '11111111-1111-4111-8111-111111111111' },
      },
    ],
    themes: [
      themeRow({
        id: '11111111-1111-4111-8111-111111111111',
        organization_id: null,
        label: 'Amethyst',
      }),
      themeRow({
        id: 'theme-own',
        organization_id: ORG,
        label: 'Own custom theme',
      }),
      themeRow({
        id: 'theme-foreign',
        organization_id: OTHER_ORG,
        label: 'Foreign theme',
      }),
    ],
    image_library: [
      imageRow({
        id: 'img-sea',
        organization_id: ORG,
        title: 'Sea',
        tags: ['nature', 'water'],
      }),
      imageRow({
        id: 'img-city',
        organization_id: ORG,
        title: 'City lights',
        tags: ['urban'],
      }),
      imageRow({
        id: 'img-foreign',
        organization_id: OTHER_ORG,
        title: 'Foreign',
        tags: ['nature'],
      }),
    ],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

function themeRow({ id, organization_id, label }) {
  return {
    id,
    organization_id,
    slug: id,
    label,
    logo_url: null,
    logo_small_url: null,
    colors: { primary: '#123456' },
    fonts: { body: 'Inter' },
    config: {},
    is_default: false,
    created_by: KEY_OWNER,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}

function imageRow({ id, organization_id, title, tags }) {
  return {
    id,
    organization_id,
    url: `/media/${id}.jpg`,
    title,
    description: `${title} description`,
    photographer: 'Test Photographer',
    tags,
    alts: {},
    sources: [],
    uploaded_by: KEY_OWNER,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}

/**
 * Request context for the resources handler, with the key already
 * authenticated (authenticateApiKey is a different seam with its own tests).
 * @param {string} method - HTTP method
 * @param {string} pathname - Request path
 * @param {Object} [options]
 * @param {string[]} [options.permissions] - API key permissions
 * @returns {Object} ctx, with `res.statusCode` / `res.body` recorded
 */
function makeCtx(method, pathname, { permissions = ['read'] } = {}) {
  const req = Readable.from([]);
  req.method = method;
  req.headers = {};

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
      id: 'key-1',
      tier: 'free',
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
// GET /api/v1/themes
// ---------------------------------------------------------------------------

test('GET /themes returns seed and own organization records, organization first', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/themes');
  assert.equal(await handleResources(ctx), true);

  assert.equal(ctx.res.statusCode, 200);
  const { themes, count } = ctx.res.body;
  assert.equal(count, themes.length);

  const custom = themes.filter((t) => t.source === 'organization');
  const system = themes.filter((t) => t.source === 'seed');
  assert.equal(
    custom.length + system.length,
    themes.length,
    'only two record sources exist',
  );
  assert.equal(system.length, 1);
  assert.ok(
    system.some((t) => t.id === '11111111-1111-4111-8111-111111111111'),
  );
  assert.equal(system[0].isDefault, true);
  assert.deepEqual(
    custom.map((t) => t.id),
    ['theme-own'],
  );
  assert.equal(custom[0].label, 'Own custom theme');

  const firstSystemIndex = themes.findIndex((t) => t.source === 'seed');
  const lastCustomIndex = themes
    .map((t) => t.source)
    .lastIndexOf('organization');
  assert.ok(lastCustomIndex < firstSystemIndex);
});

test("GET /themes never returns another organization's custom theme", async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/themes');
  await handleResources(ctx);

  assert.equal(ctx.res.statusCode, 200);
  assert.ok(
    !ctx.res.body.themes.some((t) => t.id === 'theme-foreign'),
    'the key acts in its own organization only',
  );
});

test('GET /themes without the read permission is refused with 403', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/themes', { permissions: ['write'] });
  assert.equal(await handleResources(ctx), true);
  assert.equal(ctx.res.statusCode, 403);
});

test('POST /themes answers 405 with the allowed methods', async () => {
  await installDb();
  const ctx = makeCtx('POST', '/api/v1/themes');
  await handleResources(ctx);
  assert.equal(ctx.res.statusCode, 405);
  assert.equal(ctx.res.headers.Allow ?? ctx.res.headers.allow, 'GET');
});

// ---------------------------------------------------------------------------
// GET /api/v1/slide-types
// ---------------------------------------------------------------------------

test('GET /slide-types returns every registry type with label and fields', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/slide-types');
  assert.equal(await handleResources(ctx), true);

  assert.equal(ctx.res.statusCode, 200);
  const { slideTypes, count } = ctx.res.body;
  assert.equal(count, Object.keys(SLIDE_TYPES).length);
  assert.deepEqual(
    Object.keys(slideTypes).sort(),
    Object.keys(SLIDE_TYPES).sort(),
  );
  assert.ok(slideTypes['title-slide'].label);
  assert.ok(Array.isArray(slideTypes['title-slide'].fields));
});

test('GET /slide-types without the read permission is refused with 403', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/slide-types', { permissions: [] });
  await handleResources(ctx);
  assert.equal(ctx.res.statusCode, 403);
});

test('the catalogue has no per-type schema route (B504)', async () => {
  // One schema route: /api/v1/schema/slide-types/{id}.json (index.js).
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/slide-types/title-slide/schema');
  assert.equal(await handleResources(ctx), false);
});

// ---------------------------------------------------------------------------
// GET /api/v1/image-library
// ---------------------------------------------------------------------------

test('GET /image-library lists the own organization images with categories', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/image-library');
  assert.equal(await handleResources(ctx), true);

  assert.equal(ctx.res.statusCode, 200);
  const { images, categories, pagination } = ctx.res.body;
  assert.deepEqual(images.map((i) => i.id).sort(), ['img-city', 'img-sea']);
  assert.ok(
    !images.some((i) => i.id === 'img-foreign'),
    'the other organization library stays invisible',
  );
  // Categories are the distinct tags in use — of the own organization only.
  assert.deepEqual(categories, ['nature', 'urban', 'water']);
  assert.deepEqual(pagination, {
    total: 2,
    limit: 50,
    offset: 0,
    hasMore: false,
  });
});

test('GET /image-library?search= matches title, description and tags', async () => {
  await installDb();

  const byTitle = makeCtx('GET', '/api/v1/image-library?search=city');
  await handleResources(byTitle);
  assert.deepEqual(
    byTitle.res.body.images.map((i) => i.id),
    ['img-city'],
  );

  const byTag = makeCtx('GET', '/api/v1/image-library?search=water');
  await handleResources(byTag);
  assert.deepEqual(
    byTag.res.body.images.map((i) => i.id),
    ['img-sea'],
  );

  const noHit = makeCtx(
    'GET',
    '/api/v1/image-library?search=nothing-matches-this',
  );
  await handleResources(noHit);
  assert.deepEqual(noHit.res.body.images, []);
  assert.equal(noHit.res.body.pagination.total, 0);
});

test('GET /image-library?category= filters on a tag', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/image-library?category=nature');
  await handleResources(ctx);

  assert.equal(ctx.res.statusCode, 200);
  assert.deepEqual(
    ctx.res.body.images.map((i) => i.id),
    ['img-sea'],
  );
});

test('GET /image-library paginates with limit and offset', async () => {
  await installDb();
  const first = makeCtx('GET', '/api/v1/image-library?limit=1');
  await handleResources(first);
  assert.equal(first.res.body.images.length, 1);
  assert.deepEqual(first.res.body.pagination, {
    total: 2,
    limit: 1,
    offset: 0,
    hasMore: true,
  });

  const second = makeCtx('GET', '/api/v1/image-library?limit=1&offset=1');
  await handleResources(second);
  assert.equal(second.res.body.images.length, 1);
  assert.equal(second.res.body.pagination.hasMore, false);
  assert.notEqual(second.res.body.images[0].id, first.res.body.images[0].id);
});

test('GET /image-library without the read permission is refused with 403', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/image-library', {
    permissions: ['export'],
  });
  await handleResources(ctx);
  assert.equal(ctx.res.statusCode, 403);
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test('a pathname outside the resources surface is not handled', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/presentations');
  assert.equal(await handleResources(ctx), false);
  assert.equal(ctx.res.statusCode, null, 'no response was written');
});
