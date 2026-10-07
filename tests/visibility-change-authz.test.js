/**
 * Visibility change — behaviour through the route (B574).
 *
 * `PATCH /api/presentations/:id/visibility` opens a deck to the organization or
 * takes it back, and sets the view-only flag that keeps organization members
 * from editing it. The decision lives in `changeVisibility`
 * (`server/services/visibility.js`); the route only parses and answers. The
 * internal contract is the only one that offers the handling (no v1 or MCP
 * visibility change), so this file is the test per contract.
 *
 * The rules, as the service applies them:
 *   - read is the floor, as for every deck right: a caller who cannot read the
 *     deck is refused before the transition is asked, so the write can no
 *     longer hand a non-reader the deck in its answer;
 *   - private → organization is the owner's, or an organization admin's;
 *     organization → private is an organization admin's alone
 *     (`canChangePresentationVisibility`, D49);
 *   - view-only is set by an author (owner or creator), only on a deck visible
 *     to the organization, and moving a deck to private clears it;
 *   - every malformed field is a 400 `invalid` naming it; nothing is coerced.
 *
 * Every refusal is asserted against the store, not read off the status code: a
 * refused change must leave the deck as it was, revision included.
 *
 * House shape as tests/ownership-transfer-authz.test.js: the exported
 * dispatcher with a req/res double over tests/helpers/fake-db.js.
 *
 * Run with: node --test tests/visibility-change-authz.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { testScope } = await import('./helpers/storage-scope.js');
const { createPresentation, getPresentation } =
  await import('../server/storage/presentations/index.js');
const { listActivityEvents } =
  await import('../server/storage/activity-events.js');
const { invalidatePermission } =
  await import('../server/storage/cache/permission-cache.js');
const { handlePresentations } =
  await import('../server/routes/api/presentations/index.js');

// --- The people -------------------------------------------------------------

const uid = (email) => `user-${email.split('@')[0]}`;
const person = (email, name) => ({
  id: uid(email),
  email,
  name,
  organizationId: ORG,
});

const OWNER = person('owner@example.com', 'Olive');
const EDITOR = person('editor@example.com', 'Ed');
const VIEWER = person('viewer@example.com', 'Vera');
const COLLAB_ADMIN = person('collabadmin@example.com', 'Cleo');
const STRANGER = person('stranger@example.com', 'Sam');
const ADMIN = { ...person('admin@example.com', 'Ada'), isAdmin: true };

const EVERYONE = [OWNER, EDITOR, VIEWER, COLLAB_ADMIN, STRANGER, ADMIN];

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: EVERYONE.map((a) => ({
      id: a.id,
      organization_id: ORG,
      email: a.email,
      name: a.name,
      role: a.isAdmin ? 'admin' : 'user',
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
  __resetStorageForTests();
  __setTestDb(null);
});

/**
 * A fresh deck owned by OWNER, with an edit, a view and an admin collaborator.
 *
 * @param {Object} [options]
 * @param {'private'|'organization'} [options.visibility='private']
 * @param {boolean} [options.isViewOnly=false]
 * @returns {Promise<Object>} The stored deck.
 */
async function seed({ visibility = 'private', isViewOnly = false } = {}) {
  const created = await createPresentation(testScope(), {
    title: 'Deck that changes audience',
    ownerEmail: OWNER.email,
    slides: [{ type: 'content-slide', content: { title: 'A' } }],
  });
  const row = db.__tables.presentations.find((r) => r.id === created.id);
  row.visibility = visibility;
  row.is_view_only = isViewOnly;

  db.__tables.presentation_collaborators ||= [];
  for (const [actor, permission] of [
    [EDITOR, 'edit'],
    [VIEWER, 'view'],
    [COLLAB_ADMIN, 'admin'],
  ]) {
    db.__tables.presentation_collaborators.push({
      id: `collab-${created.id}-${actor.id}`,
      organization_id: ORG,
      presentation_id: created.id,
      user_id: actor.id,
      user_email: actor.email,
      permission,
      invited_by: OWNER.email,
      invited_at: '2026-01-01T00:00:00.000Z',
      accepted_at: '2026-01-01T00:00:00.000Z',
      revoked_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
    });
  }
  for (const actor of EVERYONE)
    await invalidatePermission(created.id, actor.email);
  const pres = await getPresentation(testScope(), created.id);
  assert.equal(pres.visibility, visibility, 'the seed took');
  assert.equal(pres.isViewOnly, isViewOnly, 'the seed took');
  return pres;
}

