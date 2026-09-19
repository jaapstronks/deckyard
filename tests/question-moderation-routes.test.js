/**
 * The moderator question actions — behaviour through the route (B114).
 *
 * `server/routes/api/questions.js` is the *other* end of audience Q&A. The
 * audience side (ask / list / upvote / cancel) is anonymous and pinned in
 * tests/anon-follow-and-share-surfaces.test.js; this module is what a person on
 * the stage side may do to what the audience wrote: remove a question, or
 * promote it to a slide in the live deck. Until now the module's only coverage
 * was the `route-dispatch-convert-profile-questions` shape test, which proves a path maps to a
 * handler name and nothing about who may call it.
 *
 * The two endpoints deliberately do **not** share one gate, and that is the
 * point of this file:
 *
 *   - **remove** requires `authedUser.isAdmin`. It is the blunt moderation
 *     hatch ("intended for coworkers", per the handler), so it is deliberately
 *     narrower than deck ownership: the deck's own owner does not get it.
 *   - **promote** requires `canWritePresentation` — it inserts a slide into
 *     someone's deck, so it follows the deck, not the instance. Which means an
 *     instance admin does *not* get it, because `canWritePresentation` consults
 *     `isUnrestricted`, never `isAdmin`.
 *
 * Two gates that each refuse exactly whom the other admits. Nothing in the
 * dispatch table says so, and nothing did until this file.
 *
 * Since B365 there is a third endpoint, `GET .../questions/capabilities`, whose
 * whole job is to report those two answers — because the notes companion used
 * to guess them, and guessed `isOrganizationAdmin` for both. The cells at the
 * bottom pin the report against the actions: whatever `capabilities` claims,
 * the matching POST must agree, for the same caller on the same deck. That
 * equality is the thing under test; the individual booleans are just how it is
 * spelled.
 *
 * House shape (as in tests/comments-routes-authz.test.js): the exported
 * dispatcher is called with a req/res double over tests/helpers/fake-db.js.
 * No HTTP server, no browser.
 *
 * Run with: node --test tests/question-moderation-routes.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const REPO_ROOT = '/tmp/deckyard-question-moderation-test';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { testScope } = await import('./helpers/storage-scope.js');
const { createPresentation, getPresentation } =
  await import('../server/storage/presentations/index.js');
const { createLiveSession, updateLiveSessionState } =
  await import('../server/storage/live-sessions/index.js');
const { createQuestion, listQuestions } =
  await import('../server/storage/questions.js');
const { addCollaborator } = await import('../server/storage/collaborators.js');
const { PERMISSIONS } = await import('../shared/constants/permissions.js');
const { handleQuestions } = await import('../server/routes/api/questions.js');

// --- The people -------------------------------------------------------------
const uid = (email) => `user-${email.split('@')[0]}`;
const person = (email, name) => ({
  id: uid(email),
  email,
  name,
  organizationId: ORG,
});

const OWNER = person('owner@example.com', 'Olive');
const STRANGER = person('stranger@example.com', 'Sam');
const ADMIN = { ...person('admin@example.com', 'Ada'), isAdmin: true };
// The person B365 was about: write access to the deck, no admin rights. The
// API let them promote; the only UI that offers it never showed them a button.
const EDITOR = person('editor@example.com', 'Edda');

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: [OWNER, STRANGER, ADMIN, EDITOR].map((a) => ({
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

/** Presenter scope (states its organization — a state push is not anonymous). */
const presenterScope = { repoRoot: REPO_ROOT, organizationId: ORG };

/**
 * A live deck with one question asked on it.
 *
 * Fresh per test: every cell here either removes or promotes, so a shared
 * fixture would make the assertions order-dependent.
 */
