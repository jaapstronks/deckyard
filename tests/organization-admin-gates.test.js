/**
 * The organization-admin gate on the server (B155).
 *
 * `isAdmin` is instance-wide: it says the person is an administrator of *this
 * Deckyard*, not of the workspace they happen to be looking at. In
 * multi-organization mode a session also carries `organizationRole` — the
 * membership role (`owner` / `admin` / `member`) in the organization it is
 * currently acting in (server/auth/auth.js → resolveActiveMembership).
 *
 * B144 (#965) made the UI read both, so an instance admin who is a plain
 * member of the workspace they switched into stops being shown the admin
 * affordances. That left the client stricter than the server: six server-side
 * checks still read the bare `isAdmin`, so the button was hidden and the
 * request behind it still succeeded. This file pins the server half.
 *
 * The rule, in `shared/organization-role.js` — one declaration for both
 * halves of the stack since B171, so there is nothing left to drift:
 *
 *   1. instance admin stays **necessary** — an organization owner who is not
 *      an instance admin gains nothing;
 *   2. with a membership role, being `admin` or `owner` of the *active*
 *      organization is necessary too;
 *   3. **without** a membership role — single-workspace, the dev bypass, the
 *      sandbox, and every machine surface that resolves an id and no role —
 *      the answer is exactly the old `isAdmin` check, unchanged.
 *
 * Rule 3 is why each case below is asserted twice: once for the org-A admin
 * who switched into org B (must be refused) and once with `organizationRole:
 * null` (must behave exactly as before). A gate that only tightens is not the
 * change; a gate that tightens *and* leaves single-workspace alone is.
 *
 * The six sites:
 *   - server/routes/api/questions.js         — moderator removes a question
 *   - server/routes/api/image-library.js     — delete a library image
 *   - server/utils/presentation-authz/comments.js  — resolve / edit a comment
 *   - server/utils/presentation-authz/presentations.js — change visibility
 *   - server/storage/presentations/crud/enforce-slide-locks.js — author test
 *
 * Run with: node --test tests/organization-admin-gates.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000ab';
process.env.IMAGE_LIBRARY_ENABLED = 'true';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const REPO_ROOT = '/tmp/deckyard-org-admin-gates-test';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { testScope } = await import('./helpers/storage-scope.js');
const { createPresentation } =
  await import('../server/storage/presentations/index.js');
const { createLiveSession, updateLiveSessionState } =
  await import('../server/storage/live-sessions/index.js');
const { createQuestion, listQuestions } =
  await import('../server/storage/questions.js');
const { handleQuestions } = await import('../server/routes/api/questions.js');
const { handleImageLibrary } =
  await import('../server/routes/api/image-library.js');
const { isOrganizationAdmin } = await import('../shared/organization-role.js');
const { canResolveComment, canEditComment } =
  await import('../server/utils/presentation-authz/comments.js');
const { canChangePresentationVisibility } =
  await import('../server/utils/presentation-authz/presentations.js');
const { enforceSlideWritePolicy } =
  await import('../server/storage/presentations/crud/enforce-slide-locks.js');

// --- The people -------------------------------------------------------------
//
// One person, three sessions. `ADMIN_ELSEWHERE` is the case B144 named: an
// instance admin who switched into a workspace where their membership says
// `member`. `ADMIN_HERE` is the same person in a workspace they administer.
// `ADMIN_NO_MEMBERSHIP` is every single-workspace install, the dev bypass and
// the sandbox — no membership row exists, so the role is null.

const base = {
  id: 'user-ada',
  email: 'ada@example.com',
  name: 'Ada',
  organizationId: ORG,
  isAdmin: true,
};
const ADMIN_NO_MEMBERSHIP = { ...base, organizationRole: null };
const ADMIN_HERE = { ...base, organizationRole: 'admin' };
const ADMIN_ELSEWHERE = { ...base, organizationRole: 'member' };
const OWNER_HERE = { ...base, organizationRole: 'owner' };
const ORG_OWNER_NOT_INSTANCE_ADMIN = {
  ...base,
  id: 'user-otto',
  email: 'otto@example.com',
  isAdmin: false,
  organizationRole: 'owner',
};

const DECK_OWNER = {
  id: 'user-olive',
  email: 'olive@example.com',
  name: 'Olive',
  organizationId: ORG,
};

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: [DECK_OWNER, base, ORG_OWNER_NOT_INSTANCE_ADMIN].map((a) => ({
      id: a.id,
      organization_id: ORG,
      email: a.email,
      name: a.name || a.email,
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

// ===========================================================================
// The gate itself
// ===========================================================================

test('the gate: instance admin is necessary, active-org admin narrows it', () => {
  assert.equal(isOrganizationAdmin(ADMIN_HERE), true);
  assert.equal(isOrganizationAdmin(OWNER_HERE), true);
  assert.equal(isOrganizationAdmin(ADMIN_ELSEWHERE), false);

  // Necessary, not sufficient: the membership role only ever narrows.
  assert.equal(isOrganizationAdmin(ORG_OWNER_NOT_INSTANCE_ADMIN), false);

  // No membership to read: exactly the old check.
  assert.equal(isOrganizationAdmin(ADMIN_NO_MEMBERSHIP), true);
  assert.equal(isOrganizationAdmin({ isAdmin: true }), true);

  // A role outside the ladder cannot be minted (createMembership defaults to
  // `member`, updateMemberRole validates) — but if one ever appears, it reads
  // as "no membership role": the old isAdmin answer, same as the client.
  assert.equal(
    isOrganizationAdmin({ isAdmin: true, organizationRole: 'superadmin' }),
    true,
  );
  assert.equal(isOrganizationAdmin({ isAdmin: false }), false);
  assert.equal(isOrganizationAdmin(null), false);
  assert.equal(isOrganizationAdmin(undefined), false);
});

test('there is one gate, and both halves read that one', async () => {
  // Before B171 this test compared two implementations case by case, because
  // the conjunction of the instance flag with the membership role was written
  // out twice — once for the UI, once for authorization — and a pair that
  // disagrees shows a user a control whose request is refused (or refuses one
  // whose request would have been allowed). There is one declaration now, so
  // what needs pinning is that nobody writes a second: a fresh copy would
  // satisfy any value comparison on the day it was made and drift after.
  const { readFile, readdir } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files = [];
  async function collect(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await collect(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  }
  // The whole runtime tree, not a hand-picked list: a second gate is most
  // likely to appear in a file that did not exist when the list was written.
  // client/vendor/ is vendored third-party code.
  await collect(path.join(root, 'shared'));
  await collect(path.join(root, 'server'));
  await collect(path.join(root, 'client'));
  const declarations = [];
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (rel.startsWith('client/vendor/')) continue;
    const source = await readFile(file, 'utf8');
    if (
      /function\s+isOrganizationAdmin\s*\(/.test(source) ||
      /(?:const|let|var)\s+isOrganizationAdmin\s*=/.test(source)
    ) {
      declarations.push(rel);
    }
  }
  assert.deepEqual(
    declarations,
    ['shared/organization-role.js'],
    'isOrganizationAdmin() is declared outside shared/organization-role.js',
  );
});

// ===========================================================================
// Mirror 1 — the question moderator hatch (routes/api/questions.js)
// ===========================================================================

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

/**
 * Drive one request through an exported route dispatcher, so the capture
 * groups and the table order are part of what is under test.
 * @param {Function} handler
 * @param {string} method
 * @param {string} pathname
 * @param {Object} [options]
 * @param {Object|null} [options.as]
 * @returns {Promise<{handled: *, res: Object}>}
 */
