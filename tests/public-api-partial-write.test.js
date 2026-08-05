/**
 * Partial writes must not erase deck-level columns the caller never mentioned.
 *
 * The public API's slide handlers save with `{ slides }` and nothing else. The
 * Postgres adapter built its UPDATE unconditionally, and `jsonb(undefined)`
 * answered an explicit `null`, so one `POST /api/v1/presentations/:id/slides`
 * wiped `i18n`, `settings`, `published` and `description` on a production deck.
 * `title` survived, because Kysely leaves a bare `undefined` out of the SET
 * clause — one field in the same object behaving unlike the four below it is
 * what made this invisible for so long.
 *
 * The rule these tests pin: a column whose source value is `undefined` stays
 * out of the UPDATE, an explicit `null` still clears it. The second half
 * matters as much as the first — unpublishing says `published: null`.
 *
 * Postgres-only bug, so these run against the in-memory database double
 * (tests/helpers/fake-db.js), which models Kysely's undefined-dropping. The
 * file backend rejects a partial body on the missing title before it can lose
 * anything.
 *
 * Run with: node --test tests/public-api-partial-write.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.AUTH_SECRET = ['deckyard', 'test', 'auth'].join('-').padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
// The bug is Postgres-only, so the facade has to dispatch to the Postgres
// adapter. `initializeDatabase()` hands back the double installed by
// `__setTestDb` instead of dialling a server, so no live database is involved.
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const DECK_ID = 'deck-partial-write';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/adapters/index.js');
const { handleSlides } = await import('../server/routes/public-api/v1/slides.js');
const { withPresentations } = await import(
  '../server/storage/adapters/postgres/presentations.js'
);

const PresentationsAdapter = withPresentations(class {});

/**
 * Install a freshly seeded double and point the storage facade at Postgres.
 * @returns {Promise<Object>} The database double.
 */
async function installDb() {
  const db = seedDb();
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

/** The deck-level state a partial write must not touch. */
const STORED_I18N = {
  active: 'nl',
  dominant: 'nl',
  versions: {
    nl: { title: 'Nederlandse titel', slides: [] },
    'en-GB': { title: 'English title', slides: [] },
  },
};
const STORED_SETTINGS = { stepParagraphs: true, revealStyle: 'fade' };
const STORED_PUBLISHED = { id: 'pub-1', slug: 'a-deck', ogImageUrl: '', created: '2026-07-01T00:00:00.000Z' };

/**
 * One deck with every column this bug emptied filled in.
 * @returns {Object} The database double, seeded.
 */
function seedDb() {
  return createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    presentations: [
      {
        id: DECK_ID,
        organization_id: ORG,
        owner_email: OWNER,
        created_by: OWNER,
        updated_by: OWNER,
        title: 'Nederlandse titel',
        description: 'Deck description',
        theme: 'default',
        lang: 'nl',
        scope: 'private',
        revision: 7,
        settings: STORED_SETTINGS,
        i18n: STORED_I18N,
        slides: [{ id: 'slide-1', type: 'title-slide', content: { title: 'Hoi' }, parentId: null }],
        published: STORED_PUBLISHED,
        created_at: '2026-07-01T00:00:00.000Z',
        modified_at: '2026-07-01T00:00:00.000Z',
        trashed_at: null,
      },
    ],
  });
}

/** The stored row, straight from the double. */
function storedDeck(db) {
  return db.__tables.presentations.find((row) => row.id === DECK_ID);
}