// --- The request double -----------------------------------------------------

function makeRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      return this;
    },
    end(payload) {
      this.body = payload;
    },
  };
}

const jsonBody = (res) => JSON.parse(String(res.body || '{}'));

/**
 * PATCH the visibility route through `handlePresentations`, the module's
 * dispatcher, so its error handler renders the service's refusals.
 *
 * @param {Object} pres - The deck; its revision becomes the If-Match.
 * @param {Object} options
 * @param {Object|null} [options.as] - Acting user; omit for anonymous.
 * @param {Object} options.body - JSON request body.
 * @param {boolean} [options.ifMatch=true] - Send the If-Match header.
 */
async function patch(pres, { as = null, body, ifMatch = true }) {
  const payload = JSON.stringify(body);
  const req = {
    method: 'PATCH',
    headers: {
      host: 'decks.example.test',
      'content-type': 'application/json',
      ...(ifMatch ? { 'if-match': `"${pres.revision}"` } : {}),
    },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload, 'utf8');
    },
  };
  const res = makeRes();
  const authedUser = as || undefined;
  await handlePresentations({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(authedUser, { repoRoot: process.cwd() }),
    req,
    res,
    url: new URL(
      `http://decks.example.test/api/presentations/${pres.id}/visibility`,
    ),
    authedUser,
  });
  return res;
}

/** Assert a refused change left the deck exactly as it was. */
async function assertUnchanged(pres, why) {
  const after = await getPresentation(testScope(), pres.id);
  assert.equal(after.visibility, pres.visibility, why);
  assert.equal(after.isViewOnly, pres.isViewOnly, `${why} (view-only)`);
  assert.equal(after.revision, pres.revision, `${why} (nothing was written)`);
}

