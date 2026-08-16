/**
 * Contract tests for the public API v1 publishing module (B40 PR 5+):
 * POST/GET/DELETE /api/v1/presentations/:id/publish.
 *
 * The surface these pin, per docs/openapi.yaml: status codes, the publish
 * response (publishId/slug/path/ogImageUrl), status reporting for published
 * and unpublished decks, the unpublish round-trip (entry removed, deck column
 * cleared with an explicit null), and the gates (`write` to publish and
 * unpublish, `read` for status; write access on the deck itself).
 * Handler-import level against the database double, like the neighbours
 * (tests/public-api-partial-write.test.js) — no HTTP server involved. The
 * media provider is not initialized under test, so the OG-image path takes
 * the documented fallback ladder instead of rendering a preview.
 *
 * The known divergence from the internal publish route — no sandbox refusal,
 * no presentation.published webhook — is already recorded in the B39 brief
 * (§ Vondsten, item 8) and deliberately not pinned here: these tests describe
 * the contract, not the divergence.
 *
 * Negative assertions pin the status code, not the error envelope: the v1
 * envelope split is a recorded finding (B39 deel 3 bevinding 11) scheduled to
 * converge, and pinning both shapes would cement it.
 *
 * Run with: node --test tests/public-api-v1-publishing.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.AUTH_SECRET = ['deckyard', 'test', 'auth'].join('-').padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const KEY_OWNER = 'owner@example.com';
const DECK_ID = 'deck-to-publish';
const PUBLISHED_DECK_ID = 'deck-already-published';
const FOREIGN_DECK_ID = 'deck-of-someone-else';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/adapters/index.js');
const { handlePublishing } = await import('../server/routes/public-api/v1/publishing.js');

const STORED_PUBLISHED = {
  id: 'pub-aaaa',
  slug: 'deck-already-published',
  ogImageUrl: '/media/og-existing.png',
  created: '2026-07-01T00:00:00.000Z',
  modified: '2026-07-01T00:00:00.000Z',
};

/**
 * Install a freshly seeded double and point the storage facade at Postgres.
 * @returns {Promise<Object>} The database double.
 */
async function installDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    presentations: [
      deckRow({ id: DECK_ID, owner: KEY_OWNER }),
      deckRow({ id: PUBLISHED_DECK_ID, owner: KEY_OWNER, published: STORED_PUBLISHED }),
      deckRow({ id: FOREIGN_DECK_ID, owner: 'someone-else@example.com' }),
    ],
    published_presentations: [
      {
        id: STORED_PUBLISHED.id,
        organization_id: ORG,
        presentation_id: PUBLISHED_DECK_ID,
        title: 'Already published',
        slug: STORED_PUBLISHED.slug,
        og_image_url: STORED_PUBLISHED.ogImageUrl,
        created_at: '2026-07-01T00:00:00.000Z',
        modified_at: '2026-07-01T00:00:00.000Z',
      },
    ],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

function deckRow({ id, owner, published = null }) {
  return {
    id,
    organization_id: ORG,
    owner_email: owner,
    created_by: owner,
    updated_by: owner,
    title: `Title of ${id}`,
    description: null,
    theme: 'default',
    lang: 'nl',
    visibility: 'private',
    revision: 1,
    settings: {},
    i18n: null,
    slides: [
      {
        id: 'slide-1',
        type: 'image-slide',
        content: { title: 'Hoi', image: '/media/first-slide.jpg' },
        parentId: null,
      },
    ],
    published,
    created_at: '2026-07-01T00:00:00.000Z',
    modified_at: '2026-07-01T00:00:00.000Z',
    trashed_at: null,
  };
}

/**
 * Request context for the publishing handler, with the key already
 * authenticated (authenticateApiKey is a different seam with its own tests).
 * @param {string} method - HTTP method
 * @param {string} deckId - Presentation id in the path
 * @param {Object} [options]
 * @param {string[]} [options.permissions] - API key permissions
 * @returns {Object} ctx, with `res.statusCode` / `res.body` recorded
 */
function makeCtx(method, deckId, { permissions = ['read', 'write'] } = {}) {
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
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };

  return {
    req,
    res,
    url: new URL(`http://localhost/api/v1/presentations/${deckId}/publish`),
    repoRoot: process.cwd(),
    storageScope: { repoRoot: process.cwd(), organizationId: ORG, actorEmail: KEY_OWNER },
    apiKey: { id: 'key-1', tier: 'free', ownerEmail: KEY_OWNER, permissions, organizationId: ORG },
    authedUser: { id: null, email: KEY_OWNER, role: 'user', organizationId: ORG },
  };
}

function storedDeck(db, id) {
  return db.__tables.presentations.find((row) => row.id === id);
}

function publishRows(db) {
  return db.__tables.published_presentations;
}

// ---------------------------------------------------------------------------
// POST /api/v1/presentations/:id/publish
// ---------------------------------------------------------------------------

test('POST /publish publishes the deck and answers the public path', async () => {
  const db = await installDb();
  const ctx = makeCtx('POST', DECK_ID);
  assert.equal(await handlePublishing(ctx), true);

  assert.equal(ctx.res.statusCode, 200);
  const body = ctx.res.body;
  assert.ok(body.publishId, 'a publish id is minted');
  assert.equal(body.slug, 'title-of-deck-to-publish');
  assert.equal(body.path, `/p/${body.publishId}-${body.slug}`);
  // No media provider under test: the OG image comes off the fallback ladder,
  // here the first slide's own image.
  assert.equal(body.ogImageUrl, '/media/first-slide.jpg');

  const entry = publishRows(db).find((row) => row.presentation_id === DECK_ID);
  assert.ok(entry, 'a publish entry row was written');
  assert.equal(entry.id, body.publishId);

  const stored = storedDeck(db, DECK_ID);
  assert.equal(stored.published.id, body.publishId, 'the deck document carries the publish state');
  assert.equal(stored.published.slug, body.slug);
});

