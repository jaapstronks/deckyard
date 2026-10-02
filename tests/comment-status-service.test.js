/**
 * `setCommentStatus` in `server/services/comments.js` — the one place a
 * comment is resolved, reopened or dismissed, under the internal routes, the
 * public v1 API and MCP (A7.4, B569).
 *
 * Before B569 each contract loaded, decided and announced on its own, and they
 * had drifted: the internal routes decided moderation on the session user, v1
 * and MCP on the actor; v1 answered a transition the comment was not in with a
 * hand-picked 409, the internal routes with the reason register's 400, MCP
 * with a bare error. This file pins the one flow at the service and calls it
 * through each contract once:
 *
 *   1. **who moderates** — the deck's owner or creator, or an organization
 *      admin acting in a session (`access: 'moderate'`); refused with 403
 *      before the comment is looked up, so an unmoderatable deck betrays none
 *      of its comment ids;
 *   2. **what a transition is** — open→resolved, open→dismissed,
 *      resolved→open; any other is the storage reason's 400 on every contract;
 *   3. **what happens after** — resolving and reopening leave an activity row,
 *      dismissing does not.
 *
 * The v1 contract's own pins (permissions, the sanitized payload) stay in
 * `tests/public-api-v1-comments.test.js`.
 *
 * Run with: node --test tests/comment-status-service.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const DECK = 'deck-status';
const OTHER_DECK = 'deck-status-other';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { invalidatePermission } =
  await import('../server/storage/cache/permission-cache.js');
const { setCommentStatus } = await import('../server/services/comments.js');
const { AppError } = await import('../server/utils/errors.js');
const { withErrorHandler } = await import('../server/utils/http.js');
const { handlePresentationCommentResolve, handlePresentationCommentDismiss } =
  await import('../server/routes/api/presentations/comments.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');

const OWNER = {
  id: 'user-owner',
  email: 'owner@example.com',
  name: 'Olive Owner',
  organizationId: ORG,
};
const MEMBER = {
  id: 'user-member',
  email: 'member@example.com',
  name: 'Mia Member',
  organizationId: ORG,
};
/** An instance admin session without a membership role: an organization admin. */
const ADMIN = {
  id: 'user-admin',
  email: 'admin@example.com',
  name: 'Ada Admin',
  organizationId: ORG,
  isAdmin: true,
};

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

function userRow(u) {
  return {
    id: u.id,
    organization_id: ORG,
    email: u.email,
    name: u.name,
    role: u.isAdmin ? 'admin' : 'user',
    auth_source: 'database',
    password_hash: null,
    settings: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function deckRow(id) {
  return {
    id,
    organization_id: ORG,
    title: `Deck ${id}`,
    owner_email: OWNER.email,
    created_by: OWNER.email,
    updated_by: OWNER.email,
    owner_user_id: OWNER.id,
    created_by_user_id: OWNER.id,
    updated_by_user_id: OWNER.id,
    visibility: 'organization',
    theme: 'default',
    lang: 'nl',
    revision: 1,
    is_view_only: false,
    slides: [{ id: 's1', type: 'content-slide', content: { title: 'One' } }],
    i18n: null,
    settings: {},
    created_at: '2026-02-01T00:00:00.000Z',
    modified_at: '2026-02-01T00:00:00.000Z',
    trashed_at: null,
  };
}

function commentRow(overrides) {
  return {
    presentation_id: DECK,
    organization_id: ORG,
    slide_id: 's1',
    parent_id: null,
    author_email: MEMBER.email,
    author_name: MEMBER.name,
    author_user_id: MEMBER.id,
    author_guest_id: null,
    body: `Body of ${overrides.id}`,
    status: 'open',
    position_x: null,
    position_y: null,
    comment_type: 'human',
    suggestion_category: null,
    proposed_slide: null,
    slide_snapshot: null,
    mentions: [],
    resolved_by: null,
    resolved_at: null,
    created_at: '2026-02-02T00:00:00.000Z',
    updated_at: '2026-02-02T00:00:00.000Z',
    ...overrides,
  };
}

async function seed() {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: [userRow(OWNER), userRow(MEMBER), userRow(ADMIN)],
    presentations: [deckRow(DECK), deckRow(OTHER_DECK)],
    presentation_collaborators: [],
    presentation_comments: [
      commentRow({ id: 'cm-open' }),
      commentRow({
        id: 'cm-resolved',
        status: 'resolved',
        resolved_by: OWNER.email,
        resolved_at: '2026-02-03T00:00:00.000Z',
      }),
      commentRow({ id: 'cm-elsewhere', presentation_id: OTHER_DECK }),
    ],
    comment_thread_reads: [],
    activity_events: [],
  });
  __setTestDb(db);
  for (const u of [OWNER, MEMBER, ADMIN]) {
    for (const deck of [DECK, OTHER_DECK]) {
      await invalidatePermission(deck, u.email);
    }
  }
}

