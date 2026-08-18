/**
 * Contract tests for the public API v1 slide-library module (B40 PR 5+):
 * GET /api/v1/slide-library, GET /api/v1/slide-library/:itemId and
 * POST /api/v1/presentations/:id/slides/from-library.
 *
 * The surface these pin, per docs/openapi.yaml: status codes, the sanitized
 * item shape, org-scoping (a key only sees its own organization's team
 * library), the team/personal split (personal items are invisible on this
 * surface), trash filtering, and the permission gates (`read` for the
 * listing/detail, `write` for copying into a deck).
 * Handler-import level against the database double, like the neighbours
 * (tests/public-api-partial-write.test.js) — no HTTP server involved.
 *
 * Negative assertions pin the status code, not the error envelope: the v1
 * envelope split is a recorded finding (B39 deel 3 bevinding 11) scheduled to
 * converge, and pinning both shapes would cement it.
 *
 * Run with: node --test tests/public-api-v1-slide-library.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.AUTH_SECRET = ['deckyard', 'test', 'auth'].join('-').padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';
const KEY_OWNER = 'owner@example.com';
const DECK_ID = 'deck-from-library';
const FOREIGN_DECK_ID = 'deck-of-someone-else';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/adapters/index.js');
const { handleSlideLibrary } = await import('../server/routes/public-api/v1/slide-library.js');

/**
 * Install a freshly seeded double and point the storage facade at Postgres.
 * @returns {Promise<Object>} The database double.
 */
