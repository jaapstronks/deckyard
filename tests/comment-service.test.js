/**
 * `createComment` in `server/services/comments.js` — the one comment-create
 * flow under the internal route, the public v1 API and MCP (A7.4, B518).
 *
 * Before B518 each contract carried its own copy, and three things had
 * drifted. This file pins each of them at the service, so no contract can
 * drift again by keeping a copy:
 *
 *   1. **the slide snapshot** — the internal route stored none; now every
 *      anchored comment carries one, whoever writes it;
 *   2. **the parent** — only v1 refused a parent on another deck up front;
 *      now the service does (404 `parent_not_found`), and a reply to a reply
 *      joins its thread (MCP's rule, now everyone's);
 *   3. **the MCP e-mail** — MCP notified in-app only, so an agent's comment
 *      mailed nobody; now the subscription resolver decides for every
 *      contract, and a comment from an actor without a request mails too.
 *
 * Plus the internal contract's two-credential rule: the account comments when
 * it may, otherwise the guest session on the deck does.
 *
 * Run with: node --test tests/comment-service.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
process.env.APP_URL = 'https://decks.example.test';
process.env.BREVO_API_KEY = 'test-key';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const DECK = 'deck-service';
const PRIVATE_DECK = 'deck-private';
const OTHER_DECK = 'deck-other';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { invalidatePermission } =
  await import('../server/storage/cache/permission-cache.js');
const { createComment } = await import('../server/services/comments.js');
const { AppError } = await import('../server/utils/errors.js');
const { withErrorHandler } = await import('../server/utils/http.js');
const { handlePresentationCommentsCreate } =
  await import('../server/routes/api/presentations/comments.js');

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
const GUEST = {
  id: 'guest-gwen',
  email: 'gwen@guest.example',
  name: 'Gwen Guest',
  sessionToken: 'guest-session-gwen',
};

/** @type {ReturnType<typeof createFakeDb>} */
let db;

// Brevo is the network edge of the e-mail channel; record what would be sent.
const realFetch = globalThis.fetch;
/** @type {Array<{ url: string, body: any }>} */
let sent = [];

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    }),
  );
  await initializeStorage();
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init?.body || '{}') });
    return new Response(JSON.stringify({ messageId: 'm-1' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };
});

test.after(() => {
  globalThis.fetch = realFetch;
  delete process.env.BREVO_API_KEY;
  delete process.env.APP_URL;
  __resetStorageForTests();
  __setTestDb(null);
});

function userRow(u) {
  return {
    id: u.id,
    organization_id: ORG,
    email: u.email,
    name: u.name,
    role: 'user',
    auth_source: 'database',
    password_hash: null,
    settings: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function deckRow(id, visibility = 'organization') {
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
    visibility,
    theme: 'default',
    lang: 'nl',
    revision: 1,
    is_view_only: false,
    slides: [
      { id: 's1', type: 'content-slide', content: { title: 'One' } },
      { id: 's2', type: 'content-slide', content: { title: 'Two' } },
    ],
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
    author_email: OWNER.email,
    author_name: OWNER.name,
    author_user_id: OWNER.id,
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
  sent = [];
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: [userRow(OWNER), userRow(MEMBER)],
    app_settings: [{ settings: { notifications: { emailEnabled: true } } }],
    presentations: [
      deckRow(DECK),
      deckRow(PRIVATE_DECK, 'private'),
      deckRow(OTHER_DECK),
    ],
    presentation_collaborators: [],
    presentation_comments: [
      commentRow({ id: 'cm-root' }),
      commentRow({ id: 'cm-reply', parent_id: 'cm-root' }),
      commentRow({ id: 'cm-elsewhere', presentation_id: OTHER_DECK }),
    ],
    comment_thread_reads: [],
    presentation_share_links: [
      {
        id: 'link-private',
        organization_id: ORG,
        presentation_id: PRIVATE_DECK,
        token: 'tok-private',
        label: null,
        permission: 'comment',
        password_hash: null,
        expires_at: null,
        max_uses: null,
        use_count: 0,
        created_by: OWNER.email,
        created_at: '2026-02-01T00:00:00.000Z',
        last_used_at: null,
        revoked_at: null,
        revoked_by: null,
        revocation_message: null,
        registration_mode: 'open',
      },
    ],
    share_link_guests: [
      {
        id: GUEST.id,
        organization_id: ORG,
        share_link_id: 'link-private',
        email: GUEST.email,
        name: GUEST.name,
        verified_at: '2026-02-01T00:00:00.000Z',
        session_token: GUEST.sessionToken,
        session_expires_at: '2099-01-01T00:00:00.000Z',
        created_at: '2026-02-01T00:00:00.000Z',
      },
    ],
  });
  __setTestDb(db);
  for (const u of [OWNER, MEMBER]) {
    for (const deck of [DECK, PRIVATE_DECK, OTHER_DECK]) {
      await invalidatePermission(deck, u.email);
    }
  }
}

const scopeFor = (user) =>
  createStorageScope(user, { repoRoot: process.cwd() });
const stored = (id) =>
  db.__tables.presentation_comments.find((c) => c.id === id);
const storedCount = () => db.__tables.presentation_comments.length;

/** The MCP actor: session owner plus organization, no id and no name. */
const MCP_ACTOR = { email: MEMBER.email, organizationId: ORG };

