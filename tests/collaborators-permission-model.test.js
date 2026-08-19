/**
 * The collaborator permission model (test-coverage gap map, PR 2).
 *
 * `server/routes/api/collaborators.js` is the endpoint half of per-deck
 * sharing: five routes that decide who may be granted access to a deck and at
 * what level. It had no tests — the nine `collab-*.test.js` files are about
 * CRDT and presence, which is a different feature that happens to share a
 * prefix.
 *
 * The rule this surface rests on is that **managing collaborators is not the
 * same as editing**: `canManageCollaborators` grants only to the owner, the
 * creator, and a collaborator holding the `admin` permission
 * (`shared/constants/permissions.js` → `MANAGE_PERMISSIONS`). A collaborator
 * with `edit` can rewrite every slide in the deck and still may not hand the
 * deck to anyone else. Half of this file is that one sentence stated as
 * assertions, on all four presentation-scoped endpoints, because the check is
 * repeated per endpoint rather than applied once — four places to get it right
 * and four places to get it wrong.
 *
 * The second rule is that the organization scopes everything: a deck in another
 * organization is not "forbidden" to this session, it is *absent*, and a
 * collaborator row in another organization does not appear in "shared with me".
 *
 * These are route-level tests in the house shape (see
 * `tests/authz-organization-scope.test.js` and
 * `tests/share-links-public-path.test.js`): the exported handler is called
 * directly with a req/res double over `tests/helpers/fake-db.js`, and the
 * storage scope is built with the same `createStorageScope()` call the router
 * makes. No HTTP server, no browser — the suite has no e2e harness and this
 * item does not introduce one.
 *
 * No production code changes with this file. One test-double gap did have to
 * close: `fake-db.js` did not understand table aliases, so the aliased join in
 * `listPresentationsSharedWithUser` ("shared with me") read a table that did
 * not exist and answered `[]` for every input — an empty list would have been
 * indistinguishable from a working filter.
 *
 * Run with: node --test tests/collaborators-permission-model.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
// The invite mail is fire-and-forget; without a key the Brevo client answers
// `{ ok: false }` before it reaches the network.
delete process.env.BREVO_API_KEY;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
// `__resetStorageForTests` rather than `closeStorage`: the double is not a real
// Kysely handle, so closing it would call a `destroy()` it does not have.
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { invalidatePermission } =
  await import('../server/storage/cache/permission-cache.js');
const { handleCollaborators } =
  await import('../server/routes/api/collaborators.js');

/**
 * The people. `organizationId` is what `createStorageScope` binds the request
 * to, so `outsider` acts in a different organization than everyone else.
 */
const ACTORS = {
  owner: { email: 'owner@example.com', name: 'Olive', organizationId: ORG },
  admin: { email: 'admin@example.com', name: 'Ada', organizationId: ORG },
  editor: { email: 'editor@example.com', name: 'Ed', organizationId: ORG },
  viewer: { email: 'viewer@example.com', name: 'Vera', organizationId: ORG },
  revoked: { email: 'revoked@example.com', name: 'Rob', organizationId: ORG },
  stranger: { email: 'stranger@example.com', name: 'Sam', organizationId: ORG },
  newcomer: {
    email: 'newcomer@example.com',
    name: 'Nils',
    organizationId: ORG,
  },
  outsider: {
    email: 'outsider@other.example',
    name: 'Otto',
    organizationId: OTHER_ORG,
  },
};

const DECKS = [
  'deck-owned',
  'deck-second',
  'deck-organization',
  'deck-trashed',
  'deck-foreign',
];

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    }),
  );
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * A stored user, in the shape the users adapter reads.
 * @param {{email: string, name: string, organizationId: string}} actor
 * @returns {Object}
 */
