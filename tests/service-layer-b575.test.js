/**
 * The B575 cuts: four deck handlings that each contract used to compose from
 * the deck storage itself now live once in `server/services/`, and every
 * contract that offers them is an adapter (A7.4, D252–D256).
 *
 *   - **listing a deck's comments** (`listComments`, `services/comments.js`):
 *     internal, v1 and MCP `list_comments`. The filters had drifted: the
 *     internal route read an unknown `status` as "all", v1 refused it, MCP's
 *     schema named the values but the handler passed anything on. Now a value
 *     outside a filter's vocabulary is a 400 `invalid` naming the field on
 *     every contract.
 *   - **the cross-deck recent comments** (`listRecentComments`): MCP only, but
 *     the reading rule is the comment service's, not a tool's.
 *   - **unpublishing** (`unpublishPresentation`, `services/publish-presentation.js`):
 *     internal and v1 each carried the three steps.
 *   - **switching theme** (`changeTheme`, `services/theme.js`): the editor's
 *     `/change-theme` and v1's PUT; it lived in the storage tree while both
 *     routes decided the deck themselves. A requested slide conversion that
 *     fails refuses the whole switch (B612) instead of keeping the slide.
 *
 * Every refusal of a write is asserted against the store, not read off the
 * status code: a refused change leaves the deck as it was.
 *
 * Handler-import level against the database double, like the neighbours
 * (tests/public-api-v1-comments.test.js, tests/visibility-change-authz.test.js).
 *
 * Run with: node --test tests/service-layer-b575.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b575']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
process.env.APP_URL = 'https://deck.example';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER_EMAIL = 'owner@example.com';
const STRANGER_EMAIL = 'stranger@example.com';
const DECK_ID = 'd0000575-0000-4000-8000-000000000001';
const STRANGER_DECK_ID = 'd0000575-0000-4000-8000-000000000002';
const MIDNIGHT = '11111111-1111-4111-8111-111111111111';
const AMETHYST = '22222222-2222-4222-8222-222222222222';
const PUBLISH_ID = 'pub-b575';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');
const { handlePresentations: handleInternalPresentations } =
  await import('../server/routes/api/presentations/index.js');
const { handlePublish: handleInternalPublish } =
  await import('../server/routes/api/publish.js');
const { handleComments: handleV1Comments } =
  await import('../server/routes/public-api/v1/comments.js');
const { handlePublishing: handleV1Publishing } =
  await import('../server/routes/public-api/v1/publishing.js');
const { handlePresentations: handleV1Presentations } =
  await import('../server/routes/public-api/v1/presentations.js');
const { listComments } = await import('../server/services/comments.js');

const actor = (email) => ({
  id: userIdFor(email),
  email,
  name: email.split('@')[0],
  role: 'user',
  organizationId: ORG,
});
const OWNER = actor(OWNER_EMAIL);
const STRANGER = actor(STRANGER_EMAIL);

// --- The store ----------------------------------------------------------------

function deckRow({ id, owner, published = null }) {
  return {
    id,
    organization_id: ORG,
    owner_email: owner,
    created_by: owner,
    updated_by: owner,
    owner_user_id: userIdFor(owner),
    created_by_user_id: userIdFor(owner),
    updated_by_user_id: userIdFor(owner),
    title: `Title of ${id}`,
    description: null,
    theme: MIDNIGHT,
    lang: 'nl',
    visibility: 'private',
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
    published,
    created_at: '2026-07-01T00:00:00.000Z',
    modified_at: '2026-07-01T00:00:00.000Z',
    trashed_at: null,
  };
}

function commentRow({
  id,
  presentation_id = DECK_ID,
  body,
  slide_id = null,
  parent_id = null,
  status = 'open',
  comment_type = 'human',
  created_at,
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
    resolved_by: status === 'resolved' ? OWNER_EMAIL : null,
    resolved_at: status === 'resolved' ? '2026-08-03T00:00:00.000Z' : null,
    position_x: null,
    position_y: null,
    comment_type,
    suggestion_category: null,
    proposed_slide: null,
    slide_snapshot: null,
    mentions: [],
    created_at,
    updated_at: created_at,
  };
}

const themeRow = (id, slug) => ({
  id,
  organization_id: null,
  slug,
  label: slug,
  colors: {},
  fonts: {},
  config: {},
});

/** A fresh double: OWNER's published deck with three comments, and STRANGER's deck. */
async function installDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER_EMAIL, STRANGER_EMAIL),
    themes: [themeRow(MIDNIGHT, 'midnight'), themeRow(AMETHYST, 'amethyst')],
    presentations: [
      deckRow({
        id: DECK_ID,
        owner: OWNER_EMAIL,
        published: {
          id: PUBLISH_ID,
          slug: 'deck',
          ogImageUrl: '',
          created: '2026-07-01T00:00:00.000Z',
          modified: '2026-07-01T00:00:00.000Z',
        },
      }),
      deckRow({ id: STRANGER_DECK_ID, owner: STRANGER_EMAIL }),
    ],
    published_presentations: [
      {
        id: PUBLISH_ID,
        organization_id: ORG,
        presentation_id: DECK_ID,
        title: 'Published',
        slug: 'deck',
        og_image_url: '',
        created_at: '2026-07-01T00:00:00.000Z',
        modified_at: '2026-07-01T00:00:00.000Z',
      },
    ],
    presentation_comments: [
      commentRow({
        id: 'c-open',
        slide_id: 'slide-1',
        body: 'Open remark',
        created_at: '2026-08-02T10:00:00.000Z',
      }),
      commentRow({
        id: 'c-resolved',
        body: 'Old remark',
        status: 'resolved',
        created_at: '2026-08-01T00:00:00.000Z',
      }),
      commentRow({
        id: 'c-ai',
        body: 'A suggestion',
        comment_type: 'ai-suggestion',
        created_at: '2026-08-02T12:00:00.000Z',
      }),
    ],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

