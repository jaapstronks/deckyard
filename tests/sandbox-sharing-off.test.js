/**
 * Sandbox guests do not share with each other (B355, D181).
 *
 * Anonymous guests on a public sandbox all live in one organization. Before
 * this, one guest could find the others in user search, invite one onto a
 * deck, hand a deck over, open it to "everyone in your workspace", and put
 * slides or collections on the organization shelf — every one of those lands work in
 * front of the next stranger who opens the URL.
 *
 * The stance is one declaration, `sharingEnabled()` in
 * `server/config/sandbox.js`: the routes ask it through
 * `assertSharingEnabled()` (`server/sandbox/sharing.js`, a 403 `forbidden`
 * with one fixed message), user search answers with nobody, and the client reads
 * the same value as `features.enableSharing`. This file drives each path as
 * guest Alice and checks, against the store, that guest Bob found, saw and
 * received nothing.
 *
 * House shape (tests/ownership-transfer-authz.test.js): the exported
 * dispatchers with a req/res double over tests/helpers/fake-db.js, the scope
 * built with the router's `createStorageScope()`. No HTTP server, no Postgres.
 *
 * Run with: node --test tests/sandbox-sharing-off.test.js
 */

import { createMockRes } from './helpers/http-mocks.js';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { testScope } = await import('./helpers/storage-scope.js');
const { createPresentation, getPresentation } =
  await import('../server/storage/presentations/index.js');
const { invalidatePermission } =
  await import('../server/storage/cache/permission-cache.js');
const { getFeatureFlags } = await import('../server/config/flags-snapshot.js');
const { SHARING_DISABLED_MESSAGE } =
  await import('../server/sandbox/sharing.js');
const { handlePresentations } =
  await import('../server/routes/api/presentations/index.js');
const { handleCollaborators } =
  await import('../server/routes/api/collaborators.js');
const { handleUsers } = await import('../server/routes/api/users.js');
const { handleSlideLibrary } =
  await import('../server/routes/api/slide-library.js');
const { handleSlideCollections } =
  await import('../server/routes/api/slide-collections.js');

// --- The guests -------------------------------------------------------------
// The shape `ensureSandboxUserAsync` hands the router (server/auth/sandbox.js).
const guest = (hex, id) => ({
  id,
  email: `guest-${hex.repeat(32)}@sandbox.local`,
  role: 'user',
  name: 'Guest',
  isAdmin: false,
  isSandboxGuest: true,
  organizationId: ORG,
});

const ALICE = guest('a', 'user-alice');
const BOB = guest('b', 'user-bob');

/** @type {ReturnType<typeof createFakeDb>} */
let db;
let prevSandboxMode;

test.before(async () => {
  prevSandboxMode = process.env.SANDBOX_MODE;
  process.env.SANDBOX_MODE = '1';
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: [ALICE, BOB].map((g) => ({
      id: g.id,
      organization_id: ORG,
      email: g.email,
      name: g.name,
      role: 'user',
      auth_source: 'database',
      password_hash: null,
      settings: {},
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    })),
  });
  __setTestDb(db);
  await initializeStorage();
});

test.after(() => {
  if (prevSandboxMode === undefined) delete process.env.SANDBOX_MODE;
  else process.env.SANDBOX_MODE = prevSandboxMode;
  __setTestDb(null);
});

/**
 * A private deck of Alice's, fresh per test. Seeded with sandbox mode off for
 * the one call: the create path's per-guest quota query is raw SQL the fake
 * database does not speak, and the quota is not what this file is about.
 */
async function seedAliceDeck() {
  delete process.env.SANDBOX_MODE;
  let pres;
  try {
    pres = await createPresentation(testScope(), {
      title: 'Alice’s deck',
      ownerEmail: ALICE.email,
      slides: [{ type: 'content-slide', content: { title: 'A' } }],
    });
  } finally {
    process.env.SANDBOX_MODE = '1';
  }
  for (const g of [ALICE, BOB]) await invalidatePermission(pres.id, g.email);
  return pres;
}

// --- The request double -----------------------------------------------------

const jsonBody = (res) => JSON.parse(String(res.body || '{}'));

/**
 * Drive one request through a module dispatcher, as the given guest.
 * @param {Function} dispatcher
 * @param {string} method
 * @param {string} pathAndQuery
 * @param {{as: Object, body?: Object}} options
 */
async function call(dispatcher, method, pathAndQuery, { as, body }) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const req = {
    method,
    headers: {
      host: 'sandbox.example.test',
      'content-type': 'application/json',
    },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload, 'utf8');
    },
  };
  const res = createMockRes();
  const handled = await dispatcher({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(as, { repoRoot: process.cwd() }),
    req,
    res,
    url: new URL(`http://sandbox.example.test${pathAndQuery}`),
    authedUser: as,
  });
  return { handled, res };
}

/**
 * Assert the refusal of the declaration: the plain 403 `forbidden` (one code
 * per meaning), carrying the declaration's own message rather than the
 * generic one a per-deck permission refusal sends.
 */