function userRow(actor) {
  return {
    id: `user-${actor.email.split('@')[0]}`,
    organization_id: actor.organizationId,
    email: actor.email,
    name: actor.name,
    role: 'user',
    auth_source: 'database',
    password_hash: null,
    settings: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

/**
 * A stored deck, in the shape the presentations adapter reads.
 * @param {Object} overrides - Row fields that matter to the test at hand.
 * @returns {Object}
 */
function deckRow(overrides) {
  return {
    organization_id: ORG,
    title: `Title of ${overrides.id}`,
    owner_email: ACTORS.owner.email,
    created_by: ACTORS.owner.email,
    updated_by: ACTORS.owner.email,
    visibility: 'private',
    theme: 'default',
    lang: 'nl',
    revision: 1,
    is_view_only: false,
    slides: [{ id: 's1', type: 'content-slide', content: { title: 'Slide' } }],
    i18n: null,
    settings: {},
    created_at: '2026-02-01T00:00:00.000Z',
    modified_at: '2026-02-01T00:00:00.000Z',
    trashed_at: null,
    ...overrides,
  };
}

/**
 * A collaborator row, with the column defaults the migrations give it.
 * @param {Object} overrides - Row fields that matter to the test at hand.
 * @returns {Object}
 */
function collaboratorRow(overrides) {
  return {
    organization_id: ORG,
    presentation_id: 'deck-owned',
    user_id: null,
    invited_by: ACTORS.owner.email,
    invited_at: '2026-02-01T00:00:00.000Z',
    accepted_at: null,
    revoked_at: null,
    revoked_by: null,
    revocation_message: null,
    ...overrides,
  };
}

/**
 * Reinstall a freshly seeded double, and drop the permission cache for every
 * (deck, person) pair the file uses.
 *
 * That second half is not optional: `getCollaboratorPermission` caches in a
 * module-level Map with a five-minute TTL, so without it a permission one test
 * granted would still answer a lookup in the next — the reseeded database would
 * never be consulted and an authorization assertion would pass on a stale hit.
 * The key is `(deck, email)`, matching the row: an organization is not part of
 * a collaborator lookup (see the header of server/storage/collaborators.js).
 *
 * @returns {Promise<ReturnType<typeof createFakeDb>>}
 */
async function seed() {
  db = createFakeDb({
    organizations: [
      { id: ORG, name: 'Default', slug: 'default' },
      { id: OTHER_ORG, name: 'Other', slug: 'other' },
    ],
    users: Object.values(ACTORS).map(userRow),
    presentations: [
      deckRow({ id: 'deck-owned' }),
      // No slides: the "shared with me" grid reduces the thumbnail to a
      // presence boolean, and this deck is the one that must report `false`.
      deckRow({ id: 'deck-second', slides: [] }),
      deckRow({ id: 'deck-organization', visibility: 'organization' }),
      deckRow({ id: 'deck-trashed', trashed_at: '2026-03-01T00:00:00.000Z' }),
      deckRow({
        id: 'deck-foreign',
        organization_id: OTHER_ORG,
        owner_email: ACTORS.outsider.email,
        created_by: ACTORS.outsider.email,
        updated_by: ACTORS.outsider.email,
      }),
    ],
    presentation_collaborators: [
      collaboratorRow({
        id: 'c-admin',
        user_email: ACTORS.admin.email,
        permission: 'admin',
      }),
      collaboratorRow({
        id: 'c-editor',
        user_email: ACTORS.editor.email,
        permission: 'edit',
      }),
      collaboratorRow({
        id: 'c-viewer',
        user_email: ACTORS.viewer.email,
        permission: 'view',
      }),
      collaboratorRow({
        id: 'c-revoked',
        user_email: ACTORS.revoked.email,
        permission: 'view',
        revoked_at: '2026-03-01T00:00:00.000Z',
        revoked_by: ACTORS.owner.email,
      }),
      collaboratorRow({
        id: 'c-second',
        presentation_id: 'deck-second',
        user_email: ACTORS.viewer.email,
        permission: 'comment',
        invited_at: '2026-02-03T00:00:00.000Z',
      }),
      collaboratorRow({
        id: 'c-trashed',
        presentation_id: 'deck-trashed',
        user_email: ACTORS.viewer.email,
        permission: 'view',
      }),
      // The cross-organization row: Vera's address is a collaborator on a deck
      // in the *other* organization. Nothing she does in hers may surface it.
      collaboratorRow({
        id: 'c-foreign',
        organization_id: OTHER_ORG,
        presentation_id: 'deck-foreign',
        user_email: ACTORS.viewer.email,
        permission: 'edit',
      }),
    ],
    user_notifications: [],
    activity_events: [],
    auth_audit_log: [],
    app_settings: [],
  });
  __setTestDb(db);

  for (const deck of DECKS) {
    for (const actor of Object.values(ACTORS)) {
      await invalidatePermission(deck, actor.email);
    }
  }
  return db;
}

// ---------------------------------------------------------------------------
// Driving the handler
// ---------------------------------------------------------------------------

/**
 * Call the collaborator handler the way `routes/api/index.js` does, including
 * the same `createStorageScope(authedUser, { repoRoot })` storage scope.
 *
 * @param {string} method - HTTP method.
 * @param {string} path - Request path.
 * @param {Object} [options]
 * @param {Object|null} [options.as] - The authenticated user; omit for anonymous.
 * @param {Object|string} [options.body] - Request body; a string is sent verbatim.
 * @returns {Promise<{handled: boolean, status: number|null, body: Object|null, raw: string|null}>}
 */
async function call(method, path, { as = null, body } = {}) {
  const payload =
    body === undefined
      ? ''
      : typeof body === 'string'
        ? body
        : JSON.stringify(body);
  const req = {
    method,
    headers: {
      host: 'decks.example.test',
      'content-type': 'application/json',
    },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload, 'utf8');
    },
  };

  const res = {
    status: null,
    chunks: [],
    writeHead(status) {
      this.status = status;
      return this;
    },
    end(chunk) {
      if (chunk) this.chunks.push(chunk);
    },
  };

  const authedUser = as || undefined;
  const handled = await handleCollaborators({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(authedUser, { repoRoot: process.cwd() }),
    req,
    res,
    url: new URL(`http://decks.example.test${path}`),
    authedUser,
  });

  const raw = res.chunks.length ? res.chunks.join('') : null;
  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  return { handled, status: res.status, body: parsed, raw };
}