const storedDeck = (db, id = DECK_ID) =>
  db.__tables.presentations.find((row) => row.id === id);

/** Assert a refused write left the deck exactly as it was. */
function assertUnchanged(db, before, why) {
  const after = storedDeck(db, before.id);
  assert.equal(after.revision, before.revision, `${why} (nothing was written)`);
  assert.equal(after.theme, before.theme, `${why} (theme)`);
  assert.deepEqual(after.published, before.published, `${why} (published)`);
}

// --- The three contracts ------------------------------------------------------

function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers || {});
      return this;
    },
    end(payload) {
      this.body = payload ? JSON.parse(String(payload)) : null;
    },
  };
}

function makeReq(method, body) {
  const req = Readable.from(
    body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
  );
  req.method = method;
  req.headers = { host: 'deck.example', 'content-type': 'application/json' };
  req.socket = { remoteAddress: '203.0.113.9' };
  return req;
}

/** A request on the internal `/api` contract, as `as`. */
async function internal(handler, method, path, { as, body } = {}) {
  const res = makeRes();
  await handler({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(as, { repoRoot: process.cwd() }),
    req: makeReq(method, body),
    res,
    url: new URL(`http://deck.example${path}`),
    authedUser: as,
  });
  return res;
}

/** A request on the public v1 contract, with OWNER's key already authenticated. */
async function v1(handler, method, path, { body, permissions } = {}) {
  const res = makeRes();
  await handler({
    req: makeReq(method, body),
    res,
    url: new URL(`http://deck.example${path}`),
    repoRoot: process.cwd(),
    storageScope: {
      repoRoot: process.cwd(),
      organizationId: ORG,
      actorUserId: OWNER.id,
      actorEmail: OWNER_EMAIL,
    },
    apiKey: {
      id: 'key-1',
      tier: 'free',
      ownerEmail: OWNER_EMAIL,
      permissions: permissions || ['read', 'write', 'comments:read'],
      organizationId: ORG,
    },
    authedUser: OWNER,
  });
  return res;
}

/** Call an MCP tool as a session owned by `ownerEmail`. */
function mcp(tool, args, ownerEmail = OWNER_EMAIL) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: ownerEmail });
  return server.tools
    .get(tool)
    .handler(args, { ownerEmail, organizationId: ORG });
}

// =============================================================================
// listComments — internal, v1, MCP
// =============================================================================

test('listComments: the filters mean the same in the service', async () => {
  await installDb();
  const scope = createStorageScope(OWNER, { repoRoot: process.cwd() });
  const ids = async (input) =>
    (
      await listComments(
        scope,
        { actor: OWNER },
        {
          presentationId: DECK_ID,
          ...input,
        },
      )
    ).comments
      .map((c) => c.id)
      .sort();

  assert.deepEqual(await ids({}), ['c-ai', 'c-open', 'c-resolved']);
  assert.deepEqual(await ids({ status: 'resolved' }), ['c-resolved']);
  assert.deepEqual(await ids({ commentType: 'ai-suggestion' }), ['c-ai']);
  assert.deepEqual(await ids({ slideId: 'slide-1' }), ['c-open']);
  assert.deepEqual(await ids({ since: '2026-08-02' }), ['c-ai', 'c-open']);
});

