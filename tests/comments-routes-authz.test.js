/**
 * The internal presentation-comments route layer (test-coverage gap map, B40 —
 * surface 6, "Comments-schrijfroutes").
 *
 * `server/routes/api/presentations/comments-{write,actions}.js` carry the
 * mutations this file pins; the read side (`comments-list.js`: list, get,
 * counts, SSE events) shares the same comment-auth gate but is not driven
 * here — a follow-up alongside the guest-session fixture below. The comment services,
 * storage and the permission *helpers* are tested elsewhere (a dozen
 * `tests/comment-*` files, and `tests/comment-delete-authz.test.js` for the
 * `canDeleteComment` helper); the public v1 mirror is `#759`. What was
 * untested is the route layer itself — that each handler is wired to the right
 * permission check, so the who-may-do-what matrix actually holds on the wire.
 *
 * That matrix is the point of this file, and it is deliberately not uniform:
 *
 *   - **Commenting** follows read access: the owner, any same-organization
 *     member of an organization-visible deck, or a comment/edit collaborator.
 *   - **Editing a comment is author-only** — not even the deck owner may
 *     rewrite someone else's words; only the author or an admin.
 *   - **Deleting is author *or* moderator** — the author, an admin, or the deck
 *     owner/creator (owners clean up AI suggestions and guest noise).
 *   - **Resolving / reopening / dismissing / applying is owner-or-admin only** —
 *     not the author, not a plain collaborator; these change shared thread
 *     state, so they sit with whoever owns the deck.
 *
 * These four rules are stated below as assertions across the handlers, because
 * the check is repeated per handler rather than centralised — as many places to
 * get it right as to get it wrong.
 *
 * Guest access (a share-link `share_guest_session`) is a second identity path
 * through the same handlers; its helper logic (`canGuest{Comment,EditComment,
 * DeleteComment}`) is unit-tested, and pinning the route wiring for it needs a
 * seeded share-link + guest session — a distinct fixture noted as a follow-up,
 * not folded in here. The fire-and-forget side effects (notifications, activity
 * events, SSE broadcasts) are the brief's opt-out 5: they settle after the
 * response, so asserting them at the route level is a race.
 *
 * House shape (see `tests/collaborators-permission-model.test.js`): the exported
 * handler is called directly with a req/res double over `tests/helpers/fake-db.js`
 * and the router's own `createStorageScope`. No HTTP server, no browser.
 *
 * Run with: node --test tests/comments-routes-authz.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.BREVO_API_KEY; // the notify path is fire-and-forget; keep it off the network

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';
const DECK = 'deck-owned';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } = await import(
  '../server/storage/lifecycle.js'
);
const { createStorageScope } = await import('../server/utils/context.js');
const { invalidatePermission } = await import(
  '../server/storage/cache/permission-cache.js'
);
const {
  handlePresentationCommentsCreate,
  handlePresentationCommentUpdate,
  handlePresentationCommentDelete,
  handlePresentationCommentResolve,
  handlePresentationCommentReopen,
  handlePresentationCommentDismiss,
  handlePresentationCommentApply,
  handlePresentationCommentsMarkRead,
} = await import('../server/routes/api/presentations/comments.js');

/** @typedef {{email: string, name: string, organizationId: string, isAdmin?: boolean}} Actor */