/** The stored collaborator rows for a deck, revoked ones included. */
const rowsFor = (deckId) =>
  db.__tables.presentation_collaborators.filter(
    (r) => r.presentation_id === deckId,
  );
/** One stored collaborator row, by deck and address. */
const rowFor = (deckId, email) =>
  rowsFor(deckId).find((r) => r.user_email === email);
/** Notification rows written so far. */
const notifications = () => db.__tables.user_notifications || [];
/** Activity-event rows written so far. */
const activity = () => db.__tables.activity_events || [];

/** Everyone who may not manage collaborators on `deck-owned`, and why. */
const REFUSED = [
  ['editor', 'edit is not manage'],
  ['viewer', 'view is not manage'],
  ['revoked', 'a revoked collaborator holds nothing'],
  ['stranger', 'an organization colleague is not a collaborator'],
  [null, 'an anonymous caller'],
];

/**
 * Resolve a {@link REFUSED} key to the user object `call()` takes.
 * @param {string|null} key - Actor key, or null for anonymous.
 * @returns {Object|null}
 */
const actor = (key) => (key ? ACTORS[key] : null);

// ---------------------------------------------------------------------------
// GET /api/presentations/shared-with-me
// ---------------------------------------------------------------------------

test('shared-with-me lists the decks shared with the caller, newest invite first', async () => {
  await seed();
  const res = await call('GET', '/api/presentations/shared-with-me', {
    as: ACTORS.viewer,
  });

  assert.equal(res.handled, true);
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.presentations.map((p) => [p.id, p.permission, p.hasSlides]),
    [
      ['deck-second', 'comment', false],
      ['deck-owned', 'view', true],
    ],
    'each deck carries the permission of the invite, and slide presence as a boolean',
  );
  assert.equal(res.body.presentations[1].sharedBy, ACTORS.owner.email);
});

test('shared-with-me hands back no slide content, only whether there are slides', async () => {
  await seed();
  const res = await call('GET', '/api/presentations/shared-with-me', {
    as: ACTORS.viewer,
  });

  assert.equal(res.body.presentations[1].slides, undefined);
  assert.doesNotMatch(res.raw, /"slides"/);
});

test('a trashed deck is not shared with anyone', async () => {
  await seed();
  const res = await call('GET', '/api/presentations/shared-with-me', {
    as: ACTORS.viewer,
  });

  assert.equal(
    res.body.presentations.some((p) => p.id === 'deck-trashed'),
    false,
  );
});

test('a collaborator row in another organization does not surface', async () => {
  await seed();
  const res = await call('GET', '/api/presentations/shared-with-me', {
    as: ACTORS.viewer,
  });

  assert.equal(
    res.body.presentations.some((p) => p.id === 'deck-foreign'),
    false,
    'the same address is a collaborator there; this session does not act in that organization',
  );
});