async function installDb() {
  const db = createFakeDb({
    organizations: [
      { id: ORG, name: 'Default', slug: 'default' },
      { id: OTHER_ORG, name: 'Other', slug: 'other' },
    ],
    slide_library: [
      libraryRow({ id: 'item-team', organization_id: ORG, shelf: 'organization', name: 'Team intro' }),
      libraryRow({ id: 'item-personal', organization_id: ORG, shelf: 'personal', name: 'My draft' }),
      libraryRow({
        id: 'item-trashed',
        organization_id: ORG,
        shelf: 'organization',
        name: 'Old slide',
        trashed_at: '2026-08-01T00:00:00.000Z',
      }),
      libraryRow({ id: 'item-foreign', organization_id: OTHER_ORG, shelf: 'organization', name: 'Foreign' }),
    ],
    tags: [{ id: 'tag-1', organization_id: ORG, name: 'intro' }],
    slide_library_tags: [{ slide_library_id: 'item-team', tag_id: 'tag-1' }],
    presentations: [
      deckRow({ id: DECK_ID, owner: KEY_OWNER }),
      deckRow({ id: FOREIGN_DECK_ID, owner: 'someone-else@example.com' }),
    ],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

function libraryRow({ id, organization_id, shelf, name, trashed_at = null }) {
  return {
    id,
    organization_id,
    shelf,
    owner_email: KEY_OWNER,
    name,
    description: '',
    slide_type: 'content-slide',
    theme_id: null,
    content: { title: `${name} title`, body: 'Library body' },
    i18n: {},
    favorites: [],
    trashed_at,
    trashed_by: null,
    created_by: KEY_OWNER,
    created_by_user_id: null,
    updated_by: KEY_OWNER,
    updated_by_user_id: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
  };
}

function deckRow({ id, owner }) {
  return {
    id,
    organization_id: ORG,
    owner_email: owner,
    created_by: owner,
    updated_by: owner,
    title: id,
    description: null,
    theme: 'default',
    lang: 'nl',
    visibility: 'private',
    revision: 1,
    settings: {},
    i18n: null,
    slides: [
      { id: 'slide-1', type: 'title-slide', content: { title: 'Hoi' }, parentId: null },
      { id: 'slide-2', type: 'content-slide', content: { title: 'Twee' }, parentId: null },
    ],
    published: null,
    created_at: '2026-07-01T00:00:00.000Z',
    modified_at: '2026-07-01T00:00:00.000Z',
    trashed_at: null,
  };
}

/**
 * Request context for the slide-library handler, with the key already
 * authenticated (authenticateApiKey is a different seam with its own tests).
 * @param {string} method - HTTP method
 * @param {string} pathname - Request path
 * @param {Object} [options]
 * @param {Object|null} [options.body] - JSON body
 * @param {string[]} [options.permissions] - API key permissions
 * @returns {Object} ctx, with `res.statusCode` / `res.body` recorded
 */
function makeCtx(method, pathname, { body = null, permissions = ['read', 'write'] } = {}) {
  const req = Readable.from(body === null ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.headers = { 'content-type': 'application/json' };

  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };

  return {
    req,
    res,
    url: new URL(`http://localhost${pathname}`),
    repoRoot: process.cwd(),
    storageScope: { repoRoot: process.cwd(), organizationId: ORG, actorEmail: KEY_OWNER },
    apiKey: { id: 'key-1', tier: 'free', ownerEmail: KEY_OWNER, permissions, organizationId: ORG },
    authedUser: { id: null, email: KEY_OWNER, role: 'user', organizationId: ORG },
  };
}

function storedDeck(db) {
  return db.__tables.presentations.find((row) => row.id === DECK_ID);
}

// ---------------------------------------------------------------------------
// GET /api/v1/slide-library
// ---------------------------------------------------------------------------

test('GET /slide-library lists team items of the own organization only', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/slide-library');
  assert.equal(await handleSlideLibrary(ctx), true);

  assert.equal(ctx.res.statusCode, 200);
  const { items, pagination } = ctx.res.body;
  assert.deepEqual(items.map((it) => it.id), ['item-team']);
  assert.equal(
    items.some((it) => it.id === 'item-personal'),
    false,
    'personal items never appear on the team surface'
  );
  assert.equal(items.some((it) => it.id === 'item-trashed'), false, 'trash stays out');
  assert.equal(items.some((it) => it.id === 'item-foreign'), false, 'other organizations stay out');
  assert.deepEqual(pagination, { total: 1, limit: 50, offset: 0, hasMore: false });

  const item = items[0];
  assert.equal(item.name, 'Team intro');
  assert.equal(item.slideType, 'content-slide');
  assert.deepEqual(item.content, { title: 'Team intro title', body: 'Library body' });
  // Pins current behaviour: tags come back as {id, name} objects while
  // docs/openapi.yaml documents an array of strings — recorded as a B40
  // finding (tag shape), not silently fixed here.
  assert.deepEqual(item.tags, [{ id: 'tag-1', name: 'intro' }]);
});

test('GET /slide-library without the read permission is refused with 403', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/slide-library', { permissions: ['write'] });
  await handleSlideLibrary(ctx);
  assert.equal(ctx.res.statusCode, 403);
});

test('POST /slide-library answers 405 with the allowed methods', async () => {
  await installDb();
  const ctx = makeCtx('POST', '/api/v1/slide-library');
  await handleSlideLibrary(ctx);
  assert.equal(ctx.res.statusCode, 405);
  assert.equal(ctx.res.headers.Allow ?? ctx.res.headers.allow, 'GET');
});

// ---------------------------------------------------------------------------
// GET /api/v1/slide-library/:itemId
// ---------------------------------------------------------------------------

test('GET /slide-library/:itemId returns the sanitized item', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/slide-library/item-team');
  assert.equal(await handleSlideLibrary(ctx), true);

  assert.equal(ctx.res.statusCode, 200);
  const { item } = ctx.res.body;
  assert.equal(item.id, 'item-team');
  assert.equal(item.name, 'Team intro');
  assert.equal(item.slideType, 'content-slide');
  assert.deepEqual(
    Object.keys(item).sort(),
    ['content', 'createdAt', 'createdBy', 'id', 'name', 'slideType', 'tags', 'themeId'],
    'the sanitizer strips everything else (ownerEmail, favorites, i18n, …)'
  );
});

