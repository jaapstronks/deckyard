/**
 * One deck list on three contracts (B607). Home and search (internal), the
 * internal shared-with-me list, `GET /api/v1/presentations` and MCP
 * `list_presentations` used to read the organization's rows and decide on
 * their own who sees what — MCP on a bare e-mail comparison that skipped the
 * creator and every organization-visible deck, and each reading an unknown
 * filter value as "no filter". Now they all ask `listPresentationsForActor`
 * (`server/services/presentations.js`), and a filter value outside the
 * vocabulary is a 400 `invalid` naming the field (A7.4, D252–D256).
 *
 * The store: OWNER's private deck, STRANGER's private deck shared with
 * COLLAB, STRANGER's view-only organization deck, and STRANGER's private deck
 * nobody else may see. Each contract is asked as the owner, the collaborator
 * and an outsider.
 *
 * Handler-import level against the database double, like
 * tests/service-layer-deck-operations.test.js.
 *
 * Run with: node --test tests/service-layer-presentation-list.test.js
 */

import { createMockRes } from './helpers/http-mocks.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b607']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER_EMAIL = 'owner@example.com';
const STRANGER_EMAIL = 'stranger@example.com';
const COLLAB_EMAIL = 'collab@example.com';
const OUTSIDER_EMAIL = 'outsider@example.com';

const OWN = 'd0000607-0000-4000-8000-000000000001';
const SHARED = 'd0000607-0000-4000-8000-000000000002';
const ORG_DECK = 'd0000607-0000-4000-8000-000000000003';
const HIDDEN = 'd0000607-0000-4000-8000-000000000004';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');
const { handlePresentations: handleInternalPresentations } =
  await import('../server/routes/api/presentations/index.js');
const { handleCollaborators } =
  await import('../server/routes/api/collaborators.js');
const { handlePresentations: handleV1Presentations } =
  await import('../server/routes/public-api/v1/presentations.js');
const { listPresentationsForActor, listPresentationPage } =
  await import('../server/services/presentations.js');

const actor = (email) => ({
  id: userIdFor(email),
  email,
  name: email.split('@')[0],
  role: 'user',
  organizationId: ORG,
});
const OWNER = actor(OWNER_EMAIL);
const COLLAB = actor(COLLAB_EMAIL);
const OUTSIDER = actor(OUTSIDER_EMAIL);

// --- The store ----------------------------------------------------------------

function deckRow({
  id,
  owner,
  title,
  modified,
  visibility = 'private',
  viewOnly = false,
}) {
  return {
    id,
    organization_id: ORG,
    owner_email: owner,
    created_by: owner,
    updated_by: owner,
    owner_user_id: userIdFor(owner),
    created_by_user_id: userIdFor(owner),
    updated_by_user_id: userIdFor(owner),
    title,
    description: null,
    theme: null,
    lang: 'en',
    visibility,
    is_view_only: viewOnly,
    revision: 1,
    settings: {},
    i18n: null,
    slides: [
      {
        id: 'slide-1',
        type: 'title-slide',
        content: { title: `${title} opening` },
        parentId: null,
      },
      {
        id: 'slide-2',
        type: 'content-slide',
        content: { title: 'Quarterly numbers' },
        parentId: null,
      },
    ],
    published: null,
    created_at: '2026-07-01T00:00:00.000Z',
    modified_at: modified,
    trashed_at: null,
  };
}

