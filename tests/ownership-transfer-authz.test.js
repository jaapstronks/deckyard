/**
 * Ownership transfer — behaviour through the route (B115).
 *
 * `server/routes/api/presentations/ownership.js` carries the heaviest write a
 * deck has: it moves the deck out of one person's hands into another's, and
 * the mover loses the very grant that let them move it. Until now the module's
 * only coverage was `c8-routes-presentations-dispatch` — a table that proves a
 * path maps to a handler *name*, and nothing about what the handler does.
 *
 * The rule: **transfer is an owner-only act.** `canTransferOwnership` grants to
 * the owner stamp and the unrestricted operator, and to nobody else — not the
 * creator (D43: the grant has to be one the hand-over can take away), and no
 * collaborator rung reaches it, not even `admin`. An instance admin is not a
 * grant either; that is the same design B114 pinned on the guest surface:
 * `isAdmin` is a flag on the actor, `isUnrestricted` is the operator bypass,
 * and only the second one opens ownership-scoped gates.
 *
 * The endpoint is singular. The B115 item speaks of "transfer/claim endpoints";
 * there is no claim endpoint — `POST /api/presentations/:id/transfer-ownership`
 * is the whole ownership surface (see the PR description).
 *
 * Every refusal is asserted against the store, not read off the status code:
 * after a refused transfer the deck must still name the old owner, on both keys
 * of the D22 pair (`ownerEmail` *and* `ownerId`), because a transfer that moved
 * only the address would report success and grant nothing.
 *
 * House shape (as in tests/share-link-guest-management-authz.test.js, #897):
 * the exported dispatcher is called with a req/res double over
 * tests/helpers/fake-db.js, and the scope is built with the same
 * `createStorageScope()` the router makes. No HTTP server, no live Postgres.
 *
 * Run with: node --test tests/ownership-transfer-authz.test.js
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
const { listCollaborators } =
  await import('../server/storage/collaborators.js');
const { listNotifications } =
  await import('../server/storage/notifications.js');
const { listActivityEvents } =
  await import('../server/storage/activity-events.js');
const { invalidatePermission } =
  await import('../server/storage/cache/permission-cache.js');
const { handlePresentations } =
  await import('../server/routes/api/presentations.js');

// --- The people -------------------------------------------------------------
// Ownership keys on `users.id` (D22), so a seeded row and the session acting on
// it have to agree on the id — deriving it from the address keeps that readable.
const uid = (email) => `user-${email.split('@')[0]}`;
const person = (email, name) => ({
  id: uid(email),
  email,
  name,
  organizationId: ORG,
});

const OWNER = person('owner@example.com', 'Olive');
const HEIR = person('heir@example.com', 'Hank');
const EDITOR = person('editor@example.com', 'Ed');
const COMMENTER = person('commenter@example.com', 'Cass');
const VIEWER = person('viewer@example.com', 'Vera');
const COLLAB_ADMIN = person('collabadmin@example.com', 'Cleo');
const STRANGER = person('stranger@example.com', 'Sam');
const ADMIN = { ...person('admin@example.com', 'Ada'), isAdmin: true };

const EVERYONE = [
  OWNER,
  HEIR,
  EDITOR,
  COMMENTER,
  VIEWER,
  COLLAB_ADMIN,
  STRANGER,
  ADMIN,
];

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    // `createPresentation` stamps `owner_user_id` by resolving the address it
    // is given, so an owner with no user row would create a deck nobody owns
    // and every cell below would pass for the wrong reason.
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
 * A fresh deck with the full collaborator ladder on it.
 *
 * Fresh per test because a transfer rewrites the owner and the collaborator
 * set; a shared fixture would make every assertion order-dependent.
 * `invalidatePermission` is needed because `getCollaboratorPermission` memoizes
 * on `(presentationId, email)` and only the deck id changes per seed — the
 * addresses do not.
 *
 * @returns {Promise<{id: string}>}
 */