test('a revoked invite stops appearing in shared-with-me', async () => {
  await seed();
  const res = await call('GET', '/api/presentations/shared-with-me', {
    as: ACTORS.revoked,
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.presentations, []);
});

test('someone nobody shared with sees an empty list, not everyone else’s decks', async () => {
  await seed();
  const res = await call('GET', '/api/presentations/shared-with-me', {
    as: ACTORS.stranger,
  });

  assert.deepEqual(res.body.presentations, []);
});

test('shared-with-me refuses an anonymous caller', async () => {
  await seed();
  const res = await call('GET', '/api/presentations/shared-with-me');

  assert.equal(res.status, 401);
  assert.equal(res.body.presentations, undefined);
});

// ---------------------------------------------------------------------------
// POST /api/presentations/:id/collaborators — who may grant access
// ---------------------------------------------------------------------------

test('the owner adds a collaborator, and the invite is recorded once', async () => {
  await seed();
  const res = await call(
    'POST',
    '/api/presentations/deck-owned/collaborators',
    {
      as: ACTORS.owner,
      body: { userEmail: ACTORS.newcomer.email, permission: 'edit' },
    },
  );

  assert.equal(res.status, 201);
  assert.equal(res.body.isNew, true);
  assert.equal(res.body.collaborator.userEmail, ACTORS.newcomer.email);
  assert.equal(res.body.collaborator.permission, 'edit');

  const row = rowFor('deck-owned', ACTORS.newcomer.email);
  assert.equal(row.permission, 'edit');
  assert.equal(
    row.organization_id,
    ORG,
    'the row lands in the acting organization',
  );
  assert.equal(row.invited_by, ACTORS.owner.email);
  assert.equal(
    row.user_id,
    'user-newcomer',
    'the stable user id is written beside the email',
  );
});

test('adding a collaborator notifies them and lands in the activity feed', async () => {
  await seed();
  await call('POST', '/api/presentations/deck-owned/collaborators', {
    as: ACTORS.owner,
    body: { userEmail: ACTORS.newcomer.email, permission: 'comment' },
  });

  const notification = notifications().find(
    (n) => n.user_email === ACTORS.newcomer.email,
  );
  assert.equal(notification.notification_type, 'share_received');
  assert.equal(notification.presentation_id, 'deck-owned');
  assert.equal(notification.actor_email, ACTORS.owner.email);
  assert.match(
    notification.action_url,
    /\/app\/deck-owned\?email=newcomer%40example\.com$/,
    'the invite link pre-fills the address it was sent to',
  );

  const event = activity().find((e) => e.entity_type === 'collaborator');
  assert.equal(event.event_type, 'collaborator.added');
  assert.equal(event.presentation_id, 'deck-owned');
  assert.equal(event.data.collaboratorEmail, ACTORS.newcomer.email);
});

test('a collaborator holding admin may add collaborators', async () => {
  await seed();
  const res = await call(
    'POST',
    '/api/presentations/deck-owned/collaborators',
    {
      as: ACTORS.admin,
      body: { userEmail: ACTORS.newcomer.email, permission: 'view' },
    },
  );

  assert.equal(res.status, 201);
  assert.equal(
    rowFor('deck-owned', ACTORS.newcomer.email).invited_by,
    ACTORS.admin.email,
  );
});

test('nobody else may add a collaborator', async () => {
  for (const [key, why] of REFUSED) {
    await seed();
    const res = await call(
      'POST',
      '/api/presentations/deck-owned/collaborators',
      {
        as: actor(key),
        body: { userEmail: ACTORS.newcomer.email, permission: 'admin' },
      },
    );

    assert.equal(res.status, 401, `${key ?? 'anonymous'}: ${why}`);
    assert.equal(
      rowFor('deck-owned', ACTORS.newcomer.email),
      undefined,
      'no row is written',
    );
    assert.deepEqual(notifications(), [], 'and nobody is told anything');
  }
});

test('an organization deck does not make every colleague a collaborator manager', async () => {
  await seed();
  const res = await call(
    'POST',
    '/api/presentations/deck-organization/collaborators',
    {
      as: ACTORS.stranger,
      body: { userEmail: ACTORS.newcomer.email, permission: 'edit' },
    },
  );

  assert.equal(
    res.status,
    401,
    'organization visibility grants reading and writing, never handing the deck to someone new',
  );
  assert.equal(rowFor('deck-organization', ACTORS.newcomer.email), undefined);
});

test('a deck in another organization is absent, not forbidden', async () => {
  await seed();
  const res = await call(
    'POST',
    '/api/presentations/deck-foreign/collaborators',
    {
      as: ACTORS.owner,
      body: { userEmail: ACTORS.newcomer.email, permission: 'edit' },
    },
  );

  assert.equal(
    res.status,
    404,
    'the deck never reaches the authorization check',
  );
  assert.equal(rowFor('deck-foreign', ACTORS.newcomer.email), undefined);
});

test('its owner, acting in their own organization, still reaches that deck', async () => {
  await seed();
  const res = await call(
    'POST',
    '/api/presentations/deck-foreign/collaborators',
    {
      as: ACTORS.outsider,
      body: { userEmail: ACTORS.newcomer.email, permission: 'view' },
    },
  );

  // The invitee has no user row in that organization, so the invite is refused
  // on *membership* — which is the point: the 404 above was about the deck, not
  // about this actor being unable to act at all.
  assert.equal(res.status, 400);
  assert.equal(res.body.message, 'User not found in organization');
});

test('an unknown deck is a 404', async () => {
  await seed();
  const res = await call(
    'POST',
    '/api/presentations/deck-does-not-exist/collaborators',
    {
      as: ACTORS.owner,
      body: { userEmail: ACTORS.newcomer.email, permission: 'view' },
    },
  );

  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// POST — what the body may say
// ---------------------------------------------------------------------------

test('an invalid permission is refused before anything is written', async () => {
  await seed();
  for (const permission of ['owner', 'ADMIN', '', null, undefined]) {
    const res = await call(
      'POST',
      '/api/presentations/deck-owned/collaborators',
      {
        as: ACTORS.owner,
        body: { userEmail: ACTORS.newcomer.email, permission },
      },
    );
    assert.equal(
      res.status,
      400,
      `${JSON.stringify(permission)} is not a permission`,
    );
  }
  assert.equal(rowFor('deck-owned', ACTORS.newcomer.email), undefined);
});

test('a body without a usable address is a 400', async () => {
  await seed();
  for (const body of [
    { permission: 'view' },
    { permission: 'view', userEmail: 'not-an-address' },
    { permission: 'view', userEmail: '   ' },
    { permission: 'view', userEmails: [] },
  ]) {
    const res = await call(
      'POST',
      '/api/presentations/deck-owned/collaborators',
      {
        as: ACTORS.owner,
        body,
      },
    );
    assert.equal(res.status, 400, `${JSON.stringify(body)} is refused`);
  }
  assert.equal(
    rowsFor('deck-owned').length,
    4,
    'the seeded rows are all there is',
  );
});

test('an empty or unparseable body is a 400, not a crash', async () => {
  await seed();
  for (const body of [undefined, '{nope']) {
    const res = await call(
      'POST',
      '/api/presentations/deck-owned/collaborators',
      {
        as: ACTORS.owner,
        body,
      },
    );
    assert.equal(res.status, 400);
  }
});

test('you cannot add yourself', async () => {
  await seed();
  const res = await call(
    'POST',
    '/api/presentations/deck-owned/collaborators',
    {
      as: ACTORS.owner,
      body: { userEmail: 'OWNER@Example.com', permission: 'admin' },
    },
  );

  assert.equal(res.status, 400);
  assert.equal(rowFor('deck-owned', ACTORS.owner.email), undefined);
});

test('a batch larger than twenty is refused whole', async () => {
  await seed();
  const res = await call(
    'POST',
    '/api/presentations/deck-owned/collaborators',
    {
      as: ACTORS.owner,
      body: {
        permission: 'view',
        userEmails: Array.from(
          { length: 21 },
          (_, i) => `person${i}@example.com`,
        ),
      },
    },
  );

  assert.equal(res.status, 400);
  assert.equal(
    rowsFor('deck-owned').length,
    4,
    'not one of the twenty-one is written',
  );
});

test('someone outside the organization cannot be invited', async () => {
  await seed();
  const res = await call(
    'POST',
    '/api/presentations/deck-owned/collaborators',
    {
      as: ACTORS.owner,
      body: { userEmail: ACTORS.outsider.email, permission: 'view' },
    },
  );

  assert.equal(res.status, 400);
  assert.equal(rowFor('deck-owned', ACTORS.outsider.email), undefined);
  assert.deepEqual(
    notifications(),
    [],
    'and no notification leaves the organization',
  );
});

test('adding an existing collaborator twice is a conflict, not a silent upgrade', async () => {
  await seed();
  const res = await call(
    'POST',
    '/api/presentations/deck-owned/collaborators',
    {
      as: ACTORS.owner,
      body: { userEmail: ACTORS.viewer.email, permission: 'admin' },
    },
  );

  assert.equal(res.status, 409);
  assert.equal(
    rowFor('deck-owned', ACTORS.viewer.email).permission,
    'view',
    'the standing permission is untouched',
  );
});

test('re-adding a revoked collaborator reactivates the row at the new permission', async () => {
  await seed();
  const res = await call(
    'POST',
    '/api/presentations/deck-owned/collaborators',
    {
      as: ACTORS.owner,
      body: { userEmail: ACTORS.revoked.email, permission: 'comment' },
    },
  );

  assert.equal(res.status, 201);
  assert.equal(res.body.reactivated, true);

  const row = rowFor('deck-owned', ACTORS.revoked.email);
  assert.equal(row.permission, 'comment');
  assert.equal(row.revoked_at, null);
  assert.equal(row.revoked_by, null);
  assert.equal(rowsFor('deck-owned').length, 4, 'reactivated, not duplicated');
});

/**
 * Make the next insert into a table blow up, the way a real database does when
 * a connection drops or a constraint fires unexpectedly. The route's own
 * try/catch around `addCollaborator` is the thing under test: `withDbGuard`
 * only guards *availability* (`server/storage/utils/db-guard.js`), so a
 * throwing query propagates out of the storage layer untouched.
 *
 * @param {string} table - Table whose insert must throw.
 */
function breakInsertsInto(table) {
  const realInsertInto = db.insertInto.bind(db);
  db.insertInto = (name) => {
    if (name === table) throw new Error('deadlock detected');
    return realInsertInto(name);
  };
}

test("a database failure during a single invite is our fault, not the caller's", async () => {
  await seed();
  breakInsertsInto('presentation_collaborators');

  const res = await call(
    'POST',
    '/api/presentations/deck-owned/collaborators',
    {
      as: ACTORS.owner,
      body: { userEmail: ACTORS.newcomer.email, permission: 'view' },
    },
  );

  // The regression: `database_error` used to fall through to `badRequest`, so
  // a failed insert told the client its request was malformed — nothing for it
  // to fix, and invisible to any dashboard watching 5xx.
  assert.equal(res.status, 500, 'a failed insert is a 500, not a 400');
  assert.equal(res.body.error, 'database_error');
  assert.equal(
    rowFor('deck-owned', ACTORS.newcomer.email),
    undefined,
    'and nothing is written',
  );
});

test('a database failure inside a batch is reported per address, not as a 400', async () => {
  await seed();
  breakInsertsInto('presentation_collaborators');

  const res = await call(
    'POST',
    '/api/presentations/deck-owned/collaborators',
    {
      as: ACTORS.owner,
      body: {
        permission: 'view',
        userEmails: [ACTORS.newcomer.email, ACTORS.stranger.email],
      },
    },
  );

  // Batch mode already answered factually and must keep doing so: the batch
  // envelope is a report, so the transport stays 201 and each address carries
  // its own reason.
  assert.equal(res.status, 201);
  assert.deepEqual(
    res.body.results.map((r) => [r.email, r.ok, r.reason]),
    [
      [ACTORS.newcomer.email, false, 'database_error'],
      [ACTORS.stranger.email, false, 'database_error'],
    ],
  );
});

test('the reasons a single invite can fail each carry their own status', async () => {
  const cases = [
    // [body, expected status, expected error code]
    [{ userEmail: ACTORS.newcomer.email, permission: 'view' }, 201, null],
    [
      { userEmail: ACTORS.viewer.email, permission: 'view' },
      409,
      'already_exists',
    ],
    [
      { userEmail: 'ghost@example.com', permission: 'view' },
      400,
      'user_not_found',
    ],
  ];

  for (const [body, status, code] of cases) {
    await seed();
    const res = await call(
      'POST',
      '/api/presentations/deck-owned/collaborators',
      {
        as: ACTORS.owner,
        body,
      },
    );
    assert.equal(res.status, status, `${JSON.stringify(body)} → ${status}`);
    if (code)
      assert.equal(res.body.error, code, `${JSON.stringify(body)} → ${code}`);
  }
});

test('a batch reports per address and does not let one failure sink the rest', async () => {
  await seed();
  const res = await call(
    'POST',
    '/api/presentations/deck-owned/collaborators',
    {
      as: ACTORS.owner,
      body: {
        permission: 'view',
        userEmails: [
          ACTORS.newcomer.email,
          'ghost@example.com',
          ACTORS.viewer.email,
        ],
      },
    },
  );

  assert.equal(res.status, 201);
  assert.deepEqual(
    res.body.results.map((r) => [r.email, r.ok, r.reason]),
    [
      [ACTORS.newcomer.email, true, undefined],
      ['ghost@example.com', false, 'user_not_found'],
      [ACTORS.viewer.email, false, 'already_exists'],
    ],
  );
  assert.deepEqual(res.body.summary, { total: 3, successful: 1, failed: 2 });
  assert.equal(rowFor('deck-owned', ACTORS.newcomer.email).permission, 'view');
  assert.equal(rowFor('deck-owned', 'ghost@example.com'), undefined);
});

// ---------------------------------------------------------------------------
// GET /api/presentations/:id/collaborators
// ---------------------------------------------------------------------------

test('the owner sees the live collaborators, enriched with names', async () => {
  await seed();
  const res = await call('GET', '/api/presentations/deck-owned/collaborators', {
    as: ACTORS.owner,
  });

  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.collaborators.map((c) => [c.userEmail, c.permission, c.userName]),
    [
      [ACTORS.admin.email, 'admin', 'Ada'],
      [ACTORS.editor.email, 'edit', 'Ed'],
      [ACTORS.viewer.email, 'view', 'Vera'],
    ],
    'the revoked invite is not a collaborator',
  );
});

test('the collaborator list carries no password hashes', async () => {
  await seed();
  const res = await call('GET', '/api/presentations/deck-owned/collaborators', {
    as: ACTORS.owner,
  });

  assert.doesNotMatch(res.raw, /password|hash|scrypt/i);
});

test('a collaborator holding admin may read the list', async () => {
  await seed();
  const res = await call('GET', '/api/presentations/deck-owned/collaborators', {
    as: ACTORS.admin,
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.collaborators.length, 3);
});

test('nobody else may read the collaborator list', async () => {
  await seed();
  for (const [key, why] of REFUSED) {
    const res = await call(
      'GET',
      '/api/presentations/deck-owned/collaborators',
      {
        as: actor(key),
      },
    );
    assert.equal(res.status, 401, `${key ?? 'anonymous'}: ${why}`);
    assert.equal(res.body.collaborators, undefined, 'and learns no addresses');
  }
});

test('the collaborator list of a deck in another organization is a 404', async () => {
  await seed();
  const res = await call(
    'GET',
    '/api/presentations/deck-foreign/collaborators',
    {
      as: ACTORS.owner,
    },
  );

  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// DELETE /api/presentations/:id/collaborators/:email
// ---------------------------------------------------------------------------

test('the owner revokes an invite, with a message and an attribution', async () => {
  await seed();
  const res = await call(
    'DELETE',
    `/api/presentations/deck-owned/collaborators/${ACTORS.viewer.email}`,
    { as: ACTORS.owner, body: { message: 'Project finished.' } },
  );

  assert.equal(res.status, 200);
  const row = rowFor('deck-owned', ACTORS.viewer.email);
  assert.equal(row.revoked_by, ACTORS.owner.email);
  assert.equal(row.revocation_message, 'Project finished.');
  assert.equal(typeof row.revoked_at, 'string');
  assert.equal(rowsFor('deck-owned').length, 4, 'revoked, not deleted');
});

test('revoking logs a collaborator.removed event and hands the message back', async () => {
  await seed();
  const res = await call(
    'DELETE',
    `/api/presentations/deck-owned/collaborators/${ACTORS.viewer.email}`,
    { as: ACTORS.owner, body: { message: 'Project finished.' } },
  );

  assert.equal(res.status, 200);
  // The revocation message is delivered, not merely stored — share-links already
  // hand theirs to the denied accessor; the collaborator response now does the
  // symmetric thing (B44(a)/D8).
  assert.equal(res.body.collaborator.revocationMessage, 'Project finished.');

  // And the revoke lands in the feed the way a grant does — the audit half that
  // was missing.
  const event = activity().find((e) => e.event_type === 'collaborator.removed');
  assert.ok(
    event,
    'a revoke writes an event, symmetric with collaborator.added',
  );
  assert.equal(event.presentation_id, 'deck-owned');
  assert.equal(event.entity_type, 'collaborator');
  assert.equal(event.actor_email, ACTORS.owner.email);
  assert.equal(event.data.collaboratorEmail, ACTORS.viewer.email);
  assert.equal(event.data.revocationMessage, 'Project finished.');
});

test('a revoke with no message still logs, with a null message in the payload', async () => {
  await seed();
  const res = await call(
    'DELETE',
    `/api/presentations/deck-owned/collaborators/${ACTORS.editor.email}`,
    { as: ACTORS.owner },
  );

  assert.equal(res.status, 200);
  assert.equal(
    res.body.collaborator.revocationMessage,
    null,
    'absent stays null, not undefined',
  );
  assert.ok(
    activity().some((e) => e.event_type === 'collaborator.removed'),
    'the event is written whether or not a message was given',
  );
});

test('an url-encoded address in the path reaches the right row', async () => {
  await seed();
  const res = await call(
    'DELETE',
    `/api/presentations/deck-owned/collaborators/${encodeURIComponent(ACTORS.editor.email)}`,
    { as: ACTORS.owner },
  );

  assert.equal(res.status, 200);
  assert.equal(
    typeof rowFor('deck-owned', ACTORS.editor.email).revoked_at,
    'string',
  );
});

test('revoking someone who is not a collaborator is a 404', async () => {
  await seed();
  for (const email of [ACTORS.stranger.email, ACTORS.revoked.email]) {
    const res = await call(
      'DELETE',
      `/api/presentations/deck-owned/collaborators/${email}`,
      { as: ACTORS.owner },
    );
    assert.equal(res.status, 404, `${email} holds no live invite`);
  }
});

test('nobody but the owner or an admin may revoke', async () => {
  for (const [key, why] of REFUSED) {
    await seed();
    const res = await call(
      'DELETE',
      `/api/presentations/deck-owned/collaborators/${ACTORS.admin.email}`,
      { as: actor(key) },
    );

    assert.equal(res.status, 401, `${key ?? 'anonymous'}: ${why}`);
    assert.equal(
      rowFor('deck-owned', ACTORS.admin.email).revoked_at,
      null,
      'the invite stands',
    );
  }
});

test('an admin collaborator may revoke', async () => {
  await seed();
  const res = await call(
    'DELETE',
    `/api/presentations/deck-owned/collaborators/${ACTORS.editor.email}`,
    { as: ACTORS.admin },
  );

  assert.equal(res.status, 200);
  assert.equal(
    rowFor('deck-owned', ACTORS.editor.email).revoked_by,
    ACTORS.admin.email,
  );
});

test('revoking on a deck in another organization is a 404', async () => {
  await seed();
  const res = await call(
    'DELETE',
    `/api/presentations/deck-foreign/collaborators/${ACTORS.viewer.email}`,
    { as: ACTORS.owner },
  );

  assert.equal(res.status, 404);
  assert.equal(rowFor('deck-foreign', ACTORS.viewer.email).revoked_at, null);
});

// ---------------------------------------------------------------------------
// PATCH /api/presentations/:id/collaborators/:email
// ---------------------------------------------------------------------------

test('the owner changes a permission', async () => {
  await seed();
  const res = await call(
    'PATCH',
    `/api/presentations/deck-owned/collaborators/${ACTORS.viewer.email}`,
    { as: ACTORS.owner, body: { permission: 'admin' } },
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.collaborator.permission, 'admin');
  assert.equal(rowFor('deck-owned', ACTORS.viewer.email).permission, 'admin');
});

test('changing a permission logs a collaborator.permission_changed event', async () => {
  await seed();
  const res = await call(
    'PATCH',
    `/api/presentations/deck-owned/collaborators/${ACTORS.viewer.email}`,
    { as: ACTORS.owner, body: { permission: 'admin' } },
  );

  assert.equal(res.status, 200);
  const event = activity().find(
    (e) => e.event_type === 'collaborator.permission_changed',
  );
  assert.ok(event, 'a permission change is an access-model event too');
  assert.equal(event.presentation_id, 'deck-owned');
  assert.equal(event.entity_type, 'collaborator');
  assert.equal(event.actor_email, ACTORS.owner.email);
  assert.equal(event.data.collaboratorEmail, ACTORS.viewer.email);
  assert.equal(event.data.permission, 'admin');
});

test('a refused permission change writes no event', async () => {
  await seed();
  await call(
    'PATCH',
    `/api/presentations/deck-owned/collaborators/${ACTORS.viewer.email}`,
    { as: ACTORS.editor, body: { permission: 'admin' } },
  );
  assert.deepEqual(
    activity().filter(
      (e) => e.event_type === 'collaborator.permission_changed',
    ),
    [],
    'an unauthorized change reaches neither the row nor the feed',
  );
});

test('an invalid permission changes nothing', async () => {
  await seed();
  for (const permission of ['superuser', '', null]) {
    const res = await call(
      'PATCH',
      `/api/presentations/deck-owned/collaborators/${ACTORS.viewer.email}`,
      { as: ACTORS.owner, body: { permission } },
    );
    assert.equal(
      res.status,
      400,
      `${JSON.stringify(permission)} is not a permission`,
    );
  }
  assert.equal(rowFor('deck-owned', ACTORS.viewer.email).permission, 'view');
});

test('changing the permission of a revoked invite is a 404', async () => {
  await seed();
  const res = await call(
    'PATCH',
    `/api/presentations/deck-owned/collaborators/${ACTORS.revoked.email}`,
    { as: ACTORS.owner, body: { permission: 'edit' } },
  );

  assert.equal(res.status, 404);
  assert.equal(rowFor('deck-owned', ACTORS.revoked.email).permission, 'view');
});

test('nobody but the owner or an admin may change a permission', async () => {
  for (const [key, why] of REFUSED) {
    await seed();
    const res = await call(
      'PATCH',
      `/api/presentations/deck-owned/collaborators/${ACTORS.viewer.email}`,
      { as: actor(key), body: { permission: 'admin' } },
    );

    assert.equal(res.status, 401, `${key ?? 'anonymous'}: ${why}`);
    assert.equal(
      rowFor('deck-owned', ACTORS.viewer.email).permission,
      'view',
      'nobody promotes themselves or anyone else',
    );
  }
});

test('an editor cannot promote themselves to admin', async () => {
  await seed();
  const res = await call(
    'PATCH',
    `/api/presentations/deck-owned/collaborators/${ACTORS.editor.email}`,
    { as: ACTORS.editor, body: { permission: 'admin' } },
  );

  assert.equal(res.status, 401);
  assert.equal(rowFor('deck-owned', ACTORS.editor.email).permission, 'edit');
});

test('changing a permission on a deck in another organization is a 404', async () => {
  await seed();
  const res = await call(
    'PATCH',
    `/api/presentations/deck-foreign/collaborators/${ACTORS.viewer.email}`,
    { as: ACTORS.owner, body: { permission: 'view' } },
  );

  assert.equal(res.status, 404);
  assert.equal(rowFor('deck-foreign', ACTORS.viewer.email).permission, 'edit');
});

// ---------------------------------------------------------------------------
// What this module does not answer
// ---------------------------------------------------------------------------

test('the handler declines everything outside its five endpoints', async () => {
  await seed();
  const declined = [
    ['PUT', '/api/presentations/deck-owned/collaborators'],
    ['DELETE', '/api/presentations/deck-owned/collaborators'],
    [
      'POST',
      `/api/presentations/deck-owned/collaborators/${ACTORS.viewer.email}`,
    ],
    [
      'GET',
      `/api/presentations/deck-owned/collaborators/${ACTORS.viewer.email}`,
    ],
    ['POST', '/api/presentations/shared-with-me'],
    ['GET', '/api/presentations/deck-owned'],
    ['GET', '/api/presentations/deck-owned/collaborators/deep/nested'],
  ];

  for (const [method, path] of declined) {
    const res = await call(method, path, { as: ACTORS.owner });
    assert.equal(res.handled, false, `${method} ${path} is not this module's`);
    assert.equal(res.status, null, 'and nothing was written to the response');
  }
});