/**
 * Request context for the public-API router, with the key already
 * authenticated (authenticateApiKey is a different seam and has its own tests).
 * @param {string} method - HTTP method
 * @param {string} pathname - Request path
 * @param {Object|null} body - JSON body
 * @returns {Object} ctx, with `res.statusCode` / `res.body` recorded
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
    // What authenticateApiKey puts on the context: who is acting and in which
    // workspace. Per-deck checks read the actor from here, not off the deck.
    authedUser: { id: null, email: OWNER, role: 'user', organizationId: ORG },
  };
}

test('POST /api/v1/presentations/:id/slides leaves untouched deck columns alone', async () => {
  const db = await installDb();

  const ctx = makeCtx('POST', `/api/v1/presentations/${DECK_ID}/slides`, {
    type: 'title-slide',
    content: { title: 'Nieuwe slide' },
  });
  await handleSlides(ctx);

  assert.equal(ctx.res.statusCode, 201, `expected 201, got ${ctx.res.statusCode}: ${JSON.stringify(ctx.res.body)}`);

  const row = storedDeck(db);
  assert.equal(row.slides.length, 2, 'the slide the request added is stored');

  // The four columns the incident emptied.
  assert.deepEqual(row.i18n, STORED_I18N, 'i18n survives a partial write');
  assert.deepEqual(row.settings, STORED_SETTINGS, 'settings survives a partial write');
  assert.deepEqual(row.published, STORED_PUBLISHED, 'the deck stays published');
  assert.equal(row.description, 'Deck description', 'description survives a partial write');

  // And the columns a slide write does legitimately move.
  assert.equal(row.title, 'Nederlandse titel', 'title was never in the body either');
  assert.equal(row.revision, 8, 'the revision still increments');
  assert.equal(row.updated_by, OWNER);
});

test('DELETE of a slide leaves untouched deck columns alone', async () => {
  const db = await installDb();
  storedDeck(db).slides = [
    { id: 'slide-1', type: 'title-slide', content: { title: 'Hoi' }, parentId: null },
    { id: 'slide-2', type: 'title-slide', content: { title: 'Twee' }, parentId: null },
  ];

  const ctx = makeCtx('DELETE', `/api/v1/presentations/${DECK_ID}/slides/slide-2`);
  await handleSlides(ctx);

  assert.equal(ctx.res.statusCode, 200, `expected 200, got ${ctx.res.statusCode}: ${JSON.stringify(ctx.res.body)}`);

  const row = storedDeck(db);
  assert.equal(row.slides.length, 1);
  assert.deepEqual(row.i18n, STORED_I18N);
  assert.deepEqual(row.settings, STORED_SETTINGS);
  assert.deepEqual(row.published, STORED_PUBLISHED);
  assert.equal(row.description, 'Deck description');
});

test('POST /slides/reorder leaves untouched deck columns alone', async () => {
  const db = await installDb();
  storedDeck(db).slides = [
    { id: 'slide-1', type: 'title-slide', content: { title: 'Hoi' }, parentId: null },
    { id: 'slide-2', type: 'title-slide', content: { title: 'Twee' }, parentId: null },
  ];

  const ctx = makeCtx('POST', `/api/v1/presentations/${DECK_ID}/slides/reorder`, {
    slideIds: ['slide-2', 'slide-1'],
  });
  await handleSlides(ctx);

  assert.equal(ctx.res.statusCode, 200, `expected 200, got ${ctx.res.statusCode}: ${JSON.stringify(ctx.res.body)}`);

  const row = storedDeck(db);
  assert.deepEqual(row.slides.map((s) => s.id), ['slide-2', 'slide-1']);
  assert.deepEqual(row.i18n, STORED_I18N);
  assert.deepEqual(row.settings, STORED_SETTINGS);
  assert.deepEqual(row.published, STORED_PUBLISHED);
});

test('an explicit null still clears the column', async () => {
  const db = await installDb();

  const adapter = new PresentationsAdapter();
  await adapter.updatePresentation(
    DECK_ID,
    { description: null, settings: null, i18n: null, published: null },
    { organizationId: ORG, actorEmail: OWNER }
  );

  const row = storedDeck(db);
  assert.equal(row.description, null, 'null description clears the column');
  assert.equal(row.settings, null, 'null settings clears the column');
  assert.equal(row.i18n, null, 'null i18n clears the column');
  assert.equal(row.published, null, 'unpublishing writes NULL');
  assert.equal(row.slides.length, 1, 'slides were not mentioned, so they stay');
});

test('a body that mentions nothing but the title moves nothing but the title', async () => {
  const db = await installDb();

  const adapter = new PresentationsAdapter();
  await adapter.updatePresentation(
    DECK_ID,
    { title: 'Andere titel' },
    { organizationId: ORG, actorEmail: OWNER }
  );

  const row = storedDeck(db);
  assert.equal(row.title, 'Andere titel');
  assert.deepEqual(row.i18n, STORED_I18N);
  assert.deepEqual(row.settings, STORED_SETTINGS);
  assert.deepEqual(row.published, STORED_PUBLISHED);
  assert.equal(row.description, 'Deck description');
  assert.equal(row.slides.length, 1);
});