const ACTORS = {
  owner: { email: 'owner@example.com', name: 'Olive Owner', organizationId: ORG },
  admin: { email: 'admin@example.com', name: 'Ada Admin', organizationId: ORG, isAdmin: true },
  author: { email: 'author@example.com', name: 'Andy Author', organizationId: ORG },
  member: { email: 'member@example.com', name: 'Mia Member', organizationId: ORG },
  outsider: { email: 'otto@other.example', name: 'Otto Outsider', organizationId: OTHER_ORG },
};

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default', slug: 'default' }] }));
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/** @param {Actor} actor */
function userRow(actor) {
  return {
    id: `user-${actor.email.split('@')[0]}`,
    organization_id: actor.organizationId,
    email: actor.email,
    name: actor.name,
    role: actor.isAdmin ? 'admin' : 'user',
    auth_source: 'database',
    password_hash: null,
    settings: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

/**
 * The deck is organization-visible so every same-org actor can read and comment;
 * what separates them is who may *edit*, *delete* and *resolve*. Owned by Olive.
 */
function deckRow() {
  return {
    id: DECK,
    organization_id: ORG,
    title: 'Owned deck',
    owner_email: ACTORS.owner.email,
    created_by: ACTORS.owner.email,
    updated_by: ACTORS.owner.email,
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

/** A `presentation_comments` row in the shape `createComment` writes. */
function commentRow(overrides) {
  return {
    id: overrides.id,
    presentation_id: DECK,
    organization_id: ORG,
    slide_id: 's1',
    parent_id: null,
    author_email: ACTORS.author.email,
    author_name: ACTORS.author.name,
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

/** Reinstall a freshly seeded double and clear the collaborator permission cache. */
async function seed() {
  db = createFakeDb({
    organizations: [
      { id: ORG, name: 'Default', slug: 'default' },
      { id: OTHER_ORG, name: 'Other', slug: 'other' },
    ],
    users: Object.values(ACTORS).map(userRow),
    presentations: [deckRow()],
    presentation_collaborators: [],
    presentation_comments: [
      commentRow({ id: 'cm-open' }),
      commentRow({ id: 'cm-resolved', status: 'resolved', resolved_by: ACTORS.owner.email }),
      // An AI suggestion carrying a proposed slide, anchored to s1 — for apply/dismiss.
      commentRow({
        id: 'cm-ai',
        author_email: 'ai@deckyard.local',
        author_name: 'Deckyard AI',
        comment_type: 'ai_suggestion',
        suggestion_category: 'clarity',
        proposed_slide: { type: 'content-slide', content: { title: 'Proposed' } },
      }),
    ],
    comment_thread_reads: [],
  });
  __setTestDb(db);

  for (const actor of Object.values(ACTORS)) {
    await invalidatePermission(DECK, actor.email);
  }
  return db;
}

// ---------------------------------------------------------------------------
// Driving the handlers
// ---------------------------------------------------------------------------

/** A response double capturing the status/body the http helpers write. */
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
      try {
        this.body = payload ? JSON.parse(payload) : null;
      } catch {
        this.body = null;
      }
      return this;
    },
  };
}

/**
 * Call a comment handler the way `dispatchRoutes` does — the presentation id and
 * comment id arrive as trailing positional args after the context.
 *
 * @param {Function} handler
 * @param {string} method
 * @param {Object} [options]
 * @param {Actor|null} [options.as] - Acting user; omit for anonymous.
 * @param {Object} [options.body] - JSON request body.
 * @param {Array<string>} [options.args] - Path captures (id, commentId).
 * @returns {Promise<{handled: *, res: Object}>}
 */
async function call(handler, method, { as = null, body, args = [DECK] } = {}) {
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
  const handled = await handler(
    {
      repoRoot: process.cwd(),
      storageScope: createStorageScope(authedUser, { repoRoot: process.cwd() }),
      req,
      res,
      url: new URL(`http://decks.example.test/api/presentations/${DECK}/comments`),
      authedUser,
    },
    ...args
  );
  return { handled, res };
}

const comments = () => db.__tables.presentation_comments;
const commentById = (id) => comments().find((c) => c.id === id);

// ===========================================================================
// Create — commenting follows read access
// ===========================================================================

test('the deck owner can create a comment', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentsCreate, 'POST', {
    as: ACTORS.owner,
    body: { body: 'Looks great', slideId: 's1' },
    args: [DECK],
  });

  assert.equal(res.statusCode, 201);
  assert.equal(comments().filter((c) => c.author_email === ACTORS.owner.email).length, 1);
});

test('a same-organization member can create a comment on an org-visible deck', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentsCreate, 'POST', {
    as: ACTORS.member,
    body: { body: 'A thought' },
    args: [DECK],
  });

  assert.equal(res.statusCode, 201);
});

test('someone in another organization cannot comment — the deck is absent to them', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentsCreate, 'POST', {
    as: ACTORS.outsider,
    body: { body: 'Hello from elsewhere' },
    args: [DECK],
  });

  assert.equal(res.statusCode, 404, 'a cross-org deck is not-found, not forbidden');
});

// The anonymous cells pin the wiring of the permission check itself: the
// cross-org 404 above is produced by storage scoping alone, so without these
// the create/edit/delete/resolve handlers would stay green with their
// `withPresentationCommentAuth` checks short-circuited to allow.
test('an anonymous visitor cannot comment', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentsCreate, 'POST', {
    body: { body: 'Drive-by' },
    args: [DECK],
  });

  assert.equal(res.statusCode, 401, 'no session and no guest grant means no commenting');
  assert.equal(comments().length, 3, 'nothing was written');
});