async function seed({ slides } = {}) {
  const pres = await createPresentation(testScope(), {
    title: 'Live deck',
    ownerEmail: OWNER.email,
    slides: slides || [
      { type: 'content-slide', content: { title: 'A' } },
      { type: 'content-slide', content: { title: 'B' } },
    ],
  });
  const session = await createLiveSession(
    { repoRoot: REPO_ROOT, organizationId: ORG, actorEmail: null },
    { presentationId: pres.id },
  );
  await updateLiveSessionState(presenterScope, session.sessionId, {
    slideId: pres.slides[0].id,
    slideIndex: 0,
    slideType: pres.slides[0].type,
    updatedAt: Date.now(),
  });
  const asked = await createQuestion(testScope(), session.sessionId, {
    text: 'Will this be on the exam?',
    authorId: 'device-anon-1',
    authorName: 'Anon',
  });
  return {
    pres,
    sessionId: session.sessionId,
    questionId: asked.question.id,
  };
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
 * Drive one request through `handleQuestions`, the exported dispatcher — so the
 * `:presentationId` / `:questionId` capture and the table order are part of
 * what is under test, not assumed.
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
  const handled = await handleQuestions({
    repoRoot: REPO_ROOT,
    storageScope: createStorageScope(authedUser, { repoRoot: REPO_ROOT }),
    req,
    res,
    url: new URL(`http://decks.example.test${pathname}`),
    authedUser,
  });
  return { handled, res };
}

const removePath = (presId, qId) =>
  `/api/moderate/${presId}/questions/${qId}/remove`;
const promotePath = (presId, qId) =>
  `/api/moderate/${presId}/questions/${qId}/promote`;

/** Questions the audience still sees on a session. */
async function visibleQuestions(sessionId) {
  return (await listQuestions(testScope(), sessionId)) || [];
}

// ===========================================================================
// Remove — the admin-only moderation hatch
// ===========================================================================