async function installDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER_EMAIL, STRANGER_EMAIL, COLLAB_EMAIL, OUTSIDER_EMAIL),
    presentations: [
      deckRow({
        id: OWN,
        owner: OWNER_EMAIL,
        title: 'Roadmap',
        modified: '2026-08-04T00:00:00.000Z',
      }),
      deckRow({
        id: SHARED,
        owner: STRANGER_EMAIL,
        title: 'Shared plan',
        modified: '2026-08-03T00:00:00.000Z',
      }),
      deckRow({
        id: ORG_DECK,
        owner: STRANGER_EMAIL,
        title: 'Workspace handbook',
        modified: '2026-08-02T00:00:00.000Z',
        visibility: 'organization',
        viewOnly: true,
      }),
      deckRow({
        id: HIDDEN,
        owner: STRANGER_EMAIL,
        title: 'Private roadmap',
        modified: '2026-08-01T00:00:00.000Z',
      }),
    ],
    presentation_collaborators: [
      {
        id: 'collab-1',
        presentation_id: SHARED,
        organization_id: ORG,
        user_email: COLLAB_EMAIL,
        user_id: null,
        permission: 'view',
        invited_by: STRANGER_EMAIL,
        invited_at: '2026-08-05T00:00:00.000Z',
        accepted_at: '2026-08-05T00:00:00.000Z',
        revoked_at: null,
        created_at: '2026-08-05T00:00:00.000Z',
      },
    ],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

// --- The three contracts ------------------------------------------------------

const makeReq = (method) => ({
  method,
  headers: { host: 'deck.example' },
  socket: { remoteAddress: '203.0.113.9' },
});

/** A GET on the internal `/api` contract, as `as`. */
async function internal(handler, path, as) {
  const res = createMockRes();
  await handler({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(as, { repoRoot: process.cwd() }),
    req: makeReq('GET'),
    res,
    url: new URL(`http://deck.example${path}`),
    authedUser: as,
  });
  return res;
}

/** A GET on the public v1 contract with `as`'s key already authenticated. */
async function v1(path, as) {
  const res = createMockRes();
  await handleV1Presentations({
    req: makeReq('GET'),
    res,
    url: new URL(`http://deck.example${path}`),
    repoRoot: process.cwd(),
    storageScope: {
      repoRoot: process.cwd(),
      organizationId: ORG,
      actorUserId: as.id,
      actorEmail: as.email,
    },
    apiKey: {
      id: 'key-1',
      tier: 'free',
      ownerEmail: as.email,
      permissions: ['read'],
      organizationId: ORG,
    },
    authedUser: as,
  });
  return res;
}

/** Call an MCP tool as a session owned by `ownerEmail` (none: stdio operator). */
function mcp(tool, args, ownerEmail) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: ownerEmail });
  return server.tools
    .get(tool)
    .handler(args, { ownerEmail, organizationId: ORG });
}

const ids = (decks) => decks.map((p) => p.id);

// =============================================================================
// The service
// =============================================================================

test('service: one predicate, one ownership vocabulary, newest first', async () => {
  await installDb();
  const list = async (as, input) =>
    ids(
      (
        await listPresentationsForActor(
          createStorageScope(as, { repoRoot: process.cwd() }),
          { actor: as },
          input,
        )
      ).presentations,
    );

  assert.deepEqual(await list(OWNER, {}), [OWN, ORG_DECK]);
  assert.deepEqual(await list(OWNER, { ownership: 'owned' }), [OWN]);
  assert.deepEqual(await list(OWNER, { ownership: 'shared' }), []);

  assert.deepEqual(await list(COLLAB, {}), [ORG_DECK]);
  assert.deepEqual(await list(COLLAB, { ownership: 'shared' }), [SHARED]);
  assert.deepEqual(await list(COLLAB, { ownership: 'all' }), [
    SHARED,
    ORG_DECK,
  ]);
  assert.deepEqual(await list(COLLAB, { ownership: 'owned' }), []);

  assert.deepEqual(await list(OUTSIDER, { ownership: 'all' }), [ORG_DECK]);
  // An actor without an identity sees nothing (it used to see every deck on
  // the internal list).
  assert.deepEqual(await list({ id: null, email: undefined }, {}), []);
  // The auth-off operator owns no row but may open every deck.
  assert.deepEqual(await list({ email: null, unrestricted: true }, {}), [
    OWN,
    SHARED,
    ORG_DECK,
    HIDDEN,
  ]);

  assert.deepEqual(await list(OWNER, { viewOnly: true }), [ORG_DECK]);
  assert.deepEqual(await list(OWNER, { viewOnly: false }), [OWN]);
});