/** Let the background activity write land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

// ===========================================================================
// The changes that go through
// ===========================================================================

test('the owner opens a private deck to the organization', async () => {
  const pres = await seed();
  const res = await patch(pres, {
    as: OWNER,
    body: { visibility: 'organization' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(jsonBody(res).visibility, 'organization');
  const after = await getPresentation(testScope(), pres.id);
  assert.equal(after.visibility, 'organization');
  assert.equal(after.revision, pres.revision + 1);
  assert.deepEqual(
    after.slides.map((s) => s.content?.title),
    ['A'],
    'the slides are not part of the write',
  );
});

test('opening a deck to the organization leaves the activity row', async () => {
  // The editor save wrote this row only when visibility changed, and it never
  // can; until B574 the row was written by nobody.
  const pres = await seed();
  await patch(pres, { as: OWNER, body: { visibility: 'organization' } });
  await settle();

  const { events } = await listActivityEvents(testScope(), {
    presentationId: pres.id,
    eventType: 'presentation.moved_to_organization',
  });
  assert.equal(events.length, 1, 'the move is on the activity log');
  assert.equal(events[0].data.previousVisibility, 'private');
  assert.equal(events[0].data.newVisibility, 'organization');
});

test('the owner shares as view-only in the same request', async () => {
  const pres = await seed();
  const res = await patch(pres, {
    as: OWNER,
    body: { visibility: 'organization', isViewOnly: true },
  });
  assert.equal(res.statusCode, 200);
  const after = await getPresentation(testScope(), pres.id);
  assert.equal(after.visibility, 'organization');
  assert.equal(after.isViewOnly, true);
});

test('an organization admin takes a deck back to private, which clears view-only', async () => {
  const pres = await seed({ visibility: 'organization', isViewOnly: true });
  const res = await patch(pres, {
    as: ADMIN,
    body: { visibility: 'private' },
  });
  assert.equal(res.statusCode, 200);
  const after = await getPresentation(testScope(), pres.id);
  assert.equal(after.visibility, 'private');
  assert.equal(after.isViewOnly, false, 'a private deck is never view-only');

  await settle();
  const { events } = await listActivityEvents(testScope(), {
    presentationId: pres.id,
    eventType: 'presentation.moved_to_organization',
  });
  assert.equal(events.length, 0, 'narrowing is not announced');
});

// ===========================================================================
// Who is refused
// ===========================================================================

const REFUSED_WIDENING = [
  [STRANGER, 'a member who cannot read the deck'],
  [VIEWER, 'a view collaborator'],
  [EDITOR, 'an edit collaborator: writing a deck is not owning it'],
  [COLLAB_ADMIN, 'an admin collaborator'],
  [
    ADMIN,
    'an organization admin who cannot read the private deck: read is the floor',
  ],
];

for (const [actor, who] of REFUSED_WIDENING) {
  test(`opening a private deck is refused for ${who}`, async () => {
    const pres = await seed();
    const res = await patch(pres, {
      as: actor,
      body: { visibility: 'organization' },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(jsonBody(res).ok, false);
    await assertUnchanged(pres, 'a refused change writes nothing');
  });
}

test('a no-op change by someone who cannot read the deck is refused', async () => {
  // `canChangePresentationVisibility` answers yes to any signed-in caller when
  // from === to, and the route used to answer with the whole deck.
  const pres = await seed();
  const res = await patch(pres, {
    as: STRANGER,
    body: { visibility: 'private' },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(jsonBody(res).title, undefined, 'the deck is not in the answer');
  await assertUnchanged(pres, 'nothing is written');
});

test('an anonymous caller is refused', async () => {
  const pres = await seed();
  const res = await patch(pres, { body: { visibility: 'organization' } });
  assert.ok([401, 403].includes(res.statusCode), `got ${res.statusCode}`);
  await assertUnchanged(pres, 'nothing is written');
});

test('the owner may not take an organization deck back to private', async () => {
  const pres = await seed({ visibility: 'organization' });
  const res = await patch(pres, {
    as: OWNER,
    body: { visibility: 'private' },
  });
  assert.equal(res.statusCode, 403);
  await assertUnchanged(pres, 'narrowing is an admin act');
});

test('an editor on an organization deck may not set view-only', async () => {
  const pres = await seed({ visibility: 'organization' });
  const res = await patch(pres, {
    as: EDITOR,
    body: { visibility: 'organization', isViewOnly: true },
  });
  assert.equal(res.statusCode, 403);
  await assertUnchanged(pres, 'view-only is an author act');
});

test('an absent deck is 404', async () => {
  const res = await patch(
    { id: '00000000-0000-4000-8000-00000000dead', revision: 1 },
    { as: OWNER, body: { visibility: 'organization' } },
  );
  assert.equal(res.statusCode, 404);
});

// ===========================================================================
// Malformed input: refused, never corrected
// ===========================================================================

const MALFORMED = [
  [{ visibility: 'public' }, 'visibility', 'an unknown visibility'],
  [{}, 'visibility', 'no visibility at all'],
  [
    { visibility: 'organization', isViewOnly: 'true' },
    'isViewOnly',
    'a string isViewOnly (it was silently ignored)',
  ],
  [
    { visibility: 'private', isViewOnly: true },
    'isViewOnly',
    'view-only on a private deck',
  ],
];

for (const [body, field, what] of MALFORMED) {
  test(`${what} is 400 invalid naming ${field}`, async () => {
    const pres = await seed();
    const res = await patch(pres, { as: OWNER, body });
    assert.equal(res.statusCode, 400);
    const out = jsonBody(res);
    assert.equal(out.error, 'invalid');
    assert.equal(out.details?.field, field);
    await assertUnchanged(pres, 'a refused change writes nothing');
  });
}

test('no If-Match is 428, after the rights are settled', async () => {
  const pres = await seed();
  const res = await patch(pres, {
    as: OWNER,
    body: { visibility: 'organization' },
    ifMatch: false,
  });
  assert.equal(res.statusCode, 428);
  assert.equal(jsonBody(res).error, 'missing_if_match');
  await assertUnchanged(pres, 'nothing is written without a revision');
});

test('a stale If-Match is a conflict and writes nothing', async () => {
  const pres = await seed();
  const res = await patch(
    { ...pres, revision: pres.revision - 1 },
    { as: OWNER, body: { visibility: 'organization' } },
  );
  assert.equal(res.statusCode, 409);
  await assertUnchanged(pres, 'the deck moved on; this write lost');
});