test('GET /slide-library/:itemId answers 404 for unknown, trashed, personal and foreign items', async () => {
  await installDb();
  for (const itemId of ['nope', 'item-trashed', 'item-personal', 'item-foreign']) {
    const ctx = makeCtx('GET', `/api/v1/slide-library/${itemId}`);
    await handleSlideLibrary(ctx);
    assert.equal(ctx.res.statusCode, 404, `${itemId} must be invisible`);
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/presentations/:id/slides/from-library
// ---------------------------------------------------------------------------

test('POST /slides/from-library copies the item into the deck and answers 201', async () => {
  const db = await installDb();
  const ctx = makeCtx('POST', `/api/v1/presentations/${DECK_ID}/slides/from-library`, {
    body: { libraryItemId: 'item-team' },
  });
  assert.equal(await handleSlideLibrary(ctx), true);

  assert.equal(ctx.res.statusCode, 201);
  const body = ctx.res.body;
  assert.equal(body.slide.type, 'content-slide');
  assert.deepEqual(body.slide.content, { title: 'Team intro title', body: 'Library body' });
  assert.equal(body.index, 2, 'appends at the end by default');
  assert.deepEqual(body.copiedFrom, { libraryItemId: 'item-team', libraryItemName: 'Team intro' });
  assert.equal(body.presentation.id, DECK_ID);
  assert.equal(body.presentation.slideCount, 3);

  const stored = storedDeck(db);
  assert.equal(stored.slides.length, 3);
  assert.equal(stored.slides[2].content.title, 'Team intro title');
  assert.notEqual(stored.slides[2].id, 'item-team', 'the copy gets a fresh slide id');
});

test('POST /slides/from-library honours atIndex', async () => {
  const db = await installDb();
  const ctx = makeCtx('POST', `/api/v1/presentations/${DECK_ID}/slides/from-library`, {
    body: { libraryItemId: 'item-team', atIndex: 0 },
  });
  await handleSlideLibrary(ctx);

  assert.equal(ctx.res.statusCode, 201);
  assert.equal(ctx.res.body.index, 0);
  assert.equal(storedDeck(db).slides[0].content.title, 'Team intro title');
});

test('POST /slides/from-library without libraryItemId answers 400', async () => {
  const db = await installDb();
  const ctx = makeCtx('POST', `/api/v1/presentations/${DECK_ID}/slides/from-library`, {
    body: {},
  });
  await handleSlideLibrary(ctx);
  assert.equal(ctx.res.statusCode, 400);
  assert.equal(storedDeck(db).slides.length, 2, 'the deck is untouched');
});

test('POST /slides/from-library answers 404 for an invisible library item', async () => {
  await installDb();
  for (const libraryItemId of ['nope', 'item-trashed', 'item-foreign']) {
    const ctx = makeCtx('POST', `/api/v1/presentations/${DECK_ID}/slides/from-library`, {
      body: { libraryItemId },
    });
    await handleSlideLibrary(ctx);
    assert.equal(ctx.res.statusCode, 404, `${libraryItemId} must be invisible`);
  }
});

test('POST /slides/from-library without the write permission is refused with 403', async () => {
  const db = await installDb();
  const ctx = makeCtx('POST', `/api/v1/presentations/${DECK_ID}/slides/from-library`, {
    body: { libraryItemId: 'item-team' },
    permissions: ['read'],
  });
  await handleSlideLibrary(ctx);
  assert.equal(ctx.res.statusCode, 403);
  assert.equal(storedDeck(db).slides.length, 2, 'the deck is untouched');
});

test("POST /slides/from-library into someone else's private deck is refused with 403", async () => {
  const db = await installDb();
  const ctx = makeCtx('POST', `/api/v1/presentations/${FOREIGN_DECK_ID}/slides/from-library`, {
    body: { libraryItemId: 'item-team' },
  });
  await handleSlideLibrary(ctx);
  assert.equal(ctx.res.statusCode, 403);
  const stored = db.__tables.presentations.find((row) => row.id === FOREIGN_DECK_ID);
  assert.equal(stored.slides.length, 2, 'the foreign deck is untouched');
});

test('POST /slides/from-library into an unknown deck answers 404', async () => {
  await installDb();
  const ctx = makeCtx('POST', '/api/v1/presentations/never-a-deck/slides/from-library', {
    body: { libraryItemId: 'item-team' },
  });
  await handleSlideLibrary(ctx);
  assert.equal(ctx.res.statusCode, 404);
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test('a pathname outside the slide-library surface is not handled', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/presentations');
  assert.equal(await handleSlideLibrary(ctx), false);
  assert.equal(ctx.res.statusCode, null, 'no response was written');
});