/** Wait for the fire-and-forget fan-out to reach the network edge. */
async function settle(predicate) {
  for (let i = 0; i < 100 && !predicate(); i += 1) {
    await new Promise((r) => setTimeout(r, 10));
  }
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
// Drift point 1: the snapshot
// ---------------------------------------------------------------------------

test('an anchored comment stores a snapshot of its slide, for an actor', async () => {
  await seed();
  const { comment } = await createComment(
    scopeFor(MEMBER),
    { actor: MCP_ACTOR },
    { presentationId: DECK, body: '  On slide two  ', slideId: 's2' },
  );
  const row = stored(comment.id);
  assert.equal(row.body, 'On slide two', 'the body is trimmed once, here');
  assert.deepEqual(row.slide_snapshot, {
    id: 's2',
    type: 'content-slide',
    content: { title: 'Two' },
  });
});

test('the internal route stores the snapshot too — it used to drop it', async () => {
  await seed();
  const payload = JSON.stringify({ body: 'From the editor', slideId: 's1' });
  const res = responseDouble();
  await withErrorHandler('test', handlePresentationCommentsCreate)(
    {
      storageScope: scopeFor(OWNER),
      req: requestDouble('POST', payload),
      res,
      authedUser: OWNER,
    },
    DECK,
  );
  assert.equal(res.statusCode, 201);
  const row = stored(res.body.comment.id);
  assert.equal(row.slide_snapshot?.id, 's1');
});

test('a slideId that names no slide of the deck is refused with 404', async () => {
  await seed();
  const before = storedCount();
  await assertRefused(
    createComment(
      scopeFor(OWNER),
      { actor: OWNER },
      { presentationId: DECK, body: 'Nowhere', slideId: 'no-such-slide' },
    ),
    404,
    'slide_not_found',
  );
  assert.equal(storedCount(), before);
});

// ---------------------------------------------------------------------------
// Drift point 2: the parent
// ---------------------------------------------------------------------------

test('a parent on another deck is refused with 404, nothing is stored', async () => {
  await seed();
  const before = storedCount();
  await assertRefused(
    createComment(
      scopeFor(OWNER),
      { actor: OWNER },
      { presentationId: DECK, body: 'Reply', parentId: 'cm-elsewhere' },
    ),
    404,
    'parent_not_found',
  );
  assert.equal(storedCount(), before);
});

test('a reply to a reply joins the top of its thread', async () => {
  await seed();
  const { comment } = await createComment(
    scopeFor(OWNER),
    { actor: OWNER },
    { presentationId: DECK, body: 'Me too', parentId: 'cm-reply' },
  );
  assert.equal(stored(comment.id).parent_id, 'cm-root');
});

// ---------------------------------------------------------------------------
// Drift point 3: the MCP e-mail
// ---------------------------------------------------------------------------

test('a comment from an actor without a request (MCP) mails the deck owner', async () => {
  await seed();
  await createComment(
    scopeFor(MEMBER),
    { actor: MCP_ACTOR },
    { presentationId: DECK, body: 'An agent was here' },
  );
  await settle(() => sent.length > 0);
  const mails = sent.filter((s) => s.url.includes('brevo'));
  assert.equal(mails.length, 1, 'the subscription resolver names the owner');
  assert.deepEqual(
    mails[0].body.to.map((t) => t.email),
    [OWNER.email],
  );
  assert.match(
    JSON.stringify(mails[0].body),
    new RegExp(`https://decks\\.example\\.test/app/${DECK}`),
    'links are built on the configured public base URL',
  );
});

// ---------------------------------------------------------------------------
// Who may comment
// ---------------------------------------------------------------------------

test('an actor without a comment right is refused with 403', async () => {
  await seed();
  await assertRefused(
    createComment(
      scopeFor(MEMBER),
      { actor: MEMBER },
      { presentationId: PRIVATE_DECK, body: 'Let me in' },
    ),
    403,
    'forbidden',
  );
});

test('a deck absent from the scope is 404', async () => {
  await seed();
  await assertRefused(
    createComment(
      scopeFor(OWNER),
      { actor: OWNER },
      { presentationId: 'no-such-deck', body: 'Hello' },
    ),
    404,
    'not_found',
  );
});

test('an empty or too-long body is refused with 400', async () => {
  await seed();
  await assertRefused(
    createComment(
      scopeFor(OWNER),
      { actor: OWNER },
      { presentationId: DECK, body: '   ' },
    ),
    400,
    'bad_request',
  );
  await assertRefused(
    createComment(
      scopeFor(OWNER),
      { actor: OWNER },
      { presentationId: DECK, body: 'x'.repeat(5001) },
    ),
    400,
    'bad_request',
  );
});

test('a signed-in account without the right falls back to its guest session', async () => {
  await seed();
  const res = responseDouble();
  await withErrorHandler('test', handlePresentationCommentsCreate)(
    {
      storageScope: scopeFor(MEMBER),
      req: requestDouble(
        'POST',
        JSON.stringify({ body: 'Via the share link', slideId: 's1' }),
        `share_guest_session=${GUEST.sessionToken}`,
      ),
      res,
      authedUser: MEMBER,
    },
    PRIVATE_DECK,
  );
  assert.equal(res.statusCode, 201);
  const row = stored(res.body.comment.id);
  assert.equal(row.author_guest_id, GUEST.id);
  assert.equal(row.author_user_id, null);
  assert.equal(row.slide_snapshot?.id, 's1', 'the guest path snapshots too');
});

test('a signed-in account without the right and without a guest session is 403', async () => {
  await seed();
  const res = responseDouble();
  await withErrorHandler('test', handlePresentationCommentsCreate)(
    {
      storageScope: scopeFor(MEMBER),
      req: requestDouble('POST', JSON.stringify({ body: 'Let me in' })),
      res,
      authedUser: MEMBER,
    },
    PRIVATE_DECK,
  );
  assert.equal(res.statusCode, 403);
});

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

function requestDouble(method, payload, cookie) {
  return {
    method,
    headers: {
      host: 'decks.example.test',
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload, 'utf8');
    },
  };
}

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