const scopeFor = (user) =>
  createStorageScope(user, { repoRoot: process.cwd() });
const stored = (id) =>
  db.__tables.presentation_comments.find((c) => c.id === id);

/** The MCP actor: session owner plus organization, never an admin flag. */
const mcpActor = (user) => ({ email: user.email, organizationId: ORG });

/** The activity row of `eventType` for a comment, once the write landed. */
async function activityFor(eventType, commentId) {
  for (let i = 0; i < 50; i += 1) {
    const row = (db.__tables.activity_events || []).find(
      (e) => e.event_type === eventType && e.entity_id === commentId,
    );
    if (row) return row;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return null;
}

/**
 * @param {Promise<unknown>} promise
 * @param {number} status
 * @param {string} code
 */
async function assertRefused(promise, status, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof AppError, `expected an AppError, got ${err}`);
    assert.equal(err.statusCode, status);
    assert.equal(err.code, code);
    return true;
  });
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

test('the owner resolves an open comment and the resolution leaves an activity row', async () => {
  await seed();
  const { comment, presentation } = await setCommentStatus(
    scopeFor(OWNER),
    { actor: OWNER },
    { presentationId: DECK, commentId: 'cm-open', status: 'resolved' },
  );
  assert.equal(comment.status, 'resolved');
  assert.equal(presentation.id, DECK);
  assert.equal(stored('cm-open').resolved_by, OWNER.email);
  assert.ok(await activityFor('comment.resolved', 'cm-open'));
});

test('reopening a resolved comment leaves a reopen row; dismissing leaves none', async () => {
  await seed();
  await setCommentStatus(
    scopeFor(OWNER),
    { actor: OWNER },
    { presentationId: DECK, commentId: 'cm-resolved', status: 'open' },
  );
  assert.equal(stored('cm-resolved').status, 'open');
  assert.ok(await activityFor('comment.reopened', 'cm-resolved'));

  await setCommentStatus(
    scopeFor(OWNER),
    { actor: OWNER },
    { presentationId: DECK, commentId: 'cm-open', status: 'dismissed' },
  );
  assert.equal(stored('cm-open').status, 'dismissed');
  assert.equal(await activityFor('comment.resolved', 'cm-open'), null);
});

test('a status that is no transition target is refused with 400 invalid, field status', async () => {
  await seed();
  for (const status of [undefined, 'archived', 'toString']) {
    await assert.rejects(
      setCommentStatus(
        scopeFor(OWNER),
        { actor: OWNER },
        { presentationId: DECK, commentId: 'cm-open', status },
      ),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'invalid');
        assert.deepEqual(err.details, { field: 'status' });
        return true;
      },
    );
  }
  assert.equal(stored('cm-open').status, 'open');
});

test('a transition the comment is not in is the reason register’s 400', async () => {
  await seed();
  await assertRefused(
    setCommentStatus(
      scopeFor(OWNER),
      { actor: OWNER },
      { presentationId: DECK, commentId: 'cm-resolved', status: 'dismissed' },
    ),
    400,
    'not_found_or_already_handled',
  );
});

test('a member who may read the deck but not moderate it is refused with 403', async () => {
  await seed();
  await assertRefused(
    setCommentStatus(
      scopeFor(MEMBER),
      { actor: mcpActor(MEMBER) },
      { presentationId: DECK, commentId: 'cm-open', status: 'resolved' },
    ),
    403,
    'forbidden',
  );
  assert.equal(stored('cm-open').status, 'open');
});

