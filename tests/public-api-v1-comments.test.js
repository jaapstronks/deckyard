/**
 * Contract tests for the public API v1 comments module (B40 PR 5+):
 * GET/POST /api/v1/presentations/:id/comments and
 * POST /api/v1/comments/:commentId/status.
 *
 * The surface these pin, per docs/openapi.yaml: the comment listing with
 * nested replies, slide context, create-time snapshot and editUrl deep link;
 * comment/reply creation as the key owner; the status transitions
 * (open→resolved, open→dismissed, resolved→open, 409 otherwise); and the
 * gates — `comments:read`/`comments:write` permissions, deck access, and the
 * owner-only moderation rule.
 *
 * The fire-and-forget side effects (notifications, activity events,
 * SSE broadcasts) are launched with `void` and finish after the response, so
 * they are deliberately not asserted here — racing them would be flaky, and
 * they belong to their own service seams.
 *
 * Handler-import level against the database double, like the neighbours
 * (tests/public-api-partial-write.test.js). Negative assertions pin the
 * status code, not the error envelope (B39 deel 3 bevinding 11).
 *
 * Run with: node --test tests/public-api-v1-comments.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.AUTH_SECRET = ['deckyard', 'test', 'auth']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
process.env.APP_URL = 'https://deck.example';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const KEY_OWNER = 'owner@example.com';
const DECK_ID = 'deck-with-comments';
const ORG_DECK_ID = 'deck-of-the-boss';
const FOREIGN_DECK_ID = 'deck-private-of-someone-else';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { handleComments } =
  await import('../server/routes/public-api/v1/comments.js');
const { MAX_COMMENT_LENGTH } =
  await import('../server/routes/api/presentations/comments-shared.js');

/**
 * Install a freshly seeded double and point the storage facade at Postgres.
 * @returns {Promise<Object>} The database double.
 */
async function installDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    presentations: [
      deckRow({ id: DECK_ID, owner: KEY_OWNER, visibility: 'private' }),
      deckRow({
        id: ORG_DECK_ID,
        owner: 'boss@example.com',
        visibility: 'organization',
      }),
      deckRow({
        id: FOREIGN_DECK_ID,
        owner: 'someone-else@example.com',
        visibility: 'private',
      }),
    ],
    presentation_comments: [
      commentRow({
        id: 'c-open',
        presentation_id: DECK_ID,
        slide_id: 'slide-1',
        body: 'Please rephrase this title',
        created_at: '2026-08-02T10:00:00.000Z',
        slide_snapshot: {
          id: 'slide-1',
          type: 'title-slide',
          content: { title: 'Hoi' },
        },
      }),
      commentRow({
        id: 'c-reply',
        presentation_id: DECK_ID,
        parent_id: 'c-open',
        body: 'Agreed',
        created_at: '2026-08-02T11:00:00.000Z',
      }),
      commentRow({
        id: 'c-resolved',
        presentation_id: DECK_ID,
        body: 'Old remark',
        status: 'resolved',
        resolved_by: KEY_OWNER,
        resolved_at: '2026-08-03T00:00:00.000Z',
        created_at: '2026-08-01T00:00:00.000Z',
      }),
      commentRow({
        id: 'c-on-org-deck',
        presentation_id: ORG_DECK_ID,
        body: 'On the boss deck',
        created_at: '2026-08-02T09:00:00.000Z',
      }),
    ],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

function deckRow({ id, owner, visibility }) {
  return {
    id,
    organization_id: ORG,
    owner_email: owner,
    created_by: owner,
    updated_by: owner,
    title: `Title of ${id}`,
    description: null,
    theme: 'default',
    lang: 'nl',
    visibility,
    revision: 1,
    settings: {},
    i18n: null,
    slides: [
      {
        id: 'slide-1',
        type: 'title-slide',
        content: { title: 'Hoi' },
        parentId: null,
      },
      {
        id: 'slide-2',
        type: 'content-slide',
        content: { title: 'Twee' },
        parentId: null,
      },
    ],
    published: null,
    created_at: '2026-07-01T00:00:00.000Z',
    modified_at: '2026-07-01T00:00:00.000Z',
    trashed_at: null,
  };
}

