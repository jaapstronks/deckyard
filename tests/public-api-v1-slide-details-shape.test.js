/**
 * API v1 slide writes refuse invalid slide data with `details` as an object
 * (B460). The `Error` schema in `openapi.yaml` says `details: object`, and every
 * other v1 refusal sends one; `validateSlide`'s sentences travel as
 * `details.errors`, never as a bare array in `details`.
 *
 * Same in-memory database harness as public-api-v1-slide-type-change.
 *
 * Run with: node --test tests/public-api-v1-slide-details-shape.test.js
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
const DECK_ID = 'd0000460-0000-4000-8000-000000000460';
const S1 = '51000460-0000-4000-8000-000000000001';
const S2 = '51000460-0000-4000-8000-000000000002';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { handleSlides } =
  await import('../server/routes/public-api/v1/slides.js');

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

/** Send one request through the v1 slide router. */
async function send(method, pathname, payload) {
  const ctx = makeCtx(method, pathname, payload);
  await handleSlides(ctx);
  return ctx.res;
}

/** The refusal envelope for invalid slide data, with `details` an object. */
function assertInvalidSlideData(res) {
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.message, 'Invalid slide data');
  assert.equal(typeof res.body.details, 'object');
  assert.ok(!Array.isArray(res.body.details), 'details must not be an array');
  assert.ok(Array.isArray(res.body.details.errors));
  assert.ok(res.body.details.errors.length > 0);
  for (const e of res.body.details.errors) assert.equal(typeof e, 'string');
}

// An unknown visibility key is a validateSlide error that both routes reach.
const BAD_VISIBILITY = { hideEverywhere: true };

test('create: invalid slide data answers details as an object', async () => {
  await installDb();
  const res = await send('POST', `/api/v1/presentations/${DECK_ID}/slides`, {
    type: 'content-slide',
    content: { title: 'Nieuw', body: '<p>Tekst.</p>' },
    visibility: BAD_VISIBILITY,
  });
  assertInvalidSlideData(res);
});

test('update: invalid slide data answers details as an object', async () => {
  await installDb();
  const res = await send(
    'PUT',
    `/api/v1/presentations/${DECK_ID}/slides/${S2}`,
    { visibility: BAD_VISIBILITY },
  );
  assertInvalidSlideData(res);
});
