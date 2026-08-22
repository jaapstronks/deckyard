/**
 * Guest management behind a share link — behaviour through the route (B114).
 *
 * `server/routes/api/share-links/guests.js` is the authenticated half of the
 * guest surface: it decides who may add, list, remove and re-invite the people
 * a share link lets in. Until now the module's only coverage was the
 * `c8-routes-share-links-dispatch` shape test — a table that proves a path maps
 * to a handler *name*, and nothing about what the handler does. Four endpoints
 * repeat the same authorization check, which is four places to get it right and
 * four places to get it wrong.
 *
 * The rule, on all four: **guest management is writing.** Not reading, not
 * commenting — `canWritePresentation`, so the owner, the creator, an admin and
 * a collaborator holding `edit`, and nobody else. A `comment` collaborator can
 * leave notes all over the deck and still may not hand out access to it, and an
 * anonymous caller who happens to know a linkId gets nothing. Every refusal is
 * a 401 that never touches the guest store, which is asserted directly rather
 * than inferred from the status code.
 *
 * House shape (as in tests/comments-routes-authz.test.js and
 * tests/share-links-public-path.test.js): the exported dispatcher is called with
 * a req/res double over tests/helpers/fake-db.js, and the scope is built with
 * the same `createStorageScope()` the router makes. No HTTP server, no browser.
 *
 * Run with: node --test tests/share-link-guest-management-authz.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
// The invitation mail is fire-and-forget on pre-register and awaited on resend;
// without a key the Brevo client answers `{ ok: false }` before any network.
delete process.env.BREVO_API_KEY;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { testScope } = await import('./helpers/storage-scope.js');
const { createPresentation } =
  await import('../server/storage/presentations/index.js');
const { createShareLink, listGuestsForShareLink } =
  await import('../server/storage/share-links/index.js');
const { invalidatePermission } =
  await import('../server/storage/cache/permission-cache.js');
const { handleGuestManagement } =
  await import('../server/routes/api/share-links/guests.js');

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
const EDITOR = person('editor@example.com', 'Ed');
const COMMENTER = person('commenter@example.com', 'Cass');
const VIEWER = person('viewer@example.com', 'Vera');
const STRANGER = person('stranger@example.com', 'Sam');
const ADMIN = { ...person('admin@example.com', 'Ada'), isAdmin: true };

/** @type {ReturnType<typeof createFakeDb>} */
let db;
/** @type {{presentationId: string, linkId: string}} */
let deck;