function commentRow({
  id,
  presentation_id,
  body,
  slide_id = null,
  parent_id = null,
  status = 'open',
  resolved_by = null,
  resolved_at = null,
  created_at,
  slide_snapshot = null,
}) {
  return {
    id,
    presentation_id,
    organization_id: ORG,
    slide_id,
    parent_id,
    author_email: 'reviewer@example.com',
    author_name: 'Reviewer',
    body,
    status,
    resolved_by,
    resolved_at,
    position_x: null,
    position_y: null,
    comment_type: 'human',
    suggestion_category: null,
    proposed_slide: null,
    slide_snapshot,
    mentions: [],
    created_at,
    updated_at: created_at,
  };
}

/**
 * Request context for the comments handler, with the key already
 * authenticated (authenticateApiKey is a different seam with its own tests).
 * @param {string} method - HTTP method
 * @param {string} pathname - Request path
 * @param {Object} [options]
 * @param {Object|null} [options.body] - JSON body
 * @param {string[]} [options.permissions] - API key permissions
 * @returns {Object} ctx, with `res.statusCode` / `res.body` recorded
 */
function makeCtx(
  method,
  pathname,
  { body = null, permissions = ['comments:read', 'comments:write'] } = {},
) {
  const req = Readable.from(
    body === null ? [] : [Buffer.from(JSON.stringify(body))],
  );
  req.method = method;
  req.headers = { 'content-type': 'application/json' };

  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };

  return {
    req,
    res,
    url: new URL(`http://localhost${pathname}`),
    repoRoot: process.cwd(),
    storageScope: {
      repoRoot: process.cwd(),
      organizationId: ORG,
      actorEmail: KEY_OWNER,
    },
    apiKey: {
      id: 'key-1',
      tier: 'free',
      ownerEmail: KEY_OWNER,
      permissions,
      organizationId: ORG,
    },
    authedUser: {
      id: null,
      email: KEY_OWNER,
      role: 'user',
      organizationId: ORG,
    },
  };
}

// ---------------------------------------------------------------------------
// GET /api/v1/presentations/:id/comments
// ---------------------------------------------------------------------------

test('GET /comments lists top-level comments with replies, context and editUrl', async () => {
  await installDb();
  const ctx = makeCtx('GET', `/api/v1/presentations/${DECK_ID}/comments`);
  assert.equal(await handleComments(ctx), true);

  assert.equal(ctx.res.statusCode, 200);
  const body = ctx.res.body;
  assert.equal(body.presentationId, DECK_ID);
  assert.equal(body.presentationTitle, `Title of ${DECK_ID}`);
  assert.equal(body.total, 2, 'replies do not count as top-level comments');
  assert.equal(body.since, null);

  const open = body.comments.find((c) => c.id === 'c-open');
  assert.ok(open, 'the open comment is listed');
  assert.deepEqual(
    open.replies.map((r) => r.id),
    ['c-reply'],
  );
  assert.deepEqual(
    open.slide,
    {
      deleted: false,
      index: 0,
      number: 1,
      type: 'title-slide',
      title: 'Hoi',
    },
    'current slide context rides along',
  );
  assert.deepEqual(
    open.slideSnapshot,
    {
      id: 'slide-1',
      type: 'title-slide',
      content: { title: 'Hoi' },
    },
    'the create-time snapshot is returned as an object',
  );
  assert.equal(
    open.editUrl,
    `https://deck.example/app/${DECK_ID}?slideId=slide-1`,
  );
  assert.equal(
    open.replies[0].editUrl,
    `https://deck.example/app/${DECK_ID}?slideId=slide-1`,
  );
});

test('GET /comments?status= filters and validates the status', async () => {
  await installDb();
  const resolved = makeCtx(
    'GET',
    `/api/v1/presentations/${DECK_ID}/comments?status=resolved`,
  );
  await handleComments(resolved);
  assert.deepEqual(
    resolved.res.body.comments.map((c) => c.id),
    ['c-resolved'],
  );

  const invalid = makeCtx(
    'GET',
    `/api/v1/presentations/${DECK_ID}/comments?status=nonsense`,
  );
  await handleComments(invalid);
  assert.equal(invalid.res.statusCode, 400);
});

test('GET /comments?since= filters on creation time and validates the date', async () => {
  await installDb();
  const since = makeCtx(
    'GET',
    `/api/v1/presentations/${DECK_ID}/comments?since=2026-08-02T00:00:00Z`,
  );
  await handleComments(since);
  assert.equal(since.res.statusCode, 200);
  assert.deepEqual(
    since.res.body.comments.map((c) => c.id),
    ['c-open'],
  );
  assert.equal(since.res.body.since, '2026-08-02T00:00:00.000Z');

  const invalid = makeCtx(
    'GET',
    `/api/v1/presentations/${DECK_ID}/comments?since=not-a-date`,
  );
  await handleComments(invalid);
  assert.equal(invalid.res.statusCode, 400);
});

