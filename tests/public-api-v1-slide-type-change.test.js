/**
 * API v1 `PUT /slides/:slideId` changes a slide's type the way MCP
 * `update_slide` and the editor do (B458, D97).
 *
 * A `type` without `content` is a conversion: `convertSlideToType` re-seeds the
 * content for the target type and carries over what maps. A pair the model has
 * no mapping for is refused with 400 `unsupported_conversion` and the pair plus
 * what the slide does convert to in `details` - never the old type's content
 * stored under the new name. A `type` with `content` replaces the slide
 * outright, so nothing converts.
 *
 * Same in-memory database harness as public-api-slide-type-validation.
 *
 * Run with: node --test tests/public-api-v1-slide-type-change.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { Readable } from 'node:stream';

process.env.AUTH_SECRET = ['deckyard', 'test', 'auth']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const DECK_ID = 'd0000458-0000-4000-8000-000000000458';
const S1 = '51000458-0000-4000-8000-000000000001';
const S2 = '51000458-0000-4000-8000-000000000002';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { handleSlides } =
  await import('../server/routes/public-api/v1/slides.js');
const { canonicalSlideType } = await import('../shared/slide-types.js');

/** Install a freshly seeded double and point the storage facade at Postgres. */
async function installDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER),
    presentations: [
      {
        id: DECK_ID,
        organization_id: ORG,
        owner_email: OWNER,
        created_by: OWNER,
        updated_by: OWNER,
        // Ownership is decided on the id, not the address (identity-match.js).
        owner_user_id: userIdFor(OWNER),
        created_by_user_id: userIdFor(OWNER),
        updated_by_user_id: userIdFor(OWNER),
        title: 'A deck',
        theme: 'default',
        lang: 'nl',
        visibility: 'private',
        revision: 1,
        slides: [
          {
            id: S1,
            type: 'title-slide',
            content: { title: 'Hoi' },
            parentId: null,
          },
          {
            id: S2,
            type: 'content-slide',
            content: {
              title: 'Waarom',
              body: '<p>Omdat.</p>',
              layout: 'one-column',
            },
            parentId: null,
          },
        ],
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
    writeHead(status) {
      this.statusCode = status;
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
      actorUserId: userIdFor(OWNER),
      actorEmail: OWNER,
    },
    apiKey: {
      id: 'key-1',
      tier: 'free',
      ownerEmail: OWNER,
      permissions: ['read', 'write'],
      organizationId: ORG,
    },
    // What authenticateApiKey puts on the context: who is acting and in which
    // organization. Per-deck checks read the actor from here, not off the deck.
    authedUser: {
      // The middleware resolves the key owner to this id once per request.
      id: userIdFor(OWNER),
      email: OWNER,
      role: 'user',
      organizationId: ORG,
    },
  };
}

/** PUT one slide through the v1 router. */
async function putSlide(slideId, payload) {
  const ctx = makeCtx(
    'PUT',
    `/api/v1/presentations/${DECK_ID}/slides/${slideId}`,
    payload,
  );
  await handleSlides(ctx);
  return ctx.res;
}

test('a type change without content converts the slide', async () => {
  const db = await installDb();

  const res = await putSlide(S2, {
    type: 'eu.deckyard.slide.image-text',
  });

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const stored = storedDeck(db).slides[1];
  assert.equal(stored.type, 'image-text-slide');
  assert.equal(stored.content.title, 'Waarom', 'the title carries over');
  assert.equal(stored.content.body, '<p>Omdat.</p>', 'the body carries over');
  // Re-seeded for the target: its own keys are there, and the source's
  // one/two-column `layout` did not survive under the new name.
  assert.equal(typeof stored.content.imageSide, 'string');
  assert.notEqual(stored.content.layout, 'one-column');
  assert.equal(res.body.slide.type, 'eu.deckyard.slide.image-text');
});

test('a type change the model cannot convert is refused, and nothing is stored', async () => {
  const db = await installDb();
  const before = structuredClone(storedDeck(db).slides);

  const res = await putSlide(S1, { type: 'content-slide' });

  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.error, 'unsupported_conversion');
  assert.deepEqual(res.body.details, {
    from: canonicalSlideType('title-slide'),
    to: canonicalSlideType('content-slide'),
    convertible: [canonicalSlideType('chapter-title-slide')],
  });
  assert.deepEqual(storedDeck(db).slides, before, 'the deck is untouched');
});

test('a type change with content replaces the slide without converting', async () => {
  const db = await installDb();

  const res = await putSlide(S1, {
    type: 'content-slide',
    content: { title: 'Nieuw', body: '<p>Vervangen.</p>' },
  });

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const stored = storedDeck(db).slides[0];
  assert.equal(stored.type, 'content-slide');
  assert.equal(stored.content.title, 'Nieuw');
  assert.equal(stored.content.body, '<p>Vervangen.</p>');
});