test('service: a page continues on its cursor, search sorts title matches first', async () => {
  await installDb();
  const scope = createStorageScope(OWNER, { repoRoot: process.cwd() });

  // B820: the page is cut in the query, on the list-page contract.
  const first = await listPresentationPage(
    scope,
    { actor: OWNER },
    { limit: 1 },
  );
  assert.deepEqual(ids(first.presentations), [OWN]);
  assert.equal(typeof first.nextCursor, 'string');
  const second = await listPresentationPage(
    scope,
    { actor: OWNER },
    { limit: 1, cursor: first.nextCursor },
  );
  assert.deepEqual(ids(second.presentations), [ORG_DECK]);
  assert.equal(second.nextCursor, null);
  assert.equal('total' in second, false, 'no count on a page');

  const shallow = await listPresentationsForActor(
    scope,
    { actor: OWNER },
    { q: 'quarterly' },
  );
  assert.deepEqual(ids(shallow.presentations), []);

  const deep = await listPresentationsForActor(
    scope,
    { actor: OWNER },
    { q: 'quarterly', deep: true },
  );
  assert.deepEqual(ids(deep.presentations), [OWN, ORG_DECK]);
  assert.deepEqual(deep.presentations[0]._matchLocations, ['slide 2']);

  // "roadmap" is in OWN's title and in HIDDEN's, which OWNER may not see.
  const ranked = await listPresentationsForActor(
    scope,
    { actor: OWNER },
    { q: 'roadmap', deep: true },
  );
  assert.deepEqual(ids(ranked.presentations), [OWN]);
  assert.deepEqual(ranked.presentations[0]._matchLocations, ['title']);
});

test('service: a value outside the vocabulary is 400 invalid naming the field', async () => {
  await installDb();
  const scope = createStorageScope(OWNER, { repoRoot: process.cwd() });
  for (const [input, field] of [
    [{ ownership: 'mine' }, 'ownership'],
    [{ viewOnly: 'yes' }, 'viewOnly'],
    [{ q: 'x' }, 'q'],
    [{ q: 'roadmap', deep: 'yes' }, 'deep'],
  ]) {
    await assert.rejects(
      listPresentationsForActor(scope, { actor: OWNER }, input),
      (err) =>
        err.statusCode === 400 &&
        err.code === 'invalid' &&
        err.details?.field === field,
      JSON.stringify(input),
    );
  }

  const { nextCursor: collectionCursor } = await listPresentationPage(
    scope,
    { actor: OWNER },
    { ownership: 'collection', limit: 1 },
  );
  assert.ok(collectionCursor);
  for (const [input, field] of [
    [{ ownership: 'mine' }, 'ownership'],
    [{ viewOnly: 'yes' }, 'viewOnly'],
    [{ limit: 0 }, 'limit'],
    [{ limit: 2.5 }, 'limit'],
    [{ limit: 101 }, 'limit'],
    [{ limit: 'ten' }, 'limit'],
    [{ offset: 1 }, 'offset'],
    [{ cursor: 'not-a-cursor' }, 'cursor'],
    // A cursor is bound to the filters it was made under.
    [{ ownership: 'owned', cursor: collectionCursor }, 'cursor'],
  ]) {
    await assert.rejects(
      listPresentationPage(scope, { actor: OWNER }, input),
      (err) =>
        err.statusCode === 400 &&
        err.code === 'invalid' &&
        err.details?.field === field &&
        (field !== 'offset' || err.details.use === 'cursor'),
      JSON.stringify(input),
    );
  }
});

// =============================================================================
// Internal: Home, search, shared-with-me
// =============================================================================