test('the moderation refusal comes before the comment lookup: no comment ids leak', async () => {
  await seed();
  await assertRefused(
    setCommentStatus(
      scopeFor(MEMBER),
      { actor: mcpActor(MEMBER) },
      { presentationId: DECK, commentId: 'cm-does-not-exist', status: 'open' },
    ),
    403,
    'forbidden',
  );
});

test('a comment addressed under a deck it is not on is absent (404)', async () => {
  await seed();
  await assertRefused(
    setCommentStatus(
      scopeFor(OWNER),
      { actor: OWNER },
      { presentationId: DECK, commentId: 'cm-elsewhere', status: 'resolved' },
    ),
    404,
    'not_found',
  );
  assert.equal(stored('cm-elsewhere').status, 'open');
});

test('without a deck in the address the comment names its deck (v1)', async () => {
  await seed();
  const { presentation } = await setCommentStatus(
    scopeFor(OWNER),
    { actor: OWNER },
    { commentId: 'cm-elsewhere', status: 'resolved' },
  );
  assert.equal(presentation.id, OTHER_DECK);
  await assertRefused(
    setCommentStatus(
      scopeFor(OWNER),
      { actor: OWNER },
      { commentId: 'cm-missing', status: 'resolved' },
    ),
    404,
    'not_found',
  );
});

test('an organization admin session moderates a deck it does not own; the same person as an MCP actor does not', async () => {
  await seed();
  const { comment } = await setCommentStatus(
    scopeFor(ADMIN),
    { actor: ADMIN },
    { presentationId: DECK, commentId: 'cm-open', status: 'resolved' },
  );
  assert.equal(comment.status, 'resolved');

  await assertRefused(
    setCommentStatus(
      scopeFor(ADMIN),
      { actor: mcpActor(ADMIN) },
      { presentationId: DECK, commentId: 'cm-resolved', status: 'open' },
    ),
    403,
    'forbidden',
  );
});

// ---------------------------------------------------------------------------
// The contracts
// ---------------------------------------------------------------------------

test('internal: the resolve route moves the comment through the service', async () => {
  await seed();
  const res = responseDouble();
  await withErrorHandler('test', handlePresentationCommentResolve)(
    {
      storageScope: scopeFor(OWNER),
      req: { method: 'POST', headers: {} },
      res,
      authedUser: OWNER,
    },
    DECK,
    'cm-open',
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.comment.status, 'resolved');
});

test('internal: a member is refused with 403 in the API envelope', async () => {
  await seed();
  const res = responseDouble();
  await withErrorHandler('test', handlePresentationCommentDismiss)(
    {
      storageScope: scopeFor(MEMBER),
      req: { method: 'POST', headers: {} },
      res,
      authedUser: MEMBER,
    },
    DECK,
    'cm-open',
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'forbidden');
  assert.equal(stored('cm-open').status, 'open');
});

test('MCP: set_comment_status moves the comment as the session owner', async () => {
  await seed();
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER.email });
  const tool = server.tools.get('set_comment_status');
  const result = await tool.handler(
    { presentationId: DECK, commentId: 'cm-open', status: 'dismissed' },
    { ownerEmail: OWNER.email, organizationId: ORG },
  );
  assert.equal(result.ok, true);
  assert.equal(result.comment.status, 'dismissed');
});

test('MCP: a session owner who may not moderate is refused, nothing changes', async () => {
  await seed();
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: MEMBER.email });
  const tool = server.tools.get('set_comment_status');
  await assertRefused(
    tool.handler(
      { presentationId: DECK, commentId: 'cm-open', status: 'resolved' },
      { ownerEmail: MEMBER.email, organizationId: ORG },
    ),
    403,
    'forbidden',
  );
  assert.equal(stored('cm-open').status, 'open');
});

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

function responseDouble() {
  return {
    statusCode: null,
    body: null,
    writeHead(status) {
      this.statusCode = status;
      return this;
    },
    end(payload) {
      try {
        this.body = payload ? JSON.parse(payload) : null;
      } catch {
        this.body = null;
      }
      return this;
    },
  };
}
