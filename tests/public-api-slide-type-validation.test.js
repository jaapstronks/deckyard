/**
 * The public API validates and normalizes `slides[].type` in Postgres mode.
 *
 * B26: before the shared write-seam, no write path validated the slide type in
 * Postgres mode — the file backend had `validatePresentation`, the Postgres
 * adapter had nothing, and the whole-deck PUT let any string reach storage. Now
 * every write funnels through `normalizeSlides`, so an unknown type is a 400 and
 * a canonical reverse-DNS id (`eu.deckyard.slide.title`) is stored as the
 * registry key (`title-slide`) — one canonical form persisted, whatever spelling
 * came in. See docs/plans/briefs/one-spelling.md.
 *
 * Postgres-only gap, so these run against the in-memory database double
 * (tests/helpers/fake-db.js), the same harness as public-api-partial-write.
 *
 * Run with: node --test tests/public-api-slide-type-validation.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.AUTH_SECRET = ['deckyard', 'test', 'auth'].join('-').padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const DECK_ID = 'deck-type-validation';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/adapters/index.js');
const { handleSlides } = await import('../server/routes/public-api/v1/slides.js');
const { handlePresentations } = await import(
  '../server/routes/public-api/v1/presentations.js'
);

/** Install a freshly seeded double and point the storage facade at Postgres. */
async function installDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    presentations: [
      {
        id: DECK_ID,
        organization_id: ORG,
        owner_email: OWNER,
        created_by: OWNER,
        updated_by: OWNER,
        title: 'A deck',
        theme: 'default',
        lang: 'nl',
        scope: 'private',
        revision: 1,
        slides: [{ id: 'slide-1', type: 'title-slide', content: { title: 'Hoi' }, parentId: null }],
        created_at: '2026-07-01T00:00:00.000Z',
        modified_at: '2026-07-01T00:00:00.000Z',
        trashed_at: null,
      },
    ],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

/** The stored row, straight from the double. */
function storedDeck(db) {
  return db.__tables.presentations.find((row) => row.id === DECK_ID);
}

/**
 * Request context for the public-API router, with the key already
 * authenticated (authenticateApiKey is a different seam with its own tests).
 */
function makeCtx(method, pathname, body = null) {
  const req = Readable.from(body === null ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.headers = { 'content-type': 'application/json' };

  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status) { this.statusCode = status; },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };

  return {
    req,
    res,
    url: new URL(`http://localhost${pathname}`),
    repoRoot: process.cwd(),
    storageScope: { repoRoot: process.cwd(), organizationId: ORG, actorEmail: OWNER },
    apiKey: { id: 'key-1', tier: 'free', ownerEmail: OWNER, scopes: ['read', 'write'], organizationId: ORG },
  };
}

test('B26: whole-deck PUT with an unknown slide type is rejected with 400', async () => {
  const db = await installDb();

  const ctx = makeCtx('PUT', `/api/v1/presentations/${DECK_ID}`, {
    slides: [{ id: 'slide-1', type: 'not-a-real-type', content: { title: 'x' } }],
  });
  await handlePresentations(ctx);

  assert.equal(ctx.res.statusCode, 400, `expected 400, got ${ctx.res.statusCode}: ${JSON.stringify(ctx.res.body)}`);
  // The junk type never reached storage.
  assert.equal(storedDeck(db).slides[0].type, 'title-slide', 'the stored deck is untouched');
});

test('whole-deck PUT with a canonical id stores the registry key', async () => {
  const db = await installDb();

  const ctx = makeCtx('PUT', `/api/v1/presentations/${DECK_ID}`, {
    slides: [{ id: 'slide-1', type: 'eu.deckyard.slide.title', content: { title: 'x' } }],
  });
  await handlePresentations(ctx);

  assert.equal(ctx.res.statusCode, 200, `expected 200, got ${ctx.res.statusCode}: ${JSON.stringify(ctx.res.body)}`);
  assert.equal(storedDeck(db).slides[0].type, 'title-slide', 'canonical id normalized to the bare key');
});

test('per-slide POST with a canonical id stores the registry key', async () => {
  const db = await installDb();

  const ctx = makeCtx('POST', `/api/v1/presentations/${DECK_ID}/slides`, {
    type: 'eu.deckyard.slide.title',
    content: { title: 'Nieuwe slide' },
  });
  await handleSlides(ctx);

  assert.equal(ctx.res.statusCode, 201, `expected 201, got ${ctx.res.statusCode}: ${JSON.stringify(ctx.res.body)}`);
  const stored = storedDeck(db).slides;
  assert.equal(stored.length, 2, 'the slide was added');
  assert.equal(stored[1].type, 'title-slide', 'canonical id normalized to the bare key on the per-slide path');
});

test('per-slide POST with an unknown type is rejected with 400', async () => {
  const db = await installDb();

  const ctx = makeCtx('POST', `/api/v1/presentations/${DECK_ID}/slides`, {
    type: 'not-a-real-type',
    content: { title: 'x' },
  });
  await handleSlides(ctx);

  assert.equal(ctx.res.statusCode, 400, `expected 400, got ${ctx.res.statusCode}: ${JSON.stringify(ctx.res.body)}`);
  assert.equal(storedDeck(db).slides.length, 1, 'nothing was added');
});