test('internal: Home, search and shared-with-me for owner, collaborator and outsider', async () => {
  await installDb();

  const homePage = (as, query = '') =>
    internal(handleInternalPresentations, `/api/presentations${query}`, as);
  const home = async (as, query) =>
    ids((await homePage(as, query)).json().presentations);
  assert.deepEqual(await home(OWNER), [OWN, ORG_DECK]);
  assert.deepEqual(await home(COLLAB), [ORG_DECK]);
  assert.deepEqual(await home(OUTSIDER), [ORG_DECK]);

  // Home's chips are the service's filters (B821): All, Mine, Workspace,
  // Shared, each a page of its own.
  assert.deepEqual(await home(COLLAB, '?ownership=all'), [SHARED, ORG_DECK]);
  assert.deepEqual(await home(OWNER, '?ownership=owned'), [OWN]);
  assert.deepEqual(
    await home(OWNER, '?ownership=all&visibility=organization'),
    [ORG_DECK],
  );
  assert.deepEqual(await home(COLLAB, '?ownership=shared'), [SHARED]);

  const first = (await homePage(OWNER, '?limit=1')).json();
  assert.deepEqual(ids(first.presentations), [OWN]);
  const next = (
    await homePage(
      OWNER,
      `?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
    )
  ).json();
  assert.deepEqual(ids(next.presentations), [ORG_DECK]);
  assert.equal(next.nextCursor, null);

  for (const [query, field] of [
    ['?ownership=everything', 'ownership'],
    ['?visibility=public', 'visibility'],
    [`?${'tag=t&'.repeat(21)}`, 'tags'],
    ['?limit=0', 'limit'],
    ['?offset=50', 'offset'],
    [
      `?ownership=owned&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
      'cursor',
    ],
  ]) {
    const refused = await homePage(OWNER, query);
    assert.equal(refused.statusCode, 400, query);
    assert.equal(refused.json().error, 'invalid', query);
    assert.equal(refused.json().details.field, field, query);
  }

  const shared = await internal(
    handleCollaborators,
    '/api/presentations/shared-with-me',
    COLLAB,
  );
  assert.equal(shared.statusCode, 200);
  assert.deepEqual(ids(shared.json().presentations), [SHARED]);
  assert.equal(shared.json().presentations[0].permission, 'view');

  const search = async (query, as) =>
    internal(
      handleInternalPresentations,
      `/api/presentations/search?${query}`,
      as,
    );
  const found = await search('q=roadmap', OWNER);
  assert.equal(found.statusCode, 200);
  assert.deepEqual(ids(found.json().results), [OWN]);
  // The other roadmap is STRANGER's private deck: not searched for anyone else.
  assert.deepEqual(
    ids((await search('q=roadmap', OUTSIDER)).json().results),
    [],
  );
  // Home's search view searches every deck the person can open.
  assert.deepEqual(ids((await search('q=shared', COLLAB)).json().results), []);
  assert.deepEqual(
    ids((await search('q=shared&ownership=all', COLLAB)).json().results),
    [SHARED],
  );

  for (const [query, field] of [
    ['q=x', 'q'],
    ['', 'q'],
    ['q=roadmap&deep=yes', 'deep'],
  ]) {
    const refused = await search(query, OWNER);
    assert.equal(refused.statusCode, 400, query);
    assert.equal(refused.json().error, 'invalid', query);
    assert.equal(refused.json().details.field, field, query);
  }
});

// =============================================================================
// v1: GET /api/v1/presentations
// =============================================================================