function assertSharingDisabled({ handled, res }) {
  assert.ok(handled, 'the route claims the request');
  assert.equal(res.statusCode, 403);
  assert.equal(jsonBody(res).error, 'forbidden');
  assert.equal(jsonBody(res).message, SHARING_DISABLED_MESSAGE);
}

// --- The declaration --------------------------------------------------------

test('the feature snapshot carries the declaration: off in sandbox, on elsewhere', () => {
  assert.equal(getFeatureFlags().enableSharing, false);
  delete process.env.SANDBOX_MODE;
  try {
    assert.equal(getFeatureFlags().enableSharing, true);
  } finally {
    process.env.SANDBOX_MODE = '1';
  }
});

// --- Find -------------------------------------------------------------------

test('user search finds nobody, not even by the exact guest address', async () => {
  for (const q of ['guest', 'Guest', ALICE.email]) {
    const { handled, res } = await call(
      handleUsers,
      'GET',
      `/api/users/search?q=${encodeURIComponent(q)}`,
      { as: BOB },
    );
    assert.ok(handled);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(jsonBody(res).users, [], `search "${q}"`);
  }

  // The control: the same search outside the sandbox does find Alice, so the
  // empty list above is the declaration and not a search that finds nothing.
  delete process.env.SANDBOX_MODE;
  try {
    const { res } = await call(
      handleUsers,
      'GET',
      '/api/users/search?q=guest',
      {
        as: BOB,
      },
    );
    const emails = jsonBody(res).users.map((u) => u.email);
    assert.ok(emails.includes(ALICE.email), emails.join(', '));
  } finally {
    process.env.SANDBOX_MODE = '1';
  }
});

// --- See --------------------------------------------------------------------

test('opening a deck to the organization is refused, and the deck stays private', async () => {
  const pres = await seedAliceDeck();
  const out = await call(
    handlePresentations,
    'PATCH',
    `/api/presentations/${pres.id}/visibility`,
    { as: ALICE, body: { visibility: 'organization', isViewOnly: true } },
  );
  assertSharingDisabled(out);
  const after = await getPresentation(testScope(), pres.id);
  assert.equal(after.visibility, 'private');
});

test('the organization shelf takes no slide and no collection', async () => {
  const slide = await call(
    handleSlideLibrary,
    'POST',
    '/api/slide-library/organization',
    {
      as: ALICE,
      body: {
        name: 'Shared slide',
        slideType: 'content-slide',
        content: { title: 'For everyone' },
      },
    },
  );
  assertSharingDisabled(slide);

  const collection = await call(
    handleSlideCollections,
    'POST',
    '/api/slide-collections/organization',
    { as: ALICE, body: { name: 'Shared collection' } },
  );
  assertSharingDisabled(collection);

  for (const [dispatcher, path] of [
    [handleSlideLibrary, '/api/slide-library/organization'],
    [handleSlideCollections, '/api/slide-collections/organization'],
  ]) {
    const { res } = await call(dispatcher, 'GET', path, { as: BOB });
    assert.equal(res.statusCode, 200, path);
    const body = jsonBody(res);
    assert.deepEqual(body.items ?? body.collections ?? body, [], path);
  }
});

// --- Receive ----------------------------------------------------------------

test('inviting another guest onto a deck is refused, and nothing reaches them', async () => {
  const pres = await seedAliceDeck();
  const out = await call(
    handleCollaborators,
    'POST',
    `/api/presentations/${pres.id}/collaborators`,
    { as: ALICE, body: { userEmail: BOB.email, permission: 'edit' } },
  );
  assertSharingDisabled(out);
  assert.equal(
    (db.__tables.presentation_collaborators || []).length,
    0,
    'no collaborator row',
  );
  assert.equal((db.__tables.notifications || []).length, 0, 'no notification');

  const shared = await call(
    handleCollaborators,
    'GET',
    '/api/presentations/shared-with-me',
    { as: BOB },
  );
  assert.equal(shared.res.statusCode, 200);
  assert.deepEqual(jsonBody(shared.res).presentations, []);
});

test('handing a deck to another guest is refused, and Alice still owns it', async () => {
  const pres = await seedAliceDeck();
  const out = await call(
    handlePresentations,
    'POST',
    `/api/presentations/${pres.id}/transfer-ownership`,
    { as: ALICE, body: { newOwnerEmail: BOB.email } },
  );
  assertSharingDisabled(out);
  const after = await getPresentation(testScope(), pres.id);
  assert.equal(after.ownerEmail, ALICE.email);
  assert.equal(after.ownerId, ALICE.id);
});

// B406: the remaining organization-wide channels.
const { handleTags } = await import('../server/routes/api/tags.js');
const { handleShareLinks } =
  await import('../server/routes/api/share-links/index.js');
const { getEffectivePermission } =
  await import('../server/utils/presentation-authz/index.js');
const { listRecentComments } = await import('../server/services/comments.js');