test.before(async () => {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    // Ownership keys on `users.id`, and `createPresentation` stamps
    // `owner_user_id` by resolving the address it is given — so an owner with
    // no user row would create a deck nobody owns, and every cell below would
    // pass for the wrong reason.
    users: [OWNER, EDITOR, COMMENTER, VIEWER, STRANGER, ADMIN].map((a) => ({
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
 * A fresh deck, share link and collaborator set per test.
 *
 * Fresh rather than shared because three of these tests write guests and one
 * deletes one; a shared fixture would make the assertions order-dependent.
 * `invalidatePermission` is needed because `getCollaboratorPermission` memoizes
 * on `(presentationId, email)` and the deck id changes per seed only for the
 * deck — the addresses do not.
 */
async function seed() {
  const pres = await createPresentation(testScope(), {
    title: 'Deck with guests',
    ownerEmail: OWNER.email,
    slides: [{ type: 'content-slide', content: { title: 'A' } }],
  });
  const link = await createShareLink(testScope(), pres.id, {
    permission: 'comment',
    label: 'Reviewers',
  });
  const linkId = link.id || link.shareLink?.id;

  db.__tables.presentation_collaborators ||= [];
  for (const [actor, permission] of [
    [EDITOR, 'edit'],
    [COMMENTER, 'comment'],
    [VIEWER, 'view'],
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
  deck = { presentationId: pres.id, linkId };
  return deck;
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
 * Drive one request through `handleGuestManagement`, the exported dispatcher.
 *
 * Going through the dispatcher rather than the (unexported) handlers is the
 * point: the pattern that captures `:id`, `:linkId` and `:guestId` is part of
 * what a caller can reach, and a mis-ordered table is a real failure mode.
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
  const handled = await handleGuestManagement({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(authedUser, { repoRoot: process.cwd() }),
    req,
    res,
    url: new URL(`http://decks.example.test${pathname}`),
    authedUser,
  });
  return { handled, res };
}

const guestsPath = ({ presentationId, linkId }) =>
  `/api/presentations/${presentationId}/share-links/${linkId}/guests`;

/** Everyone this surface must refuse, with what makes each interesting. */
const REFUSED = [
  [null, 'an anonymous caller holding a linkId'],
  [STRANGER, 'a signed-in user with no relation to the deck'],
  [VIEWER, 'a view-only collaborator'],
  [COMMENTER, 'a comment collaborator — writing is not commenting'],
];

// ===========================================================================
// Pre-register — the write that hands out access
// ===========================================================================

test('the owner pre-registers a guest (201) and the guest is stored', async () => {
  const d = await seed();
  const { res } = await call('POST', guestsPath(d), {
    as: OWNER,
    body: { email: 'Guest@Example.com', name: 'Gwen', sendInvitation: false },
  });
  assert.equal(res.statusCode, 201);
  const out = jsonBody(res);
  assert.equal(out.isNew, true);
  assert.equal(
    out.guest.email,
    'guest@example.com',
    'the address is normalized',
  );

  const stored = await listGuestsForShareLink(testScope(), d.linkId);
  assert.deepEqual(
    stored.map((g) => g.email),
    ['guest@example.com'],
  );
});

test('an edit collaborator may pre-register a guest', async () => {
  const d = await seed();
  const { res } = await call('POST', guestsPath(d), {
    as: EDITOR,
    body: { email: 'byeditor@example.com', sendInvitation: false },
  });
  assert.equal(res.statusCode, 201);
});

test('an instance admin is not a write grant on someone else’s deck', async () => {
  // `canWritePresentation` consults `isUnrestricted`, never `isAdmin`: the
  // operator bypass is a flag on the actor, and being an instance admin is not
  // it. Worth a cell precisely because the opposite is the intuitive guess —
  // several sibling deciders (canResolveComment, canEditComment) *do* let an
  // admin through, and this one deliberately does not.
  const d = await seed();
  const { res } = await call('POST', guestsPath(d), {
    as: ADMIN,
    body: { email: 'byadmin@example.com', sendInvitation: false },
  });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(await listGuestsForShareLink(testScope(), d.linkId), []);
});

for (const [actor, who] of REFUSED) {
  test(`pre-register is refused for ${who} (401), and stores nothing`, async () => {
    const d = await seed();
    const { res } = await call('POST', guestsPath(d), {
      as: actor,
      body: { email: 'sneaky@example.com', sendInvitation: false },
    });
    assert.equal(res.statusCode, 401);
    const stored = await listGuestsForShareLink(testScope(), d.linkId);
    assert.deepEqual(stored, [], 'the refused write never reached the store');
  });
}

test('pre-register on a deck that does not exist is a 404, not a 401', async () => {
  // Absent before unauthorized: the deck is fetched first, so a wrong id cannot
  // be used to probe which decks exist by watching the status flip.
  const d = await seed();
  const { res } = await call(
    'POST',
    guestsPath({ presentationId: 'no-such-deck', linkId: d.linkId }),
    { as: OWNER, body: { email: 'x@example.com', sendInvitation: false } },
  );
  assert.equal(res.statusCode, 404);
});

test('pre-register with an unusable address is refused by the store', async () => {
  const d = await seed();
  const { res } = await call('POST', guestsPath(d), {
    as: OWNER,
    body: { email: 'not-an-address', sendInvitation: false },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(jsonBody(res).error, 'invalid');
  assert.equal(jsonBody(res).details?.field, 'email');
});

// ===========================================================================
// List — the read that exposes who was let in
// ===========================================================================

test('the owner lists the guests on a link', async () => {
  const d = await seed();
  await call('POST', guestsPath(d), {
    as: OWNER,
    body: { email: 'listed@example.com', sendInvitation: false },
  });
  const { res } = await call('GET', guestsPath(d), { as: OWNER });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    jsonBody(res).guests.map((g) => g.email),
    ['listed@example.com'],
  );
});

for (const [actor, who] of REFUSED) {
  test(`listing guests is refused for ${who} (401), and leaks no addresses`, async () => {
    const d = await seed();
    await call('POST', guestsPath(d), {
      as: OWNER,
      body: { email: 'private@example.com', sendInvitation: false },
    });
    const { res } = await call('GET', guestsPath(d), { as: actor });
    assert.equal(res.statusCode, 401);
    assert.doesNotMatch(
      String(res.body || ''),
      /private@example\.com/,
      'a refused list is not a list',
    );
  });
}

// ===========================================================================
// Remove — the write that takes access away
// ===========================================================================

test('the owner removes a guest, and the guest is gone', async () => {
  const d = await seed();
  const created = jsonBody(
    (
      await call('POST', guestsPath(d), {
        as: OWNER,
        body: { email: 'removable@example.com', sendInvitation: false },
      })
    ).res,
  );
  const { res } = await call('DELETE', `${guestsPath(d)}/${created.guest.id}`, {
    as: OWNER,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(jsonBody(res).deleted, true);
  assert.deepEqual(await listGuestsForShareLink(testScope(), d.linkId), []);
});

for (const [actor, who] of REFUSED) {
  test(`removing a guest is refused for ${who} (401), and the guest stays`, async () => {
    const d = await seed();
    const created = jsonBody(
      (
        await call('POST', guestsPath(d), {
          as: OWNER,
          body: { email: 'keeper@example.com', sendInvitation: false },
        })
      ).res,
    );
    const { res } = await call(
      'DELETE',
      `${guestsPath(d)}/${created.guest.id}`,
      { as: actor },
    );
    assert.equal(res.statusCode, 401);
    const stored = await listGuestsForShareLink(testScope(), d.linkId);
    assert.deepEqual(
      stored.map((g) => g.email),
      ['keeper@example.com'],
      'the refused delete never reached the store',
    );
  });
}

// ===========================================================================
// Resend — the write that re-sends an invitation mail
// ===========================================================================

for (const [actor, who] of REFUSED) {
  test(`resending an invitation is refused for ${who} (401)`, async () => {
    const d = await seed();
    const created = jsonBody(
      (
        await call('POST', guestsPath(d), {
          as: OWNER,
          body: { email: 'resend@example.com', sendInvitation: false },
        })
      ).res,
    );
    const { res } = await call(
      'POST',
      `${guestsPath(d)}/${created.guest.id}/resend`,
      { as: actor },
    );
    assert.equal(res.statusCode, 401);
  });
}

test('resending to a guest that is not on this link is a 404', async () => {
  const d = await seed();
  const { res } = await call('POST', `${guestsPath(d)}/no-such-guest/resend`, {
    as: OWNER,
  });
  assert.equal(res.statusCode, 404);
});

test('resend reports a failed send as ours (500), not as the caller’s mistake', async () => {
  // No BREVO_API_KEY in this suite, so the client refuses before the network.
  // The status is the assertion: a mail that did not go out is a server-side
  // failure, and answering 4xx would tell the caller to change their request.
  const d = await seed();
  const created = jsonBody(
    (
      await call('POST', guestsPath(d), {
        as: OWNER,
        body: { email: 'nomail@example.com', sendInvitation: false },
      })
    ).res,
  );
  const { res } = await call(
    'POST',
    `${guestsPath(d)}/${created.guest.id}/resend`,
    { as: OWNER },
  );
  assert.equal(res.statusCode, 500);
  assert.equal(jsonBody(res).error, 'email_failed');
});

// ===========================================================================
// The dispatcher itself
// ===========================================================================

test('a method the table does not carry is not this module’s request', async () => {
  // Form A (route-dispatch.md): the old chain fell through on a method
  // mismatch rather than answering 405, and the table preserves that.
  const d = await seed();
  const { handled, res } = await call('PUT', guestsPath(d), { as: OWNER });
  assert.equal(handled, false);
  assert.equal(res.statusCode, null, 'nothing was written to the response');
});

test('a path outside the guest surface is not this module’s request', async () => {
  const d = await seed();
  const { handled } = await call(
    'GET',
    `/api/presentations/${d.presentationId}/share-links`,
    { as: OWNER },
  );
  assert.equal(handled, false);
});