async function seed() {
  const pres = await createPresentation(testScope(), {
    title: 'Deck that changes hands',
    ownerEmail: OWNER.email,
    slides: [{ type: 'content-slide', content: { title: 'A' } }],
  });

  db.__tables.presentation_collaborators ||= [];
  for (const [actor, permission] of [
    [EDITOR, 'edit'],
    [COMMENTER, 'comment'],
    [VIEWER, 'view'],
    [COLLAB_ADMIN, 'admin'],
  ]) {
    db.__tables.presentation_collaborators.push({
      id: `collab-${pres.id}-${actor.id}`,
      organization_id: ORG,
      presentation_id: pres.id,
      user_id: actor.id,
      user_email: actor.email,
      permission,
      invited_by: OWNER.email,
      invited_at: '2026-01-01T00:00:00.000Z',
      accepted_at: '2026-01-01T00:00:00.000Z',
      revoked_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    await invalidatePermission(pres.id, actor.email);
  }
  for (const actor of EVERYONE)
    await invalidatePermission(pres.id, actor.email);
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
 * Drive one request through `handlePresentations`, the module's dispatcher.
 *
 * Going through the dispatcher rather than calling `handleOwnershipTransfer`
 * directly is the point: the pattern that captures `:id` and the position of
 * the ownership row in the table are part of what a caller can reach.
 *
 * @param {string} method
 * @param {string} pathname
 * @param {Object} [options]
 * @param {Object|null} [options.as] - Acting user; omit for anonymous.
 * @param {Object} [options.body] - JSON request body.
 * @returns {Promise<{handled: *, res: Object}>}
 */
async function call(method, pathname, { as = null, body } = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const req = {
    method,
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload, 'utf8');
    },
  };
  const res = makeRes();
  const authedUser = as || undefined;
  const handled = await handlePresentations({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(authedUser, { repoRoot: process.cwd() }),
    req,
    res,
    url: new URL(`http://decks.example.test${pathname}`),
    authedUser,
  });
  return { handled, res };
}

const transferPath = (id) => `/api/presentations/${id}/transfer-ownership`;

/**
 * Assert that a deck still belongs to the person it belonged to, on both keys.
 * @param {string} id
 * @param {Object} owner
 * @param {string} why
 */
async function assertStillOwnedBy(id, owner, why) {
  const pres = await getPresentation(testScope(), id);
  assert.equal(pres.ownerEmail, owner.email, why);
  assert.equal(pres.ownerId, owner.id, `${why} (id half of the D22 pair)`);
}

/** Everyone this surface must refuse, with what makes each interesting. */
const REFUSED = [
  [null, 'an anonymous caller'],
  [STRANGER, 'a signed-in user with no relation to the deck'],
  [VIEWER, 'a view-only collaborator'],
  [COMMENTER, 'a comment collaborator'],
  [EDITOR, 'an edit collaborator — writing a deck is not owning it'],
  [COLLAB_ADMIN, 'an admin collaborator — the top rung is still not ownership'],
  [ADMIN, 'an instance admin on someone else’s deck'],
];

// ===========================================================================
// Transfer — the happy path, asserted in the store
// ===========================================================================

test('the owner transfers the deck, and both owner keys move', async () => {
  const pres = await seed();
  const { res } = await call('POST', transferPath(pres.id), {
    as: OWNER,
    body: { newOwnerEmail: 'HEIR@Example.com' },
  });

  assert.equal(res.statusCode, 200);
  const out = jsonBody(res);
  assert.equal(out.ok, true);
  assert.equal(out.previousOwner, OWNER.email);
  assert.equal(out.newOwner, HEIR.email, 'the address is normalized');

  // The store, not the status code: a transfer that answered 200 while
  // persisting nothing is exactly the bug `allowOwnerChange` was added for.
  await assertStillOwnedBy(pres.id, HEIR, 'the deck changed hands');
});

test('the previous owner is kept on as an edit collaborator by default', async () => {
  const pres = await seed();
  const { res } = await call('POST', transferPath(pres.id), {
    as: OWNER,
    body: { newOwnerEmail: HEIR.email },
  });
  assert.equal(jsonBody(res).previousOwnerKeptAsCollaborator, true);

  const rows = await listCollaborators(pres.id);
  const old = rows.find((r) => r.userEmail === OWNER.email);
  assert.ok(old, 'the previous owner is on the deck');
  assert.equal(old.permission, 'edit', 'and holds edit, not admin');
});

test('keepAsCollaborator:false hands the deck over completely', async () => {
  const pres = await seed();
  const { res } = await call('POST', transferPath(pres.id), {
    as: OWNER,
    body: { newOwnerEmail: HEIR.email, keepAsCollaborator: false },
  });
  assert.equal(jsonBody(res).previousOwnerKeptAsCollaborator, false);

  const rows = await listCollaborators(pres.id);
  assert.equal(
    rows.find((r) => r.userEmail === OWNER.email),
    undefined,
    'the previous owner keeps no access at all',
  );
});

test('a new owner who was a collaborator loses the now-redundant row', async () => {
  // Owning and being a collaborator on the same deck are two grants for one
  // person; the transfer collapses them rather than leaving both standing.
  const pres = await seed();
  await call('POST', transferPath(pres.id), {
    as: OWNER,
    body: { newOwnerEmail: EDITOR.email },
  });

  await assertStillOwnedBy(pres.id, EDITOR, 'the editor now owns the deck');
  const rows = await listCollaborators(pres.id);
  assert.equal(
    rows.find((r) => r.userEmail === EDITOR.email),
    undefined,
    'the collaborator row is gone now that the grant comes from ownership',
  );
});

test('the new owner is notified, and the deck records the transfer', async () => {
  const pres = await seed();
  await call('POST', transferPath(pres.id), {
    as: OWNER,
    body: { newOwnerEmail: HEIR.email },
  });

  const notes = await listNotifications(testScope(), HEIR.email);
  const received = notes.find(
    (n) =>
      n.notificationType === 'ownership_received' &&
      n.presentationId === pres.id,
  );
  assert.ok(received, 'the new owner hears about it');
  assert.equal(received.presentationId, pres.id);
  assert.match(
    String(received.actionUrl),
    /^http:\/\/decks\.example\.test\/app\//,
    'the link is built from the request host',
  );

  const { events } = await listActivityEvents(testScope(), {
    presentationId: pres.id,
    eventType: 'presentation.ownership_transferred',
  });
  const transferred = events[0];
  assert.ok(transferred, 'the transfer is on the activity log');
  assert.equal(transferred.data.previousOwner, OWNER.email);
  assert.equal(transferred.data.newOwner, HEIR.email);
});

test('handing the deck over costs the giver the transfer right', async () => {
  // The rule D43 settled: the grant that authorizes the act does not survive
  // the act. `canTransferOwnership` reads the *owner* stamp alone, and the
  // transfer rewrites exactly that pair — `created_by`/`created_by_user_id`
  // are create-only by construction (server/storage/presentations/index.js).
  // Were the decider `isOwnerOrCreator`, the person who made the deck would
  // keep every owner-scoped power over it forever, including taking it
  // straight back; this cell is what stops that regressing in silence.
  const pres = await seed();
  await call('POST', transferPath(pres.id), {
    as: OWNER,
    body: { newOwnerEmail: HEIR.email, keepAsCollaborator: false },
  });
  await assertStillOwnedBy(pres.id, HEIR, 'the deck did change hands');

  const { res } = await call('POST', transferPath(pres.id), {
    as: OWNER,
    body: { newOwnerEmail: OWNER.email },
  });
  assert.equal(
    res.statusCode,
    401,
    'the creator stamp does not let the giver claim the deck back',
  );
  await assertStillOwnedBy(
    pres.id,
    HEIR,
    'and the hand-over stands (refusal asserted in the store, not the code)',
  );
});

test('a complete hand-over costs the giver every power over the deck (D49)', async () => {
  // The rule D49 settled, end to end. `keepAsCollaborator: false` leaves the
  // previous owner holding nothing but the creator stamp — and that stamp is
  // authorship, not control. Before D49 it still granted write, delete,
  // visibility and collaborator management, which made the transfer UI's
  // promise ("you will become a collaborator with edit access") false in the
  // one case where it mattered: the person who declined the collaborator row
  // kept more than the row would have given them.
  const pres = await seed();
  await call('POST', transferPath(pres.id), {
    as: OWNER,
    body: { newOwnerEmail: HEIR.email, keepAsCollaborator: false },
  });
  await assertStillOwnedBy(pres.id, HEIR, 'the deck did change hands');
  await invalidatePermission(pres.id, OWNER.email);

  const del = await call('DELETE', `/api/presentations/${pres.id}`, {
    as: OWNER,
  });
  assert.equal(
    del.res.statusCode,
    401,
    'the creator stamp does not let the giver delete the deck',
  );
  assert.ok(
    await getPresentation(testScope(), pres.id),
    'and the refusal reached the store, not just the status code',
  );

  const vis = await call('PATCH', `/api/presentations/${pres.id}/visibility`, {
    as: OWNER,
    body: { visibility: 'organization' },
  });
  assert.equal(vis.res.statusCode, 401, 'nor change who may see it');
  const after = await getPresentation(testScope(), pres.id);
  assert.equal(after.visibility, 'private', 'the deck is still private');
});

test('the new owner may transfer on, on the strength of ownership alone', async () => {
  // The other half of the same rule: the heir is nobody's creator here, so
  // this proves the *owner* stamp grants on its own — the cell above proves
  // the creator stamp does not.
  const pres = await seed();
  await call('POST', transferPath(pres.id), {
    as: OWNER,
    body: { newOwnerEmail: HEIR.email, keepAsCollaborator: false },
  });

  const { res } = await call('POST', transferPath(pres.id), {
    as: HEIR,
    body: { newOwnerEmail: STRANGER.email },
  });
  assert.equal(res.statusCode, 200);
  await assertStillOwnedBy(pres.id, STRANGER, 'the heir passed it on');
});

// ===========================================================================
// Transfer — everyone it refuses
// ===========================================================================

for (const [actor, who] of REFUSED) {
  test(`transfer is refused for ${who} (401), and the deck does not move`, async () => {
    const pres = await seed();
    const { res } = await call('POST', transferPath(pres.id), {
      as: actor,
      body: { newOwnerEmail: STRANGER.email },
    });
    assert.equal(res.statusCode, 401);
    await assertStillOwnedBy(
      pres.id,
      OWNER,
      'the refused transfer never reached the store',
    );
  });
}

test('transfer on a deck that does not exist is a 404, not a 401', async () => {
  // Absent before unauthorized: the deck is fetched first, so a wrong id cannot
  // be used to probe which decks exist by watching the status flip.
  await seed();
  const { res } = await call('POST', transferPath('no-such-deck'), {
    as: STRANGER,
    body: { newOwnerEmail: STRANGER.email },
  });
  assert.equal(res.statusCode, 404);
});

// ===========================================================================
// Transfer — the requests that are the caller's mistake
// ===========================================================================

test('a transfer with no newOwnerEmail is a 400', async () => {
  const pres = await seed();
  const { res } = await call('POST', transferPath(pres.id), {
    as: OWNER,
    body: {},
  });
  assert.equal(res.statusCode, 400);
  await assertStillOwnedBy(pres.id, OWNER, 'nothing moved');
});

test('a transfer to something that is not an address is a 400', async () => {
  const pres = await seed();
  const { res } = await call('POST', transferPath(pres.id), {
    as: OWNER,
    body: { newOwnerEmail: 'not-an-address' },
  });
  assert.equal(res.statusCode, 400);
  await assertStillOwnedBy(pres.id, OWNER, 'nothing moved');
});

test('transferring to yourself is a 400, whatever the casing', async () => {
  const pres = await seed();
  const { res } = await call('POST', transferPath(pres.id), {
    as: OWNER,
    body: { newOwnerEmail: 'OWNER@EXAMPLE.COM' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(jsonBody(res).error, 'bad_request');
  assert.match(String(jsonBody(res).message), /current owner/i);
  await assertStillOwnedBy(pres.id, OWNER, 'nothing moved');
});

test('transferring to a non-member is a 400, and names no user', async () => {
  const pres = await seed();
  const { res } = await call('POST', transferPath(pres.id), {
    as: OWNER,
    body: { newOwnerEmail: 'outsider@elsewhere.test' },
  });
  assert.equal(res.statusCode, 400);
  await assertStillOwnedBy(pres.id, OWNER, 'nothing moved');
});

// ===========================================================================
// The dispatcher itself
// ===========================================================================

test('a method other than POST is answered 405 with an Allow header', async () => {
  // The ownership row carries no `method`, so the dispatcher hands every verb
  // to the handler and the handler answers 405 — unlike the guest table (#897),
  // which falls through. Both shapes are in route-dispatch.md; this pins which
  // one this route is.
  const pres = await seed();
  const { handled, res } = await call('GET', transferPath(pres.id), {
    as: OWNER,
  });
  assert.ok(handled, 'the route claimed the request');
  assert.equal(res.statusCode, 405);
  assert.match(String(res.headers?.Allow || res.headers?.allow || ''), /POST/);
});

test('a path outside the ownership surface is not this route', async () => {
  const pres = await seed();
  const { res } = await call(
    'POST',
    `/api/presentations/${pres.id}/transfer-ownership/extra`,
    { as: OWNER, body: { newOwnerEmail: HEIR.email } },
  );
  assert.notEqual(res.statusCode, 200);
  await assertStillOwnedBy(
    pres.id,
    OWNER,
    'no deeper path reaches the transfer',
  );
});