test('POST /publish on an already-published deck reuses the publish id', async () => {
  const db = await installDb();
  const ctx = makeCtx('POST', PUBLISHED_DECK_ID);
  await handlePublishing(ctx);

  assert.equal(ctx.res.statusCode, 200);
  assert.equal(ctx.res.body.publishId, STORED_PUBLISHED.id, 'republish keeps the public link stable');
  assert.equal(
    publishRows(db).filter((row) => row.presentation_id === PUBLISHED_DECK_ID).length,
    1,
    'no second entry appears'
  );
});

test('POST /publish without the write permission is refused with 403', async () => {
  const db = await installDb();
  const ctx = makeCtx('POST', DECK_ID, { permissions: ['read'] });
  await handlePublishing(ctx);
  assert.equal(ctx.res.statusCode, 403);
  assert.equal(storedDeck(db, DECK_ID).published, null, 'the deck stays unpublished');
});

test("POST /publish on someone else's private deck is refused with 403", async () => {
  const db = await installDb();
  const ctx = makeCtx('POST', FOREIGN_DECK_ID);
  await handlePublishing(ctx);
  assert.equal(ctx.res.statusCode, 403);
  assert.equal(storedDeck(db, FOREIGN_DECK_ID).published, null, 'the foreign deck stays unpublished');
});

test('POST /publish on an unknown deck answers 404', async () => {
  await installDb();
  const ctx = makeCtx('POST', 'never-a-deck');
  await handlePublishing(ctx);
  assert.equal(ctx.res.statusCode, 404);
});

// ---------------------------------------------------------------------------
// GET /api/v1/presentations/:id/publish
// ---------------------------------------------------------------------------

test('GET /publish reports a published deck with its public path', async () => {
  await installDb();
  const ctx = makeCtx('GET', PUBLISHED_DECK_ID);
  assert.equal(await handlePublishing(ctx), true);

  assert.equal(ctx.res.statusCode, 200);
  assert.deepEqual(ctx.res.body, {
    isPublished: true,
    publishId: STORED_PUBLISHED.id,
    slug: STORED_PUBLISHED.slug,
    path: `/p/${STORED_PUBLISHED.id}-${STORED_PUBLISHED.slug}`,
    ogImageUrl: STORED_PUBLISHED.ogImageUrl,
    publishedAt: STORED_PUBLISHED.created,
  });
});

test('GET /publish reports an unpublished deck as isPublished false', async () => {
  await installDb();
  const ctx = makeCtx('GET', DECK_ID);
  await handlePublishing(ctx);

  assert.equal(ctx.res.statusCode, 200);
  assert.deepEqual(ctx.res.body, { isPublished: false });
});

test('GET /publish without the read permission is refused with 403', async () => {
  await installDb();
  const ctx = makeCtx('GET', PUBLISHED_DECK_ID, { permissions: ['write'] });
  await handlePublishing(ctx);
  assert.equal(ctx.res.statusCode, 403);
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/presentations/:id/publish
// ---------------------------------------------------------------------------

test('DELETE /publish removes the entry and clears the deck column', async () => {
  const db = await installDb();
  const ctx = makeCtx('DELETE', PUBLISHED_DECK_ID);
  assert.equal(await handlePublishing(ctx), true);

  assert.equal(ctx.res.statusCode, 200);
  assert.deepEqual(ctx.res.body, { unpublished: true });

  assert.equal(
    publishRows(db).some((row) => row.presentation_id === PUBLISHED_DECK_ID),
    false,
    'the publish entry is gone'
  );
  // An explicit null, not a dropped key: the storage layer reads an absent
  // key as "leave this column alone" (see the partial-write tests).
  assert.equal(storedDeck(db, PUBLISHED_DECK_ID).published, null);
});

test('DELETE /publish on an unpublished deck still answers 200', async () => {
  await installDb();
  const ctx = makeCtx('DELETE', DECK_ID);
  await handlePublishing(ctx);

  assert.equal(ctx.res.statusCode, 200);
  assert.deepEqual(ctx.res.body, { unpublished: true }, 'unpublish is idempotent');
});

test('DELETE /publish without the write permission is refused with 403', async () => {
  const db = await installDb();
  const ctx = makeCtx('DELETE', PUBLISHED_DECK_ID, { permissions: ['read'] });
  await handlePublishing(ctx);
  assert.equal(ctx.res.statusCode, 403);
  assert.ok(
    publishRows(db).some((row) => row.presentation_id === PUBLISHED_DECK_ID),
    'the publish entry survives'
  );
});

test("DELETE /publish on someone else's private deck is refused with 403", async () => {
  await installDb();
  const ctx = makeCtx('DELETE', FOREIGN_DECK_ID);
  await handlePublishing(ctx);
  assert.equal(ctx.res.statusCode, 403);
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test('PATCH /publish answers 405 with the allowed methods', async () => {
  await installDb();
  const ctx = makeCtx('PATCH', DECK_ID);
  await handlePublishing(ctx);
  assert.equal(ctx.res.statusCode, 405);
  assert.equal(ctx.res.headers.Allow ?? ctx.res.headers.allow, 'GET, POST, DELETE');
});

test('a pathname outside the publish surface is not handled', async () => {
  await installDb();
  const ctx = makeCtx('GET', DECK_ID);
  ctx.url = new URL(`http://localhost/api/v1/presentations/${DECK_ID}`);
  assert.equal(await handlePublishing(ctx), false);
  assert.equal(ctx.res.statusCode, null, 'no response was written');
});
