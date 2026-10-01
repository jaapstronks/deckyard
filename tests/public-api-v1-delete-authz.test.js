/**
 * B519 — `DELETE /api/v1/presentations/:id` decides on the owner, not on an
 * address.
 *
 * The v1 route used to compare the deck's `ownerEmail` with the key owner's
 * address by hand. That ignored `ownerId`, the only key ownership is decided on
 * (D22), and it let any key with `write` delete a deck that carried no
 * `ownerEmail` at all: an empty owner compared as "nobody's". The route now
 * loads through `loadPresentationForActor` with `access: 'delete'`, the same
 * decision the editor's delete makes.
 *
 * Driven through the v1 dispatcher against the Postgres adapter on the
 * in-memory database double (tests/helpers/fake-db.js).
 *
 * Run with: node --test tests/public-api-v1-delete-authz.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { testScope } from './helpers/storage-scope.js';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
// `__resetStorageForTests` rather than `closeStorage`: the double is not a real
// Kysely handle, so closing it would call a `destroy()` it does not have.
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { handlePresentations } =
  await import('../server/routes/public-api/v1/presentations.js');
const { createPresentation, getPresentation } =
  await import('../server/storage/presentations/index.js');

const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';

/**
 * A v1 request context for `DELETE /api/v1/presentations/:id` by a `write`
 * key of `ownerEmail`, as `authenticateApiKey` builds it.
 */
function deleteCtx(ownerEmail, id) {
  const req = Readable.from([]);
  req.method = 'DELETE';
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
    url: new URL(`http://localhost/api/v1/presentations/${id}`),
    repoRoot: process.cwd(),
    storageScope: testScope(),
    apiKey: {
      id: 'key-1',
      tier: 'free',
      ownerEmail,
      permissions: ['read', 'write'],
      organizationId: ORG,
    },
    authedUser: {
      id: userIdFor(ownerEmail),
      email: ownerEmail,
      role: 'user',
      organizationId: ORG,
    },
  };
}

describe('DELETE /api/v1/presentations/:id', () => {
  let db;

  before(async () => {
    db = createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      users: userRows(OWNER, OTHER),
    });
    __setTestDb(db);
    await initializeStorage();
  });

  after(() => {
    __resetStorageForTests();
    __setTestDb(null);
  });

  /**
   * A deck owned by OWNER through `owner_user_id` alone: the address column is
   * empty, the shape an external or migrated owner leaves behind.
   */
  async function deckWithoutOwnerEmail(title) {
    const deck = await createPresentation(testScope(), {
      title,
      ownerEmail: OWNER,
    });
    const row = db.__tables.presentations.find((r) => r.id === deck.id);
    row.owner_email = null;
    const stored = await getPresentation(testScope(), deck.id);
    assert.equal(stored.ownerId, userIdFor(OWNER), 'owned by id');
    assert.ok(!stored.ownerEmail, 'no owner address on the deck');
    return deck.id;
  }

  it('lets the ownerId owner delete a deck without ownerEmail', async () => {
    const id = await deckWithoutOwnerEmail('Owned by id');
    const ctx = deleteCtx(OWNER, id);
    await handlePresentations(ctx);
    assert.equal(ctx.res.statusCode, 200, JSON.stringify(ctx.res.body));
    assert.equal(ctx.res.body.deleted, true);
  });

  it('refuses another write key with 403, and the deck stays', async () => {
    const id = await deckWithoutOwnerEmail('Not yours');
    const ctx = deleteCtx(OTHER, id);
    await handlePresentations(ctx);
    assert.equal(ctx.res.statusCode, 403, JSON.stringify(ctx.res.body));
    assert.equal(ctx.res.body.error, 'forbidden');
    assert.ok(
      await getPresentation(testScope(), id),
      'the deck is still there',
    );
  });

  it('answers 404 for a deck that does not exist', async () => {
    const ctx = deleteCtx(OWNER, '00000000-0000-4000-8000-000000000000');
    await handlePresentations(ctx);
    assert.equal(ctx.res.statusCode, 404);
  });
});