test('GET /comments?slideId= keeps only comments on that slide', async () => {
  await installDb();
  const ctx = makeCtx(
    'GET',
    `/api/v1/presentations/${DECK_ID}/comments?slideId=slide-1`,
  );
  await handleComments(ctx);
  assert.deepEqual(
    ctx.res.body.comments.map((c) => c.id),
    ['c-open'],
  );
});

test('GET /comments without the comments:read permission is refused with 403', async () => {
  await installDb();
  const ctx = makeCtx('GET', `/api/v1/presentations/${DECK_ID}/comments`, {
    permissions: ['read', 'write', 'comments:write'],
  });
  await handleComments(ctx);
  assert.equal(ctx.res.statusCode, 403);
});

test("GET /comments on someone else's private deck is refused with 403", async () => {
  await installDb();
  const ctx = makeCtx(
    'GET',
    `/api/v1/presentations/${FOREIGN_DECK_ID}/comments`,
  );
  await handleComments(ctx);
  assert.equal(ctx.res.statusCode, 403);
});

test('GET /comments on an unknown deck answers 404', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/presentations/never-a-deck/comments');
  await handleComments(ctx);
  assert.equal(ctx.res.statusCode, 404);
});

// ---------------------------------------------------------------------------
// POST /api/v1/presentations/:id/comments
// ---------------------------------------------------------------------------

test('POST /comments creates a comment as the key owner and answers 201', async () => {
  const db = await installDb();
  const ctx = makeCtx('POST', `/api/v1/presentations/${DECK_ID}/comments`, {
    body: { body: 'A fresh remark', slideId: 'slide-2' },
  });
  await handleComments(ctx);

  assert.equal(ctx.res.statusCode, 201);
  const { ok, comment } = ctx.res.body;
  assert.equal(ok, true);
  assert.equal(comment.authorEmail, KEY_OWNER, 'the key owner is the author');
  assert.equal(comment.body, 'A fresh remark');
  assert.equal(comment.status, 'open');
  assert.deepEqual(comment.slide, {
    deleted: false,
    index: 1,
    number: 2,
    type: 'content-slide',
    title: 'Twee',
  });
  assert.equal(
    comment.editUrl,
    `https://deck.example/app/${DECK_ID}?slideId=slide-2`,
  );
  assert.deepEqual(
    comment.slideSnapshot,
    { id: 'slide-2', type: 'content-slide', content: { title: 'Twee' } },
    'a snapshot of the commented slide is captured at create time',
  );

  const stored = db.__tables.presentation_comments.find(
    (row) => row.id === comment.id,
  );
  assert.ok(stored, 'the comment row was written');
  assert.equal(stored.organization_id, ORG);
});

test('POST /comments with a parentId creates a reply, 404 for an unknown parent', async () => {
  await installDb();
  const reply = makeCtx('POST', `/api/v1/presentations/${DECK_ID}/comments`, {
    body: { body: 'A reply', parentId: 'c-open' },
  });
  await handleComments(reply);
  assert.equal(reply.res.statusCode, 201);
  assert.equal(reply.res.body.comment.parentId, 'c-open');

  // A parent on a *different* presentation is not a valid anchor either.
  const wrongDeck = makeCtx(
    'POST',
    `/api/v1/presentations/${DECK_ID}/comments`,
    {
      body: { body: 'A reply', parentId: 'c-on-org-deck' },
    },
  );
  await handleComments(wrongDeck);
  assert.equal(wrongDeck.res.statusCode, 404);
});

test('POST /comments validates the body text', async () => {
  await installDb();
  for (const body of [null, {}, { body: '' }, { body: '   ' }]) {
    const ctx = makeCtx('POST', `/api/v1/presentations/${DECK_ID}/comments`, {
      body,
    });
    await handleComments(ctx);
    assert.equal(
      ctx.res.statusCode,
      400,
      `${JSON.stringify(body)} must be refused`,
    );
  }

  const tooLong = makeCtx('POST', `/api/v1/presentations/${DECK_ID}/comments`, {
    body: { body: 'x'.repeat(MAX_COMMENT_LENGTH + 1) },
  });
  await handleComments(tooLong);
  assert.equal(tooLong.res.statusCode, 400);
});