async function call(handler, method, pathname, { as = null } = {}) {
  const req = {
    method,
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {},
  };
  const res = makeRes();
  const authedUser = as || undefined;
  const handled = await handler({
    repoRoot: REPO_ROOT,
    storageScope: createStorageScope(authedUser, { repoRoot: REPO_ROOT }),
    req,
    res,
    url: new URL(`http://decks.example.test${pathname}`),
    authedUser,
  });
  return { handled, res };
}

/** A live deck with one unanswered question on it. */
async function seedQuestion() {
  const pres = await createPresentation(testScope(), {
    title: 'Live deck',
    ownerEmail: DECK_OWNER.email,
    slides: [{ type: 'content-slide', content: { title: 'A' } }],
  });
  const session = await createLiveSession(
    { repoRoot: REPO_ROOT, organizationId: ORG, actorEmail: null },
    { presentationId: pres.id },
  );
  await updateLiveSessionState(
    { repoRoot: REPO_ROOT, organizationId: ORG },
    session.sessionId,
    {
      slideId: pres.slides[0].id,
      slideIndex: 0,
      slideType: pres.slides[0].type,
      updatedAt: Date.now(),
    },
  );
  const asked = await createQuestion(testScope(), session.sessionId, {
    text: 'Will this be on the exam?',
    authorId: 'device-anon-1',
    authorName: 'Anon',
  });
  return { pres, sessionId: session.sessionId, questionId: asked.question.id };
}