test('v1 list: owner, collaborator and outsider; viewOnly refuses an unknown value', async () => {
  await installDb();

  const list = async (as, query = '') =>
    v1(`/api/v1/presentations${query}`, as);

  const owner = await list(OWNER);
  assert.equal(owner.statusCode, 200);
  assert.deepEqual(ids(owner.json().presentations), [OWN, ORG_DECK]);
  assert.equal(owner.json().nextCursor, null);
  assert.equal('pagination' in owner.json(), false);
  assert.deepEqual(ids((await list(COLLAB)).json().presentations), [ORG_DECK]);
  assert.deepEqual(ids((await list(OUTSIDER)).json().presentations), [
    ORG_DECK,
  ]);

  const viewOnly = await list(OWNER, '?viewOnly=true');
  assert.deepEqual(ids(viewOnly.json().presentations), [ORG_DECK]);
  const editable = await list(OWNER, '?viewOnly=false');
  assert.deepEqual(ids(editable.json().presentations), [OWN]);

  const paged = await list(OWNER, '?limit=1');
  assert.deepEqual(ids(paged.json().presentations), [OWN]);
  const rest = await list(
    OWNER,
    `?limit=1&cursor=${encodeURIComponent(paged.json().nextCursor)}`,
  );
  assert.deepEqual(ids(rest.json().presentations), [ORG_DECK]);
  assert.equal(rest.json().nextCursor, null);

  for (const [query, field] of [
    ['?limit=1&offset=1', 'offset'],
    ['?limit=500', 'limit'],
    ['?cursor=broken', 'cursor'],
    [
      `?viewOnly=false&cursor=${encodeURIComponent(paged.json().nextCursor)}`,
      'cursor',
    ],
  ]) {
    const bounded = await list(OWNER, query);
    assert.equal(bounded.statusCode, 400, query);
    assert.equal(bounded.json().error, 'invalid', query);
    assert.equal(bounded.json().details.field, field, query);
  }

  // Read as "no filter" without a word before B607.
  const refused = await list(OWNER, '?viewOnly=yes');
  assert.equal(refused.statusCode, 400);
  assert.equal(refused.json().error, 'invalid');
  assert.equal(refused.json().details.field, 'viewOnly');
});

// =============================================================================
// MCP: list_presentations
// =============================================================================

test('MCP list_presentations: owner, collaborator and outsider; an unknown ownership is refused', async () => {
  await installDb();

  const list = async (ownerEmail, args = {}) =>
    ids((await mcp('list_presentations', args, ownerEmail)).presentations);

  assert.deepEqual(await list(OWNER_EMAIL), [OWN]);
  assert.deepEqual(await list(OWNER_EMAIL, { ownership: 'collection' }), [
    OWN,
    ORG_DECK,
  ]);
  assert.deepEqual(await list(COLLAB_EMAIL), []);
  const shared = await mcp(
    'list_presentations',
    { ownership: 'shared' },
    COLLAB_EMAIL,
  );
  assert.deepEqual(ids(shared.presentations), [SHARED]);
  assert.equal(shared.presentations[0].permission, 'view');
  // `all` is every deck the session can open: the organization deck too.
  assert.deepEqual(await list(COLLAB_EMAIL, { ownership: 'all' }), [
    SHARED,
    ORG_DECK,
  ]);
  assert.deepEqual(await list(OUTSIDER_EMAIL, { ownership: 'all' }), [
    ORG_DECK,
  ]);

  const limited = await mcp(
    'list_presentations',
    { ownership: 'all', limit: 1 },
    COLLAB_EMAIL,
  );
  assert.deepEqual(ids(limited.presentations), [SHARED]);
  assert.equal('total' in limited, false);
  const next = await mcp(
    'list_presentations',
    { ownership: 'all', limit: 1, cursor: limited.nextCursor },
    COLLAB_EMAIL,
  );
  assert.deepEqual(ids(next.presentations), [ORG_DECK]);
  assert.equal(next.nextCursor, null);
  await assert.rejects(
    mcp('list_presentations', { offset: 1 }, OWNER_EMAIL),
    (err) =>
      err.code === 'invalid' &&
      err.details?.field === 'offset' &&
      err.details.use === 'cursor',
  );
  await assert.rejects(
    mcp('list_presentations', { limit: 101 }, OWNER_EMAIL),
    (err) => err.code === 'invalid' && err.details?.field === 'limit',
  );

  // Read as "owned" without a word before B607.
  await assert.rejects(
    mcp('list_presentations', { ownership: 'mine' }, OWNER_EMAIL),
    (err) => err.code === 'invalid' && err.details?.field === 'ownership',
  );
});
