/**
 * Contract tests for the public API v1 publishing module:
 * POST/GET/DELETE /api/v1/presentations/:id/publish (T1.5: publishing makes
 * an edition, unpublishing revokes the deck's editions).
 *
 * Handler-import level against the database double, no HTTP server. The
 * double has no render bundle and runs no raw SQL, so what it covers is what
 * the route decides before an edition is sealed or revoked: the key's
 * permission, the body, the deck's write access and existence, and the status
 * read from the edition tables. Sealing, the commit, idempotent replays and
 * revocation run against real PostgreSQL in
 * tests/pg/publication-editions.pgtest.js and the T1.5 pg tests.
 *
 * Negative assertions here pin the status code; the v1 error envelope itself is
 * covered by tests/public-api-v1-error-envelope.test.js.
 *
 * Run with: node --test tests/public-api-v1-publishing.test.js
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
const KEY_OWNER = 'owner@example.com';
const DECK_ID = 'd000000a-0000-4000-8000-00000000000a';
const PUBLISHED_DECK_ID = 'd000000b-0000-4000-8000-00000000000b';
const FOREIGN_DECK_ID = 'd000000c-0000-4000-8000-00000000000c';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { handlePublishing } =
  await import('../server/routes/public-api/v1/publishing.js');

const PUBLICATION = 'e000000b-0000-4000-8000-00000000000b';
const PUBLISHED_AT = '2026-10-31T08:00:00.000Z';
const EDITION_2 = 'e000000b-0000-4000-8000-000000000102';

/**
 * Install a freshly seeded double and point the storage facade at Postgres.
 * @returns {Promise<Object>} The database double.
 */
async function installDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(KEY_OWNER, 'someone-else@example.com'),
    presentations: [
      deckRow({ id: DECK_ID, owner: KEY_OWNER }),
      deckRow({ id: PUBLISHED_DECK_ID, owner: KEY_OWNER }),
      deckRow({ id: FOREIGN_DECK_ID, owner: 'someone-else@example.com' }),
    ],
    // The published deck's series, at version 2. Which of several editions
    // is the newest public one is a DISTINCT ON the double does not model;
    // the PostgreSQL suite covers it.
    publications: [
      {
        id: PUBLICATION,
        organization_id: ORG,
        presentation_id: PUBLISHED_DECK_ID,
        last_version: 2,
      },
    ],
    publication_editions: [
      {
        id: EDITION_2,
        publication_id: PUBLICATION,
        organization_id: ORG,
        version: 2,
        published_at: PUBLISHED_AT,
      },
    ],
    publication_edition_revocations: [],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

function deckRow({ id, owner }) {
  return {
    id,
    organization_id: ORG,
    owner_email: owner,
    created_by: owner,
    updated_by: owner,
    // Ownership is decided on the id, not the address (identity-match.js).
    owner_user_id: userIdFor(owner),
    created_by_user_id: userIdFor(owner),
    updated_by_user_id: userIdFor(owner),
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
        content: {
          title: 'Hoi',
          image: '/media/first-slide.jpg',
          alt: 'The harbour at first light',
        },
        parentId: null,
      },
    ],
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
function makeCtx(
  method,
  deckId,
  { permissions = ['read', 'write'], body = null } = {},
) {
  const req = Readable.from(
    body == null ? [] : [Buffer.from(JSON.stringify(body))],
  );
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
    url: new URL(`http://localhost/api/v1/presentations/${deckId}/publish`),
    repoRoot: process.cwd(),
    storageScope: {
      repoRoot: process.cwd(),
      organizationId: ORG,
      actorUserId: userIdFor(KEY_OWNER),
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
      // The middleware resolves the key owner to this id once per request.
      id: userIdFor(KEY_OWNER),
      email: KEY_OWNER,
      role: 'user',
      organizationId: ORG,
    },
  };
}

/** No edition was made: the double never sees a staging or edition write. */
function assertNothingPublished(db) {
  assert.equal(db.__tables.publication_editions.length, 1);
  assert.equal(db.__tables.publication_staging?.length ?? 0, 0);
}

const BODY = { expectedRevision: 1, idempotencyKey: 'intent-1' };

// ---------------------------------------------------------------------------
// POST /api/v1/presentations/:id/publish
// ---------------------------------------------------------------------------

test('POST /publish without the write permission is refused with 403', async () => {
  const db = await installDb();
  const ctx = makeCtx('POST', DECK_ID, { permissions: ['read'], body: BODY });
  await handlePublishing(ctx);
  assert.equal(ctx.res.statusCode, 403);
  assertNothingPublished(db);
});

test('POST /publish without a body is refused with 400', async () => {
  const db = await installDb();
  const ctx = makeCtx('POST', DECK_ID);
  await handlePublishing(ctx);
  assert.equal(ctx.res.statusCode, 400);
  assertNothingPublished(db);
});