test('internal list: the owner reads, an unknown status is refused, a stranger is refused', async () => {
  await installDb();
  const path = `/api/presentations/${DECK_ID}/comments`;

  const ok = await internal(handleInternalPresentations, 'GET', path, {
    as: OWNER,
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.comments.length, 3);
  assert.equal(ok.body.openCount, 2);

  // Read as "all" without a word before B575.
  const bogus = await internal(
    handleInternalPresentations,
    'GET',
    `${path}?status=bogus`,
    { as: OWNER },
  );
  assert.equal(bogus.statusCode, 400);
  assert.equal(bogus.body.error, 'invalid');
  assert.equal(bogus.body.details.field, 'status');

  const kind = await internal(
    handleInternalPresentations,
    'GET',
    `${path}?commentType=robot`,
    { as: OWNER },
  );
  assert.equal(kind.statusCode, 400);
  assert.equal(kind.body.details.field, 'commentType');

  const stranger = await internal(handleInternalPresentations, 'GET', path, {
    as: STRANGER,
  });
  assert.equal(stranger.statusCode, 403);
});

test('v1 list: an unknown status or since is 400 invalid naming the field', async () => {
  await installDb();
  const path = `/api/v1/presentations/${DECK_ID}/comments`;

  const ok = await v1(handleV1Comments, 'GET', `${path}?since=2026-08-02`);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.total, 2);
  assert.equal(ok.body.since, '2026-08-02T00:00:00.000Z');

  for (const [query, field] of [
    ['status=bogus', 'status'],
    ['since=not-a-date', 'since'],
  ]) {
    const res = await v1(handleV1Comments, 'GET', `${path}?${query}`);
    assert.equal(res.statusCode, 400, query);
    assert.equal(res.body.error, 'invalid', query);
    assert.equal(res.body.details.field, field, query);
  }

  const foreign = await v1(
    handleV1Comments,
    'GET',
    `/api/v1/presentations/${STRANGER_DECK_ID}/comments`,
  );
  assert.equal(foreign.statusCode, 403);
});

test('MCP list_comments: the same filters, the same refusals', async () => {
  await installDb();

  const listed = await mcp('list_comments', {
    presentationId: DECK_ID,
    status: 'open',
  });
  assert.deepEqual(listed.comments.map((c) => c.id).sort(), ['c-ai', 'c-open']);
  assert.equal(listed.presentationTitle, `Title of ${DECK_ID}`);

  await assert.rejects(
    mcp('list_comments', { presentationId: DECK_ID, status: 'bogus' }),
    (err) => err.code === 'invalid' && err.details?.field === 'status',
  );
  await assert.rejects(
    mcp('list_comments', { presentationId: DECK_ID, since: 'nope' }),
    (err) => err.code === 'invalid' && err.details?.field === 'since',
  );
  await assert.rejects(
    mcp('list_comments', { presentationId: DECK_ID }, STRANGER_EMAIL),
    (err) => err.status === 403 || err.statusCode === 403,
  );
});

// =============================================================================
// listRecentComments — MCP list_recent_comments
// =============================================================================

test('MCP list_recent_comments: rows carry their deck, an unknown filter is refused', async () => {
  await installDb();

  const listed = await mcp('list_recent_comments', { status: 'open' });
  assert.deepEqual(listed.comments.map((c) => c.id).sort(), ['c-ai', 'c-open']);
  const anchored = listed.comments.find((c) => c.id === 'c-open');
  assert.equal(
    anchored.slide.index,
    0,
    'the deck was loaded for slide context',
  );

  await assert.rejects(
    mcp('list_recent_comments', { ownership: 'everyone' }),
    (err) => err.code === 'invalid' && err.details?.field === 'ownership',
  );
  await assert.rejects(
    mcp('list_recent_comments', { since: 'nope' }),
    (err) => err.code === 'invalid' && err.details?.field === 'since',
  );
});

// =============================================================================
// unpublishPresentation — internal, v1
// =============================================================================