const removePath = (presId, qId) =>
  `/api/moderate/${presId}/questions/${qId}/remove`;

test('questions: an admin who is a plain member here cannot remove a question', async () => {
  const { pres, sessionId, questionId } = await seedQuestion();
  const { res } = await call(
    handleQuestions,
    'POST',
    removePath(pres.id, questionId),
    { as: ADMIN_ELSEWHERE },
  );
  // The refusal shape is the one D68 prescribes for a signed-in caller who
  // lacks the permission: 403 `Admin required`.
  assert.equal(res.statusCode, 403);
  assert.match(String(res.body), /Admin required/);

  const still = await listQuestions(testScope(), sessionId);
  assert.equal(
    still.filter((q) => q.id === questionId).length,
    1,
    'the question must still be there — the refusal has to be before the write',
  );
});

test('questions: an admin of this organization can remove a question', async () => {
  const { pres, sessionId, questionId } = await seedQuestion();
  const { res } = await call(
    handleQuestions,
    'POST',
    removePath(pres.id, questionId),
    { as: ADMIN_HERE },
  );
  assert.equal(res.statusCode, 200);
  const still = await listQuestions(testScope(), sessionId);
  assert.equal(still.filter((q) => q.id === questionId).length, 0);
});

test('questions: single-workspace is unchanged (no membership role)', async () => {
  const { pres, sessionId, questionId } = await seedQuestion();
  const { res } = await call(
    handleQuestions,
    'POST',
    removePath(pres.id, questionId),
    { as: ADMIN_NO_MEMBERSHIP },
  );
  assert.equal(res.statusCode, 200);
  const still = await listQuestions(testScope(), sessionId);
  assert.equal(still.filter((q) => q.id === questionId).length, 0);
});

// ===========================================================================
// Mirror 2 — deleting a library image (routes/api/image-library.js)
// ===========================================================================
//
// The gate runs before `deleteImageLibraryItem`, so an unknown image id
// separates the two outcomes cleanly without seeding a row: refused callers
// get 403 at the gate, admitted ones reach the storage read and get 404.

const IMAGE_PATH = '/api/image-library/00000000-0000-0000-0000-00000000f00d';

test('image-library: an admin who is a plain member here cannot delete an image', async () => {
  const { res } = await call(handleImageLibrary, 'DELETE', IMAGE_PATH, {
    as: ADMIN_ELSEWHERE,
  });
  assert.equal(res.statusCode, 403);
  assert.match(String(res.body), /Admin required/);
});

test('image-library: an admin of this organization passes the gate', async () => {
  const { res } = await call(handleImageLibrary, 'DELETE', IMAGE_PATH, {
    as: ADMIN_HERE,
  });
  assert.equal(
    res.statusCode,
    404,
    'past the gate, into the storage read for an id that does not exist',
  );
});

test('image-library: single-workspace is unchanged (no membership role)', async () => {
  const { res } = await call(handleImageLibrary, 'DELETE', IMAGE_PATH, {
    as: ADMIN_NO_MEMBERSHIP,
  });
  assert.equal(res.statusCode, 404, 'past the gate, exactly as before');
});

// ===========================================================================
// Mirrors 3 and 4 — comment moderation (presentation-authz/comments.js)
// ===========================================================================

const someoneElsesDeck = {
  id: 'deck-1',
  ownerId: DECK_OWNER.id,
  createdBy: { id: DECK_OWNER.id, displayName: 'Olive' },
};
const someoneElsesComment = { id: 'c-1', author: { id: DECK_OWNER.id } };

