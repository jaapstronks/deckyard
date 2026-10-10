/**
 * API v1 slide create with `afterSlideId` inserts in the anchor's group
 * (D325, B429): after a child the new slide is a child of the same parent,
 * after a top-level slide it stays top level. `atIndex` is a position, not
 * an anchor, and never nests.
 *
 * Same in-memory database harness as public-api-v1-slide-details-shape.
 *
 * Run with: node --test tests/public-api-v1-slide-anchor-parent.test.js
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
const DECK_ID = 'd0000429-0000-4000-8000-000000000429';
const S1 = '51000429-0000-4000-8000-000000000001';
const S2 = '51000429-0000-4000-8000-000000000002';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { handleSlides } =
  await import('../server/routes/public-api/v1/slides.js');

/** Install a freshly seeded double (S2 is a child of S1) and point the storage facade at Postgres. */
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
            parentId: S1,
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

const NEW_SLIDE = {
  type: 'content-slide',
  content: { title: 'Nieuw', body: '<p>Tekst.</p>' },
};

/** Create a slide and answer the stored deck's slides. */
async function create(extra) {
  const db = await installDb();
  const res = await send('POST', `/api/v1/presentations/${DECK_ID}/slides`, {
    ...NEW_SLIDE,
    ...extra,
  });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  return { res, slides: db.__tables.presentations[0].slides };
}

test('create after a child slide lands as a child of the same parent', async () => {
  const { res, slides } = await create({ afterSlideId: S2 });
  assert.equal(res.body.index, 2);
  assert.equal(res.body.slide.parentId, S1);
  assert.equal(slides[2].parentId, S1);
});

test('create after a top-level slide stays top level', async () => {
  const { res, slides } = await create({ afterSlideId: S1 });
  assert.equal(res.body.index, 1);
  assert.equal(res.body.slide.parentId, null);
  assert.equal(slides[1].parentId ?? null, null);
});

test('create at an index does not nest, even next to a child', async () => {
  const { res } = await create({ atIndex: 2 });
  assert.equal(res.body.index, 2);
  assert.equal(res.body.slide.parentId, null);
});