test('an anonymous visitor cannot edit, delete or resolve', async () => {
  await seed();
  const edit = await call(handlePresentationCommentUpdate, 'PUT', {
    body: { body: 'Rewrite' },
    args: [DECK, 'cm-open'],
  });
  const del = await call(handlePresentationCommentDelete, 'DELETE', { args: [DECK, 'cm-open'] });
  const resolve = await call(handlePresentationCommentResolve, 'POST', { args: [DECK, 'cm-open'] });

  assert.equal(edit.res.statusCode, 401);
  assert.equal(del.res.statusCode, 401);
  assert.equal(resolve.res.statusCode, 401);
  assert.equal(commentById('cm-open').body, 'Body of cm-open', 'the comment is untouched');
  assert.equal(commentById('cm-open').resolved_at, null, 'and not resolved');
});

test('create rejects an empty body with a 400', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentsCreate, 'POST', {
    as: ACTORS.owner,
    body: { body: '   ' },
    args: [DECK],
  });

  assert.equal(res.statusCode, 400);
});

test('create only answers POST', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentsCreate, 'GET', { as: ACTORS.owner, args: [DECK] });

  assert.equal(res.statusCode, 405);
});

// ===========================================================================
// Update — editing a comment is author-only
// ===========================================================================

test('the author can edit their own comment', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentUpdate, 'PUT', {
    as: ACTORS.author,
    body: { body: 'Reworded' },
    args: [DECK, 'cm-open'],
  });

  assert.equal(res.statusCode, 200);
  assert.equal(commentById('cm-open').body, 'Reworded');
});

test('the deck owner may not edit someone else’s comment', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentUpdate, 'PUT', {
    as: ACTORS.owner,
    body: { body: 'Owner rewrite' },
    args: [DECK, 'cm-open'],
  });

  assert.equal(res.statusCode, 401, 'editing is author-only, even for the owner');
  assert.equal(commentById('cm-open').body, 'Body of cm-open', 'the words are untouched');
});

test('an admin may edit any comment', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentUpdate, 'PUT', {
    as: ACTORS.admin,
    body: { body: 'Admin fix' },
    args: [DECK, 'cm-open'],
  });

  assert.equal(res.statusCode, 200);
});

test('a same-org member who is not the author may not edit', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentUpdate, 'PUT', {
    as: ACTORS.member,
    body: { body: 'Nope' },
    args: [DECK, 'cm-open'],
  });

  assert.equal(res.statusCode, 401);
});

test('editing a comment that does not exist is a 404', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentUpdate, 'PUT', {
    as: ACTORS.author,
    body: { body: 'x' },
    args: [DECK, 'no-such-comment'],
  });

  assert.equal(res.statusCode, 404);
});

test('update only answers PUT', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentUpdate, 'POST', {
    as: ACTORS.author,
    body: { body: 'x' },
    args: [DECK, 'cm-open'],
  });

  assert.equal(res.statusCode, 405);
});

// ===========================================================================
// Delete — author or moderator (owner/admin)
// ===========================================================================

test('the author can delete their own comment', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentDelete, 'DELETE', {
    as: ACTORS.author,
    args: [DECK, 'cm-open'],
  });

  assert.equal(res.statusCode, 200);
  assert.equal(commentById('cm-open'), undefined);
});

test('the deck owner can moderate (delete) another person’s comment', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentDelete, 'DELETE', {
    as: ACTORS.owner,
    args: [DECK, 'cm-open'],
  });

  assert.equal(res.statusCode, 200, 'owners moderate their own deck');
  assert.equal(commentById('cm-open'), undefined);
});

test('a same-org member who is neither author nor owner may not delete', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentDelete, 'DELETE', {
    as: ACTORS.member,
    args: [DECK, 'cm-open'],
  });

  assert.equal(res.statusCode, 401);
  assert.ok(commentById('cm-open'), 'the comment survives a refused delete');
});

test('deleting a comment that does not exist is a 404', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentDelete, 'DELETE', {
    as: ACTORS.owner,
    args: [DECK, 'ghost'],
  });

  assert.equal(res.statusCode, 404);
});

// ===========================================================================
// Resolve / reopen / dismiss — owner-or-admin only
// ===========================================================================

test('the owner can resolve a comment', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentResolve, 'POST', {
    as: ACTORS.owner,
    args: [DECK, 'cm-open'],
  });

  assert.equal(res.statusCode, 200);
  assert.equal(commentById('cm-open').status, 'resolved');
});