test('internal unpublish: the owner takes the link down, a stranger changes nothing', async () => {
  const db = await installDb();
  const path = `/api/presentations/${DECK_ID}/publish`;
  const before = structuredClone(storedDeck(db));

  const refused = await internal(handleInternalPublish, 'DELETE', path, {
    as: STRANGER,
  });
  assert.equal(refused.statusCode, 403);
  assertUnchanged(db, before, 'a stranger may not unpublish');
  assert.equal(db.__tables.published_presentations.length, 1);

  const res = await internal(handleInternalPublish, 'DELETE', path, {
    as: OWNER,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(db.__tables.published_presentations.length, 0);
  assert.equal(storedDeck(db).published, null);
  assert.deepEqual(
    storedDeck(db).slides,
    before.slides,
    'only the published column is written',
  );
});

test('v1 unpublish: a deck the key owner cannot write is refused and untouched', async () => {
  const db = await installDb();
  const before = structuredClone(storedDeck(db, STRANGER_DECK_ID));

  const res = await v1(
    handleV1Publishing,
    'DELETE',
    `/api/v1/presentations/${STRANGER_DECK_ID}/publish`,
  );
  assert.equal(res.statusCode, 403);
  assertUnchanged(db, before, 'the key owner may not unpublish it');

  const ok = await v1(
    handleV1Publishing,
    'DELETE',
    `/api/v1/presentations/${DECK_ID}/publish`,
  );
  assert.equal(ok.statusCode, 200);
  assert.equal(storedDeck(db).published, null);
  assert.equal(db.__tables.published_presentations.length, 0);
});

// =============================================================================
// changeTheme — internal /change-theme, v1 PUT
// =============================================================================

test('internal change-theme: the owner switches; an unknown theme and a stranger change nothing', async () => {
  const db = await installDb();
  const path = `/api/presentations/${DECK_ID}/change-theme`;
  const before = structuredClone(storedDeck(db));

  const unknown = await internal(handleInternalPresentations, 'POST', path, {
    as: OWNER,
    body: { newThemeId: 'no-such-theme' },
  });
  assert.equal(unknown.statusCode, 400);
  assert.equal(unknown.body.error, 'invalid');
  assert.equal(unknown.body.details.field, 'theme');
  assertUnchanged(db, before, 'an unknown theme is refused');

  const stranger = await internal(handleInternalPresentations, 'POST', path, {
    as: STRANGER,
    body: { newThemeId: AMETHYST },
  });
  assert.equal(stranger.statusCode, 403);
  assertUnchanged(db, before, 'a stranger may not switch the theme');

  const ok = await internal(handleInternalPresentations, 'POST', path, {
    as: OWNER,
    body: { newThemeId: AMETHYST },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.presentation.theme, AMETHYST);
  assert.equal(storedDeck(db).theme, AMETHYST);
  assert.equal(storedDeck(db).slides.length, 2, 'the slides stay');
});

test('internal change-theme: a failed slide conversion is refused and changes nothing (B612)', async () => {
  const db = await installDb();
  const path = `/api/presentations/${DECK_ID}/change-theme`;
  const before = structuredClone(storedDeck(db));

  // slide-1 converts fine; slide-2 asks for a type that does not exist. The
  // whole switch is refused: neither the theme nor slide-1 is written.
  const refused = await internal(handleInternalPresentations, 'POST', path, {
    as: OWNER,
    body: {
      newThemeId: AMETHYST,
      convertSlides: [
        { slideId: 'slide-1', convertTo: 'chapter-title-slide' },
        { slideId: 'slide-2', convertTo: 'no-such-type' },
      ],
    },
  });
  assert.equal(refused.statusCode, 400);
  assert.equal(refused.body.error, 'invalid');
  assert.equal(refused.body.details.field, 'convertSlides');
  assert.equal(refused.body.details.index, 1, 'the entry that failed');
  assert.match(refused.body.message, /slide-2/, 'the message names the slide');
  assertUnchanged(db, before, 'a failed conversion is refused');
  assert.deepEqual(
    storedDeck(db).slides,
    before.slides,
    'no slide was converted',
  );

  const ok = await internal(handleInternalPresentations, 'POST', path, {
    as: OWNER,
    body: {
      newThemeId: AMETHYST,
      convertSlides: [{ slideId: 'slide-1', convertTo: 'chapter-title-slide' }],
    },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(storedDeck(db).theme, AMETHYST);
  assert.equal(storedDeck(db).slides[0].type, 'chapter-title-slide');
});

test('v1 PUT theme: an unknown theme and a foreign deck change nothing', async () => {
  const db = await installDb();
  const before = structuredClone(storedDeck(db));

  const unknown = await v1(
    handleV1Presentations,
    'PUT',
    `/api/v1/presentations/${DECK_ID}`,
    { body: { theme: 'no-such-theme' } },
  );
  assert.equal(unknown.statusCode, 400);
  assert.equal(unknown.body.details.field, 'theme');
  assertUnchanged(db, before, 'an unknown theme is refused');

  const foreignBefore = structuredClone(storedDeck(db, STRANGER_DECK_ID));
  const foreign = await v1(
    handleV1Presentations,
    'PUT',
    `/api/v1/presentations/${STRANGER_DECK_ID}`,
    { body: { theme: AMETHYST } },
  );
  assert.equal(foreign.statusCode, 403);
  assertUnchanged(db, foreignBefore, 'the key owner may not switch it');

  const ok = await v1(
    handleV1Presentations,
    'PUT',
    `/api/v1/presentations/${DECK_ID}`,
    { body: { theme: AMETHYST } },
  );
  assert.equal(ok.statusCode, 200);
  assert.equal(storedDeck(db).theme, AMETHYST);
});