test('an admin removes a question, and the audience stops seeing it', async () => {
  const { pres, sessionId, questionId } = await seed();
  assert.equal((await visibleQuestions(sessionId)).length, 1);

  const { res } = await call('POST', removePath(pres.id, questionId), {
    as: ADMIN,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(jsonBody(res).ok, true);
  assert.deepEqual(await visibleQuestions(sessionId), []);
});

test('an anonymous caller may not remove a question (401)', async () => {
  const { pres, sessionId, questionId } = await seed();
  const { res } = await call('POST', removePath(pres.id, questionId), {
    as: null,
  });
  assert.equal(res.statusCode, 401);
  assert.equal((await visibleQuestions(sessionId)).length, 1);
});

test('a signed-in stranger may not remove a question (403)', async () => {
  const { pres, sessionId, questionId } = await seed();
  const { res } = await call('POST', removePath(pres.id, questionId), {
    as: STRANGER,
  });
  assert.equal(res.statusCode, 403);
  assert.equal((await visibleQuestions(sessionId)).length, 1);
});

test('even the deck owner may not remove a question — removal is admin-only', async () => {
  // Deliberate, and the reason it is worth a cell: this hatch skips the deck's
  // own authorization entirely ("intended for coworkers; require admin to avoid
  // accidental abuse"), so the owner reaches it through promote instead.
  const { pres, sessionId, questionId } = await seed();
  const { res } = await call('POST', removePath(pres.id, questionId), {
    as: OWNER,
  });
  assert.equal(res.statusCode, 403);
  assert.equal(jsonBody(res).message, 'Admin required');
  assert.equal((await visibleQuestions(sessionId)).length, 1);
});

test('removing on a deck that never had a session is refused (400)', async () => {
  const pres = await createPresentation(testScope(), {
    title: 'Dormant deck',
    ownerEmail: OWNER.email,
    slides: [{ type: 'content-slide', content: { title: 'A' } }],
  });
  const { res } = await call(
    'POST',
    removePath(pres.id, '11111111-1111-4111-8111-111111111111'),
    { as: ADMIN },
  );
  assert.equal(res.statusCode, 400);
});

test('removing a question that is not there is a 404', async () => {
  const { pres } = await seed();
  const { res } = await call(
    'POST',
    removePath(pres.id, '11111111-1111-4111-8111-111111111111'),
    { as: ADMIN },
  );
  assert.equal(res.statusCode, 404);
});

// ===========================================================================
// Promote — writing a slide into someone's deck
// ===========================================================================

test('the deck owner promotes a question, and the deck grows a slide', async () => {
  const { pres, questionId } = await seed();
  const before = (await getPresentation(testScope(), pres.id)).slides.length;

  const { res } = await call('POST', promotePath(pres.id, questionId), {
    as: OWNER,
    body: { position: 'end' },
  });
  assert.equal(res.statusCode, 200);
  const out = jsonBody(res);
  assert.ok(out.slideId, 'the response names the slide it created');

  const after = await getPresentation(testScope(), pres.id);
  assert.equal(after.slides.length, before + 1);
  const added = after.slides.at(-1);
  assert.equal(added.id, out.slideId);
  assert.equal(added.type, 'chapter-title-slide');
  assert.match(added.content.title, /Will this be on the exam\?/);
  assert.match(added.notes, /Original: Will this be on the exam\?/);
  assert.match(added.notes, /Asked by: Anon/);
});

test('promote defaults to inserting after the current slide', async () => {
  // `position: 'next'` reads the live session's slideIndex, which is 0 here —
  // so the new slide lands at index 1, not at the end.
  const { pres, questionId } = await seed();
  const { res } = await call('POST', promotePath(pres.id, questionId), {
    as: OWNER,
    body: { position: 'next' },
  });
  assert.equal(res.statusCode, 200);
  const after = await getPresentation(testScope(), pres.id);
  assert.equal(after.slides[1].id, jsonBody(res).slideId);
});

test('an anonymous caller may not promote a question (401)', async () => {
  const { pres, questionId } = await seed();
  const before = (await getPresentation(testScope(), pres.id)).slides.length;
  const { res } = await call('POST', promotePath(pres.id, questionId), {
    as: null,
    body: {},
  });
  assert.equal(res.statusCode, 401);
  assert.equal(
    (await getPresentation(testScope(), pres.id)).slides.length,
    before,
    'a refused promote never wrote a slide',
  );
});

test('a signed-in stranger may not promote into someone else’s deck (403)', async () => {
  const { pres, questionId } = await seed();
  const before = (await getPresentation(testScope(), pres.id)).slides.length;
  const { res } = await call('POST', promotePath(pres.id, questionId), {
    as: STRANGER,
    body: {},
  });
  assert.equal(res.statusCode, 403);
  assert.equal(
    (await getPresentation(testScope(), pres.id)).slides.length,
    before,
  );
});

test('an instance admin may not promote into someone else’s deck either', async () => {
  // The mirror image of the remove cells above: `canWritePresentation` consults
  // `isUnrestricted`, never `isAdmin`. An admin may delete the question and
  // still may not put a slide in the deck.
  const { pres, questionId } = await seed();
  const before = (await getPresentation(testScope(), pres.id)).slides.length;
  const { res } = await call('POST', promotePath(pres.id, questionId), {
    as: ADMIN,
    body: {},
  });
  assert.equal(res.statusCode, 403);
  assert.equal(
    (await getPresentation(testScope(), pres.id)).slides.length,
    before,
  );
});

test('promoting on a deck that does not exist is a 404', async () => {
  const { questionId } = await seed();
  const { res } = await call('POST', promotePath('no-such-deck', questionId), {
    as: OWNER,
    body: {},
  });
  assert.equal(res.statusCode, 404);
});

test('promoting a question that is not there is a 404', async () => {
  const { pres } = await seed();
  const { res } = await call(
    'POST',
    promotePath(pres.id, '11111111-1111-4111-8111-111111111111'),
    { as: OWNER, body: {} },
  );
  assert.equal(res.statusCode, 404);
});

// ===========================================================================
// The dispatch table
// ===========================================================================

test('both moderator paths answer 405 on a non-POST, before any auth check', async () => {
  // The trailing catch-all rows exist so the 405 lands *before* the handler —
  // deliberately, since a method mismatch is not a reason to reveal whether the
  // caller would have been authorized.
  const { pres, questionId } = await seed();
  for (const path of [
    removePath(pres.id, questionId),
    promotePath(pres.id, questionId),
  ]) {
    const { res } = await call('GET', path, { as: null });
    assert.equal(res.statusCode, 405, path);
  }
});

test('a path outside the moderator surface is not this module’s request', async () => {
  const { pres, questionId } = await seed();
  const { handled } = await call(
    'POST',
    `/api/moderate/${pres.id}/questions/${questionId}/hide`,
    { as: ADMIN },
  );
  assert.equal(handled, false);
});

// ===========================================================================
// Capabilities — the answer the surface renders from
// ===========================================================================

const capabilitiesPath = (presId) =>
  `/api/moderate/${presId}/questions/capabilities`;

/**
 * Ask the surface what it will allow, then actually try both actions as the
 * same caller. Returns the claim next to what happened, so a cell can assert
 * the two are the same thing rather than asserting the claim alone.
 *
 * @param {Object} seeded - The `seed()` result
 * @param {Object|null} as - Acting user
 * @returns {Promise<{claimed: Object, promoteStatus: number, removeStatus: number}>}
 */
async function claimVersusDeed(seeded, as) {
  const { pres, questionId } = seeded;
  const { res: capRes } = await call('GET', capabilitiesPath(pres.id), { as });
  assert.equal(capRes.statusCode, 200);
  const claimed = jsonBody(capRes);

  const { res: promoteRes } = await call(
    'POST',
    promotePath(pres.id, questionId),
    {
      as,
      body: { position: 'end' },
    },
  );
  const { res: removeRes } = await call(
    'POST',
    removePath(pres.id, questionId),
    {
      as,
    },
  );
  return {
    claimed,
    promoteStatus: promoteRes.statusCode,
    removeStatus: removeRes.statusCode,
  };
}

test('an editor-collaborator is told they may promote — and may', async () => {
  // The B365 cell. Before the report existed, the notes companion decided this
  // with `isOrganizationAdmin`, so this person saw no promote button at all
  // while the route below happily accepted their POST.
  const seeded = await seed();
  const added = await addCollaborator(seeded.pres.id, {
    userEmail: EDITOR.email,
    permission: PERMISSIONS.EDIT,
    invitedBy: OWNER.email,
  });
  assert.equal(added.ok, true, 'fixture: the collaborator row was written');

  const { claimed, promoteStatus, removeStatus } = await claimVersusDeed(
    seeded,
    EDITOR,
  );
  assert.equal(claimed.canPromote, true);
  assert.equal(promoteStatus, 200, 'the claim and the action agree');
  assert.equal(claimed.canRemove, false);
  assert.equal(removeStatus, 403, 'and they agree on the other gate too');
});

test('the deck owner is told promote-yes, remove-no — the deck, not the instance', async () => {
  const seeded = await seed();
  const { claimed, promoteStatus, removeStatus } = await claimVersusDeed(
    seeded,
    OWNER,
  );
  assert.deepEqual(claimed, { canPromote: true, canRemove: false });
  assert.equal(promoteStatus, 200);
  assert.equal(removeStatus, 403);
});

test('an admin on someone else’s deck is told remove-yes, promote-no', async () => {
  const seeded = await seed();
  const { claimed, promoteStatus, removeStatus } = await claimVersusDeed(
    seeded,
    ADMIN,
  );
  assert.deepEqual(claimed, { canPromote: false, canRemove: true });
  assert.equal(promoteStatus, 403);
  assert.equal(removeStatus, 200);
});

test('a signed-in stranger is told nothing is allowed', async () => {
  const seeded = await seed();
  const { claimed, promoteStatus, removeStatus } = await claimVersusDeed(
    seeded,
    STRANGER,
  );
  assert.deepEqual(claimed, { canPromote: false, canRemove: false });
  assert.equal(promoteStatus, 403);
  assert.equal(removeStatus, 403);
});

test('an anonymous caller is answered "nothing", not refused', async () => {
  // In the running app the login gate answers this one 401 long before the
  // dispatcher sees it, and that is the ordinary case: the notes companion is
  // authorized by a join link, not an account. The handler still has to have an
  // answer of its own, because the client reads a refusal and an empty grant as
  // the same thing — no moderator controls — and a 200 keeps that honest
  // instead of routing it through an exception.
  const { pres } = await seed();
  const { res } = await call('GET', capabilitiesPath(pres.id), { as: null });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(jsonBody(res), { canPromote: false, canRemove: false });
});

test('capabilities for a deck this caller cannot see is an empty grant, not a 404', async () => {
  // `getPresentation` is organization-scoped, so an unreadable deck and a
  // missing one arrive here identically. Answering "nothing allowed" refuses to
  // turn the moderator surface into a deck-existence oracle.
  const { res } = await call('GET', capabilitiesPath('no-such-deck'), {
    as: STRANGER,
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(jsonBody(res), { canPromote: false, canRemove: false });
});

test('capabilities is GET-only, and says so before any auth check', async () => {
  const { pres } = await seed();
  const { res } = await call('POST', capabilitiesPath(pres.id), {
    as: null,
    body: {},
  });
  assert.equal(res.statusCode, 405);
});