test('the author may not resolve their own comment', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentResolve, 'POST', {
    as: ACTORS.author,
    args: [DECK, 'cm-open'],
  });

  assert.equal(res.statusCode, 401, 'resolving is owner/admin, not the author');
  assert.equal(commentById('cm-open').status, 'open');
});

test('a plain member may not resolve a comment', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentResolve, 'POST', {
    as: ACTORS.member,
    args: [DECK, 'cm-open'],
  });

  assert.equal(res.statusCode, 401);
});

test('an admin can resolve a comment', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentResolve, 'POST', {
    as: ACTORS.admin,
    args: [DECK, 'cm-open'],
  });

  assert.equal(res.statusCode, 200);
});

test('resolving a comment that does not exist is a 404', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentResolve, 'POST', {
    as: ACTORS.owner,
    args: [DECK, 'ghost'],
  });

  assert.equal(res.statusCode, 404);
});

test('resolve only answers POST', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentResolve, 'GET', {
    as: ACTORS.owner,
    args: [DECK, 'cm-open'],
  });

  assert.equal(res.statusCode, 405);
});

test('the owner can reopen a resolved comment; the author cannot', async () => {
  await seed();
  const refused = await call(handlePresentationCommentReopen, 'POST', {
    as: ACTORS.author,
    args: [DECK, 'cm-resolved'],
  });
  assert.equal(refused.res.statusCode, 401);

  const ok = await call(handlePresentationCommentReopen, 'POST', {
    as: ACTORS.owner,
    args: [DECK, 'cm-resolved'],
  });
  assert.equal(ok.res.statusCode, 200);
  assert.equal(commentById('cm-resolved').status, 'open');
});

test('the owner can dismiss an AI suggestion; a member cannot', async () => {
  await seed();
  const refused = await call(handlePresentationCommentDismiss, 'POST', {
    as: ACTORS.member,
    args: [DECK, 'cm-ai'],
  });
  assert.equal(refused.res.statusCode, 401);

  const ok = await call(handlePresentationCommentDismiss, 'POST', {
    as: ACTORS.owner,
    args: [DECK, 'cm-ai'],
  });
  assert.equal(ok.res.statusCode, 200);
  assert.equal(commentById('cm-ai').status, 'dismissed');
});

// ===========================================================================
// Apply — owner-or-admin, and only for a suggestion carrying a proposed slide
// ===========================================================================

test('the owner can apply an AI suggestion, inserting the proposed slide', async () => {
  const db2 = await seed();
  const before = db2.__tables.presentations[0].slides.length;

  const { res } = await call(handlePresentationCommentApply, 'POST', {
    as: ACTORS.owner,
    args: [DECK, 'cm-ai'],
  });

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.newSlideId, 'the new slide id is reported');
  assert.equal(res.body.originalSlideId, 's1');
  assert.equal(db2.__tables.presentations[0].slides.length, before + 1, 'a slide was inserted');
  assert.equal(commentById('cm-ai').status, 'resolved', 'the suggestion is resolved once applied');
});

test('applying a comment without a proposed slide is a 400', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentApply, 'POST', {
    as: ACTORS.owner,
    args: [DECK, 'cm-open'], // a plain human comment, no proposedSlide
  });

  assert.equal(res.statusCode, 400);
});

test('a non-owner may not apply a suggestion', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentApply, 'POST', {
    as: ACTORS.author,
    args: [DECK, 'cm-ai'],
  });

  assert.equal(res.statusCode, 401);
});

// ===========================================================================
// Mark-read — any reader; personal state, validated body
// ===========================================================================

test('a reader can mark threads read', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentsMarkRead, 'POST', {
    as: ACTORS.member,
    body: { commentIds: ['cm-open'] },
    args: [DECK],
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

test('mark-read rejects a non-array commentIds with a 400', async () => {
  await seed();
  const { res } = await call(handlePresentationCommentsMarkRead, 'POST', {
    as: ACTORS.member,
    body: { commentIds: 'cm-open' },
    args: [DECK],
  });

  assert.equal(res.statusCode, 400);
});

test('mark-read refuses more than 500 ids', async () => {
  await seed();
  const many = Array.from({ length: 501 }, (_, i) => `c-${i}`);
  const { res } = await call(handlePresentationCommentsMarkRead, 'POST', {
    as: ACTORS.member,
    body: { commentIds: many },
    args: [DECK],
  });

  assert.equal(res.statusCode, 400);
});