test('comments: an admin who is a plain member here cannot resolve or edit', () => {
  assert.equal(
    canResolveComment({ user: ADMIN_ELSEWHERE, pres: someoneElsesDeck }),
    false,
  );
  assert.equal(
    canEditComment({ user: ADMIN_ELSEWHERE, comment: someoneElsesComment }),
    false,
  );
});

test('comments: an admin of this organization can resolve and edit', () => {
  assert.equal(
    canResolveComment({ user: ADMIN_HERE, pres: someoneElsesDeck }),
    true,
  );
  assert.equal(
    canEditComment({ user: ADMIN_HERE, comment: someoneElsesComment }),
    true,
  );
});

test('comments: single-workspace is unchanged (no membership role)', () => {
  assert.equal(
    canResolveComment({ user: ADMIN_NO_MEMBERSHIP, pres: someoneElsesDeck }),
    true,
  );
  assert.equal(
    canEditComment({ user: ADMIN_NO_MEMBERSHIP, comment: someoneElsesComment }),
    true,
  );
});

test('comments: the author still edits their own, admin or not', () => {
  // The gate narrows the admin bypass only. Authorship is keyed on `users.id`
  // and is untouched by any of this.
  assert.equal(
    canEditComment({
      user: { ...DECK_OWNER, isAdmin: false },
      comment: someoneElsesComment,
    }),
    true,
  );
});

// ===========================================================================
// Mirror 5 — changing deck visibility (presentation-authz/presentations.js)
// ===========================================================================

const privateDeck = {
  id: 'deck-2',
  visibility: 'private',
  ownerId: DECK_OWNER.id,
  createdBy: { id: DECK_OWNER.id, displayName: 'Olive' },
};

test('visibility: an admin who is a plain member here cannot publish someone elses deck', () => {
  assert.equal(
    canChangePresentationVisibility({
      user: ADMIN_ELSEWHERE,
      pres: privateDeck,
      nextVisibility: 'organization',
    }),
    false,
  );
});

test('visibility: an admin of this organization can', () => {
  assert.equal(
    canChangePresentationVisibility({
      user: ADMIN_HERE,
      pres: privateDeck,
      nextVisibility: 'organization',
    }),
    true,
  );
});

test('visibility: single-workspace is unchanged (no membership role)', () => {
  assert.equal(
    canChangePresentationVisibility({
      user: ADMIN_NO_MEMBERSHIP,
      pres: privateDeck,
      nextVisibility: 'organization',
    }),
    true,
  );
});

test('visibility: the owner keeps private -> organization without any admin role', () => {
  assert.equal(
    canChangePresentationVisibility({
      user: { ...DECK_OWNER, isAdmin: false },
      pres: privateDeck,
      nextVisibility: 'organization',
    }),
    true,
  );
});

// ===========================================================================
// Mirror 6 — the slide-lock author test (crud/enforce-slide-locks.js)
// ===========================================================================

const lockedDeck = {
  id: 'deck-3',
  ownerId: DECK_OWNER.id,
  createdBy: { id: DECK_OWNER.id, displayName: 'Olive' },
  slides: [{ id: 's1', type: 'content-slide', lockedByAuthor: true }],
};
/** The same slide with the author lock taken off — an author-only act. */
const unlockAttempt = [
  { id: 's1', type: 'content-slide', lockedByAuthor: false },
];

/** @param {Object|null} user */
function unlockAs(user) {
  return enforceSlideWritePolicy({
    existing: lockedDeck,
    nextSlides: unlockAttempt,
    user,
    ctx: { repoRoot: REPO_ROOT, organizationId: ORG },
    loadSlideLocks: async () => [],
  });
}

test('slide locks: an admin who is a plain member here is not an author', async () => {
  await assert.rejects(
    () => unlockAs(ADMIN_ELSEWHERE),
    /Only the presentation author can lock or unlock slides/,
  );
});

test('slide locks: an admin of this organization is', async () => {
  const result = await unlockAs(ADMIN_HERE);
  assert.equal(result.isAuthor, true);
});

test('slide locks: single-workspace is unchanged (no membership role)', async () => {
  const result = await unlockAs(ADMIN_NO_MEMBERSHIP);
  assert.equal(result.isAuthor, true);
});

test('slide locks: the deck author is still an author without any admin flag', async () => {
  const result = await unlockAs({ ...DECK_OWNER, isAdmin: false });
  assert.equal(result.isAuthor, true);
});