test('organization tag names are absent to both guests; creation/deletion are refused', async () => {
  db.__tables.tags ||= [];
  const tag = {
    id: '11111111-1111-4111-8111-111111111111',
    organization_id: ORG,
    name: 'Alice secret',
    created_at: new Date().toISOString(),
  };
  db.__tables.tags.push(tag);
  for (const as of [ALICE, BOB]) {
    for (const path of ['/api/tags', '/api/tags/search?q=Alice']) {
      const { res } = await call(handleTags, 'GET', path, { as });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(jsonBody(res), []);
    }
    assertSharingDisabled(
      await call(handleTags, 'POST', '/api/tags', {
        as,
        body: { name: 'New secret' },
      }),
    );
    assertSharingDisabled(
      await call(handleTags, 'DELETE', `/api/tags/${tag.id}`, { as }),
    );
  }
  assert.ok(
    db.__tables.tags.includes(tag),
    'a guest cannot delete existing vocabulary',
  );
  delete process.env.SANDBOX_MODE;
  try {
    const created = await call(handleTags, 'POST', '/api/tags', {
      as: ALICE,
      body: { name: 'Normal tag' },
    });
    assert.equal(created.res.statusCode, 201);
    const deleted = await call(handleTags, 'DELETE', `/api/tags/${tag.id}`, {
      as: BOB,
    });
    assert.equal(deleted.res.statusCode, 200);
  } finally {
    process.env.SANDBOX_MODE = '1';
  }
});

test('curated decks stay readable but cannot carry comments, including pre-existing guest messages', async () => {
  const pres = await seedAliceDeck();
  db.__tables.presentations.find((p) => p.id === pres.id).visibility =
    'organization';
  db.__tables.presentation_comments ||= [];
  const comment = {
    id: '22222222-2222-4222-8222-222222222222',
    organization_id: ORG,
    presentation_id: pres.id,
    body: 'Alice secret comment',
    author_email: ALICE.email,
    author_user_id: ALICE.id,
    status: 'open',
    created_at: new Date().toISOString(),
    comment_type: 'human',
  };
  db.__tables.presentation_comments.push(comment);
  for (const as of [ALICE, BOB]) {
    const deck = await call(
      handlePresentations,
      'GET',
      `/api/presentations/${pres.id}`,
      { as },
    );
    assert.equal(deck.res.statusCode, 200, 'example content remains readable');
    assert.equal(
      getEffectivePermission({
        user: as,
        pres: { ...pres, visibility: 'organization' },
      }),
      'view',
    );
    for (const suffix of [
      '/comments',
      `/comments/${comment.id}`,
      '/comments/counts',
      '/comments/events',
    ]) {
      const { res } = await call(
        handlePresentations,
        'GET',
        `/api/presentations/${pres.id}${suffix}`,
        { as },
      );
      assert.equal(res.statusCode, 403, suffix);
      assert.equal(jsonBody(res).error, 'forbidden');
      assert.ok(!String(res.body).includes(comment.body));
    }
    const post = await call(
      handlePresentations,
      'POST',
      `/api/presentations/${pres.id}/comments`,
      { as, body: { body: 'New message' } },
    );
    assert.equal(post.res.statusCode, 403);
    for (const [method, suffix, body] of [
      ['PUT', `/comments/${comment.id}`, { body: 'Edited secret' }],
      ['DELETE', `/comments/${comment.id}`, undefined],
      ['POST', `/comments/${comment.id}/resolve`, {}],
    ]) {
      const out = await call(
        handlePresentations,
        method,
        `/api/presentations/${pres.id}${suffix}`,
        { as, body },
      );
      assert.equal(out.res.statusCode, 403, `${method} ${suffix}`);
    }
    const recent = await listRecentComments(
      createStorageScope(as, { repoRoot: process.cwd() }),
      { actor: as },
      {},
    );
    assert.ok(!recent.items.some((i) => i.comment.body === comment.body));
  }
  delete process.env.SANDBOX_MODE;
  try {
    const read = await call(
      handlePresentations,
      'GET',
      `/api/presentations/${pres.id}/comments`,
      { as: BOB },
    );
    assert.equal(read.res.statusCode, 200);
    assert.ok(jsonBody(read.res).comments.some((c) => c.body === comment.body));
    const post = await call(
      handlePresentations,
      'POST',
      `/api/presentations/${pres.id}/comments`,
      { as: BOB, body: { body: 'Normal organization comment' } },
    );
    assert.equal(post.res.statusCode, 201);
  } finally {
    process.env.SANDBOX_MODE = '1';
  }
});

test('a guest cannot mint a share link; normal organization owners still can', async () => {
  const pres = await seedAliceDeck();
  assertSharingDisabled(
    await call(
      handleShareLinks,
      'POST',
      `/api/presentations/${pres.id}/share-links`,
      { as: ALICE, body: { permission: 'view' } },
    ),
  );
  assert.equal(
    (db.__tables.presentation_share_links || []).filter(
      (l) => l.presentation_id === pres.id,
    ).length,
    0,
  );
  delete process.env.SANDBOX_MODE;
  try {
    const out = await call(
      handleShareLinks,
      'POST',
      `/api/presentations/${pres.id}/share-links`,
      { as: ALICE, body: { permission: 'view' } },
    );
    assert.equal(out.res.statusCode, 201);
    assert.ok(jsonBody(out.res).token);
  } finally {
    process.env.SANDBOX_MODE = '1';
  }
});