test('POST /publish names the field that is missing or wrong', async () => {
  const db = await installDb();
  for (const [body, field] of [
    [{ idempotencyKey: 'k' }, 'expectedRevision'],
    [{ expectedRevision: 0, idempotencyKey: 'k' }, 'expectedRevision'],
    [{ expectedRevision: 1 }, 'idempotencyKey'],
    [{ expectedRevision: 1, idempotencyKey: '' }, 'idempotencyKey'],
    [
      { expectedRevision: 1, idempotencyKey: 'k'.repeat(201) },
      'idempotencyKey',
    ],
  ]) {
    const ctx = makeCtx('POST', DECK_ID, { body });
    await handlePublishing(ctx);
    assert.equal(ctx.res.statusCode, 400, JSON.stringify(body));
    assert.equal(
      ctx.res.body.error?.details?.field ?? ctx.res.body.details?.field,
      field,
    );
  }
  assertNothingPublished(db);
});

test("POST /publish on someone else's private deck is refused with 403", async () => {
  const db = await installDb();
  const ctx = makeCtx('POST', FOREIGN_DECK_ID, { body: BODY });
  await handlePublishing(ctx);
  assert.equal(ctx.res.statusCode, 403);
  assertNothingPublished(db);
});

test('POST /publish on an unknown deck answers 404', async () => {
  await installDb();
  const ctx = makeCtx('POST', '00000000-0000-4000-8000-00000000dead', {
    body: BODY,
  });
  await handlePublishing(ctx);
  assert.equal(ctx.res.statusCode, 404);
});

test('POST /publish is refused in sandbox mode before the body is read', async () => {
  const db = await installDb();
  const prev = process.env.SANDBOX_MODE;
  process.env.SANDBOX_MODE = 'true';
  try {
    const ctx = makeCtx('POST', DECK_ID, { body: BODY });
    await handlePublishing(ctx);
    assert.equal(ctx.res.statusCode, 403);
  } finally {
    if (prev === undefined) delete process.env.SANDBOX_MODE;
    else process.env.SANDBOX_MODE = prev;
  }
  assertNothingPublished(db);
});

// ---------------------------------------------------------------------------
// GET /api/v1/presentations/:id/publish
// ---------------------------------------------------------------------------

test('GET /publish reports the newest public edition', async () => {
  await installDb();
  const ctx = makeCtx('GET', PUBLISHED_DECK_ID);
  assert.equal(await handlePublishing(ctx), true);

  assert.equal(ctx.res.statusCode, 200);
  assert.deepEqual(ctx.res.body, {
    isPublished: true,
    publicationId: PUBLICATION,
    version: 2,
    path: `/p/${PUBLICATION}/2`,
    publishedAt: PUBLISHED_AT,
  });
});

test('GET /publish reports a deck whose editions are all revoked as unpublished', async () => {
  const db = await installDb();
  db.__tables.publication_edition_revocations.push({
    edition_id: EDITION_2,
    organization_id: ORG,
  });
  const ctx = makeCtx('GET', PUBLISHED_DECK_ID);
  await handlePublishing(ctx);
  assert.deepEqual(ctx.res.body, { isPublished: false });
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

test('DELETE /publish without the write permission is refused with 403', async () => {
  const db = await installDb();
  const ctx = makeCtx('DELETE', PUBLISHED_DECK_ID, { permissions: ['read'] });
  await handlePublishing(ctx);
  assert.equal(ctx.res.statusCode, 403);
  assert.equal(db.__tables.publication_edition_revocations.length, 0);
});

test("DELETE /publish on someone else's private deck is refused with 403", async () => {
  const db = await installDb();
  const ctx = makeCtx('DELETE', FOREIGN_DECK_ID);
  await handlePublishing(ctx);
  assert.equal(ctx.res.statusCode, 403);
  assert.equal(db.__tables.publication_edition_revocations.length, 0);
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test('PATCH /publish answers 405 with the allowed methods', async () => {
  await installDb();
  const ctx = makeCtx('PATCH', DECK_ID);
  await handlePublishing(ctx);
  assert.equal(ctx.res.statusCode, 405);
  assert.equal(
    ctx.res.headers.Allow ?? ctx.res.headers.allow,
    'GET, POST, DELETE',
  );
});

test('a pathname outside the publish surface is not handled', async () => {
  await installDb();
  const ctx = makeCtx('GET', DECK_ID);
  ctx.url = new URL(`http://localhost/api/v1/presentations/${DECK_ID}`);
  assert.equal(await handlePublishing(ctx), false);
  assert.equal(ctx.res.statusCode, null, 'no response was written');
});
