/**
 * Integration tests for the public API's per-deck access check
 * (getPresentationWithAccess), against the Postgres adapter on the in-memory
 * database double (tests/helpers/fake-db.js).
 *
 * Regression guard: the public API used canAccessPresentation
 * (owner/organization only, no read/write distinction), so any organization-scoped
 * deck was writable by every API key and collaborators were ignored. It now
 * uses the same collaborator-aware canRead/canWritePresentation checks as the
 * editor routes.
 *
 * Run with: node --test tests/public-api-authz.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

import { testScope } from './helpers/storage-scope.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
// `__resetStorageForTests` rather than `closeStorage`: the double is not a real
// Kysely handle, so closing it would call a `destroy()` it does not have.
const { initializeStorage, __resetStorageForTests } = await import(
  '../server/storage/adapters/index.js'
);
const { getPresentationWithAccess } = await import(
  '../server/routes/public-api/v1/middleware.js'
);
const { createPresentation, updatePresentation } = await import(
  '../server/storage/presentations/index.js'
);

const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';

/** Minimal ctx with a response stub that records status + JSON body. */
function makeCtx(ownerEmail) {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status) { this.statusCode = status; },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };
  return {
    storageScope: testScope(),
    res,
    apiKey: { id: 'test-key', tier: 'free', ownerEmail },
    // What authenticateApiKey puts on the context: who is acting and in which
    // organization. Per-deck checks read the actor from here, not off the deck.
    authedUser: { id: null, email: ownerEmail, role: 'user', organizationId: null },
  };
}

describe('getPresentationWithAccess', () => {
  let privateId;
  let viewOnlyId;

  before(async () => {
    __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default', slug: 'default' }] }));
    await initializeStorage();

    const privateDeck = await createPresentation(testScope(), {
      title: 'Private deck',
      ownerEmail: OWNER,
    });
    privateId = privateDeck.id;

    const viewOnlyDeck = await createPresentation(testScope(), {
      title: 'View-only organization deck',
      ownerEmail: OWNER,
    });
    viewOnlyId = viewOnlyDeck.id;
    await updatePresentation(testScope(), viewOnlyId, {
      ...viewOnlyDeck,
      visibility: 'organization',
      isViewOnly: true,
      // Both flips are gated on the write path, so the fixture opts into them
      // explicitly (as the routes that own those switches do).
    }, { allowVisibilityChange: true, allowViewOnlyChange: true });
  });

  after(() => {
    __resetStorageForTests();
    __setTestDb(null);
  });

  it('404s for a nonexistent deck', async () => {
    const ctx = makeCtx(OWNER);
    const { ok } = await getPresentationWithAccess(ctx, 'nope-does-not-exist');
    assert.equal(ok, false);
    assert.equal(ctx.res.statusCode, 404);
  });

  it('lets the key owner read and write their private deck', async () => {
    const read = await getPresentationWithAccess(makeCtx(OWNER), privateId);
    assert.equal(read.ok, true);
    assert.equal(read.pres.id, privateId);

    const write = await getPresentationWithAccess(
      makeCtx(OWNER), privateId, { access: 'write' }
    );
    assert.equal(write.ok, true);
  });

  it("403s another key's read of a private deck", async () => {
    const ctx = makeCtx(OTHER);
    const { ok } = await getPresentationWithAccess(ctx, privateId);
    assert.equal(ok, false);
    assert.equal(ctx.res.statusCode, 403);
  });

  it("403s another key's write of a private deck", async () => {
    const ctx = makeCtx(OTHER);
    const { ok } = await getPresentationWithAccess(ctx, privateId, { access: 'write' });
    assert.equal(ok, false);
    assert.equal(ctx.res.statusCode, 403);
  });

  it('view-only organization deck: read ok, write 403 for non-owner keys', async () => {
    const read = await getPresentationWithAccess(makeCtx(OTHER), viewOnlyId);
    assert.equal(read.ok, true);

    const ctx = makeCtx(OTHER);
    const { ok } = await getPresentationWithAccess(ctx, viewOnlyId, { access: 'write' });
    assert.equal(ok, false);
    assert.equal(ctx.res.statusCode, 403);
    assert.match(ctx.res.body.error, /read-only/);
  });
});