test('POST /comments with a slideId that is not in the deck answers 400', async () => {
  await installDb();
  const ctx = makeCtx('POST', `/api/v1/presentations/${DECK_ID}/comments`, {
    body: { body: 'Anchored nowhere', slideId: 'never-a-slide' },
  });
  await handleComments(ctx);
  assert.equal(ctx.res.statusCode, 400);
});

test('POST /comments without the comments:write permission is refused with 403', async () => {
  await installDb();
  const ctx = makeCtx('POST', `/api/v1/presentations/${DECK_ID}/comments`, {
    body: { body: 'Nope' },
    permissions: ['comments:read'],
  });
  await handleComments(ctx);
  assert.equal(ctx.res.statusCode, 403);
});

// ---------------------------------------------------------------------------
// POST /api/v1/comments/:commentId/status
// ---------------------------------------------------------------------------

test('POST /status resolves, dismisses and reopens along the allowed transitions', async () => {
  await installDb();

  const resolve = makeCtx('POST', '/api/v1/comments/c-open/status', {
    body: { status: 'resolved' },
  });
  await handleComments(resolve);
  assert.equal(resolve.res.statusCode, 200);
  assert.equal(resolve.res.body.comment.status, 'resolved');
  assert.equal(resolve.res.body.comment.resolvedBy, KEY_OWNER);

  const reopen = makeCtx('POST', '/api/v1/comments/c-open/status', {
    body: { status: 'open' },
  });
  await handleComments(reopen);
  assert.equal(reopen.res.statusCode, 200);
  assert.equal(reopen.res.body.comment.status, 'open');

  const dismiss = makeCtx('POST', '/api/v1/comments/c-open/status', {
    body: { status: 'dismissed' },
  });
  await handleComments(dismiss);
  assert.equal(dismiss.res.statusCode, 200);
  assert.equal(dismiss.res.body.comment.status, 'dismissed');
});

test('POST /status answers 409 for a transition the app does not allow', async () => {
  await installDb();
  // c-resolved is already resolved; resolving it again is not a transition.
  const ctx = makeCtx('POST', '/api/v1/comments/c-resolved/status', {
    body: { status: 'resolved' },
  });
  await handleComments(ctx);
  assert.equal(ctx.res.statusCode, 409);
});

test('POST /status validates the status value', async () => {
  await installDb();
  for (const body of [null, {}, { status: 'archived' }]) {
    const ctx = makeCtx('POST', '/api/v1/comments/c-open/status', { body });
    await handleComments(ctx);
    assert.equal(
      ctx.res.statusCode,
      400,
      `${JSON.stringify(body)} must be refused`,
    );
  }
});

test('POST /status by someone who is not the deck owner is refused with 403', async () => {
  await installDb();
  // The org-visible deck is readable (and commentable) for the key owner,
  // but moderation stays with the presentation owner/creator.
  const ctx = makeCtx('POST', '/api/v1/comments/c-on-org-deck/status', {
    body: { status: 'resolved' },
  });
  await handleComments(ctx);
  assert.equal(ctx.res.statusCode, 403);
});

test('POST /status on an unknown comment answers 404', async () => {
  await installDb();
  const ctx = makeCtx('POST', '/api/v1/comments/never-a-comment/status', {
    body: { status: 'resolved' },
  });
  await handleComments(ctx);
  assert.equal(ctx.res.statusCode, 404);
});

test('POST /status without the comments:write permission is refused with 403', async () => {
  await installDb();
  const ctx = makeCtx('POST', '/api/v1/comments/c-open/status', {
    body: { status: 'resolved' },
    permissions: ['comments:read'],
  });
  await handleComments(ctx);
  assert.equal(ctx.res.statusCode, 403);
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test('PUT on the comments collection answers 405 with the allowed methods', async () => {
  await installDb();
  const ctx = makeCtx('PUT', `/api/v1/presentations/${DECK_ID}/comments`);
  await handleComments(ctx);
  assert.equal(ctx.res.statusCode, 405);
  assert.equal(ctx.res.headers.Allow ?? ctx.res.headers.allow, 'GET, POST');
});

test('a pathname outside the comments surface is not handled', async () => {
  await installDb();
  const ctx = makeCtx('GET', `/api/v1/presentations/${DECK_ID}`);
  assert.equal(await handleComments(ctx), false);
  assert.equal(ctx.res.statusCode, null, 'no response was written');
});
