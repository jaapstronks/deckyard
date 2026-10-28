/**
 * The AI review notes stay with the author (B767).
 *
 * The generation writes `_aiReasoning`, `_aiAlternatives` and `_aiWarnings`
 * onto every slide it makes, and the storage keeps them: the editor's slide
 * notes and review grid read them. They can quote the source the deck was made
 * from, so whoever may only look at a deck must not receive them. No filter
 * used to remove them (B767), and every surface that serves slide JSON to a
 * reader without edit rights handed them out.
 *
 * One row per such surface, each driven through its handler on the in-memory
 * database double:
 *
 *   - `GET /api/presentations/:id` for a view collaborator (and `?lang=`);
 *   - `POST /api/share/:token/verify`, with and without a password;
 *   - `GET /api/follow/:id/presentation` for the audience;
 *   - the embed and the published page, which render server-side;
 *   - `GET /api/v1/presentations/:id` for a key of a view collaborator.
 *
 * The editor's own read keeps the notes, on the internal route and on v1, or a
 * GET-then-PUT through the API would drop them.
 *
 * Run with: node --test tests/ai-review-meta-viewer-surfaces.test.js
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { createMockReq, createMockRes } from './helpers/http-mocks.js';
import { testScope } from './helpers/storage-scope.js';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { brandSeedRow } from './helpers/theme-seed.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const REPO_ROOT = '/tmp/deckyard-ai-review-meta-test';
const OWNER = 'owner@example.com';
const VIEWER = 'viewer@example.com';
const EDITOR = 'editor@example.com';
const PASSWORD = 'correct horse battery';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { invalidatePermission } =
  await import('../server/storage/cache/permission-cache.js');
const { createPresentation } =
  await import('../server/storage/presentations/index.js');
const { createLiveSession, updateLiveSessionState } =
  await import('../server/storage/live-sessions/index.js');
const { createShareLink } =
  await import('../server/storage/share-links/index.js');
const { resetRateLimitBuckets } = await import('../server/utils/rate-limit.js');
const { handlePresentationItem } =
  await import('../server/routes/api/presentations/presentation.js');
const { handleSharePublicEndpoints } =
  await import('../server/routes/api/share-links/public.js');
const { handleFollowPresentation } =
  await import('../server/routes/api/follow/presentation.js');
const { buildEmbedHtml } = await import('../server/utils/embed-html/index.js');
const { buildStandaloneHtml } = await import('../server/export/html.js');
const { handlePresentations } =
  await import('../server/routes/public-api/v1/presentations.js');
const { AI_REVIEW_KEYS, stripAiReviewMeta } =
  await import('../server/utils/public-output.js');

/** A marker no slide renders, so its presence anywhere is the note leaking. */
const NOTE = 'SOURCE-QUOTE-B767';

/** A content slide carrying every note the generation writes. */
const notedSlide = (title) => ({
  type: 'content-slide',
  content: { title },
  _aiReasoning: `Kept the claim "${NOTE}" from page 3`,
  _aiAlternatives: [{ type: 'quote-slide', reason: `${NOTE} as a quote` }],
  _aiSuggestAfter: { reason: `A photo of ${NOTE}` },
  _aiWarnings: [`${NOTE} was shortened`],
  _aiReview: { sourceExcerpt: NOTE, fingerprint: '12345678', kind: 'content' },
});

/** Every `_ai*` key on any slide of any slide list in `deck`. */
function aiKeysIn(deck) {
  const lists = [deck?.slides || []];
  for (const v of Object.values(deck?.i18n?.versions || {})) {
    lists.push(v?.slides || []);
  }
  return lists
    .flat()
    .flatMap((s) => Object.keys(s || {}).filter((k) => k.startsWith('_ai')));
}

let db;
let deckId;

before(async () => {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    themes: [await brandSeedRow()],
    users: userRows(OWNER, VIEWER, EDITOR),
    presentation_collaborators: [],
  });
  __setTestDb(db);
  await initializeStorage();

  const nl = [notedSlide('Eerste'), notedSlide('Tweede')];
  const pres = await createPresentation(testScope(REPO_ROOT), {
    title: 'Generated deck',
    ownerEmail: OWNER,
    theme: 'default',
    lang: 'nl',
    slides: nl,
  });
  deckId = pres.id;
  // A second language version that carries the notes too: a filter that only
  // touched `slides` would leave them readable there (B698).
  const row = db.__tables.presentations.find((r) => r.id === deckId);
  row.i18n = {
    dominant: 'nl',
    versions: {
      nl: { title: 'Generated deck', slides: row.slides },
      'en-GB': {
        title: 'Generated deck',
        slides: row.slides.map((s) => ({ ...s, content: { title: 'EN' } })),
      },
    },
  };
  db.__tables.presentation_collaborators.push({
    id: 'c-viewer',
    organization_id: ORG,
    presentation_id: deckId,
    user_email: VIEWER,
    user_id: null,
    permission: 'view',
    invited_by: OWNER,
    invited_at: '2026-02-02T00:00:00.000Z',
    accepted_at: null,
    revoked_at: null,
    revoked_by: null,
    revocation_message: null,
  });
  db.__tables.presentation_collaborators.push({
    ...db.__tables.presentation_collaborators[0],
    id: 'c-editor',
    user_email: EDITOR,
    permission: 'edit',
  });
  await invalidatePermission(deckId, VIEWER);
  await invalidatePermission(deckId, EDITOR);
});

after(() => {
  __setTestDb(null);
});

beforeEach(() => {
  resetRateLimitBuckets();
});

describe('the stored deck carries the notes (precondition)', () => {
  it('every slide of every version has every key', () => {
    const row = db.__tables.presentations.find((r) => r.id === deckId);
    assert.equal(aiKeysIn(row).length, AI_REVIEW_KEYS.length * 2 * 3);
  });
});

describe('stripAiReviewMeta', () => {
  it('drops exactly the declared keys and leaves the rest', () => {
    const slide = {
      id: 'a',
      type: 'content-slide',
      notes: 'n',
      ...notedSlide('A'),
    };
    const out = stripAiReviewMeta({ slides: [slide] });
    assert.deepEqual(Object.keys(out.slides[0]).sort(), [
      'content',
      'id',
      'notes',
      'type',
    ]);
    assert.ok(
      AI_REVIEW_KEYS.every((k) => k in slide),
      'input not mutated',
    );
  });

  it('returns the same deck when no slide carries a note', () => {
    const pres = { slides: [{ id: 'a', type: 'content-slide', content: {} }] };
    assert.equal(stripAiReviewMeta(pres), pres);
  });
});

// ---------------------------------------------------------------------------
// Internal reader route
// ---------------------------------------------------------------------------

async function internalGet(email, query = '') {
  const user = {
    id: userIdFor(email),
    email,
    role: 'user',
    organizationId: ORG,
  };
  const res = createMockRes();
  await handlePresentationItem(
    {
      repoRoot: REPO_ROOT,
      storageScope: createStorageScope(user, { repoRoot: REPO_ROOT }),
      req: { method: 'GET', headers: {} },
      res,
      url: new URL(`http://localhost/api/presentations/${deckId}${query}`),
      authedUser: user,
    },
    deckId,
  );
  assert.equal(res.statusCode, 200, res.body);
  return JSON.parse(res.body);
}

describe('GET /api/presentations/:id', () => {
  it('a view collaborator gets no note, in any version', async () => {
    const body = await internalGet(VIEWER);
    assert.equal(body._userPermission, 'view');
    assert.equal(body.slides.length, 2);
    assert.deepEqual(aiKeysIn(body), []);
  });

  it('nor through the ?lang projection', async () => {
    const body = await internalGet(VIEWER, '?lang=en-GB');
    assert.equal(body.slides[0].content.title, 'EN');
    assert.deepEqual(aiKeysIn(body), []);
  });

  it('the owner keeps them: the editor reads them', async () => {
    const body = await internalGet(OWNER);
    assert.equal(body.slides[0]._aiReasoning.includes(NOTE), true);
    assert.equal(aiKeysIn(body).length, AI_REVIEW_KEYS.length * 2 * 3);
  });

  it('an edit collaborator keeps them as well', async () => {
    const body = await internalGet(EDITOR);
    assert.equal(body._userPermission, 'edit');
    assert.equal(aiKeysIn(body).length, AI_REVIEW_KEYS.length * 2 * 3);
  });
});

// ---------------------------------------------------------------------------
// Share-link viewer
// ---------------------------------------------------------------------------

async function verifyShare(token, body = {}) {
  const res = createMockRes();
  await handleSharePublicEndpoints({
    repoRoot: REPO_ROOT,
    req: createMockReq({ method: 'POST', body }),
    res,
    url: new URL(`/api/share/${token}/verify`, 'http://localhost'),
  });
  assert.equal(res.statusCode, 200, res.body);
  return JSON.parse(res.body);
}

describe('POST /api/share/:token/verify', () => {
  it('an open link serves the slides without a note', async () => {
    const link = await createShareLink(testScope(), deckId, {
      permission: 'view',
    });
    const body = await verifyShare(link.shareLink.token);
    assert.equal(body.presentation.slides.length, 2);
    assert.deepEqual(aiKeysIn(body.presentation), []);
    assert.ok(!JSON.stringify(body).includes(NOTE));
  });

  it('a password link, once opened, serves them without a note too', async () => {
    const link = await createShareLink(testScope(), deckId, {
      permission: 'comment',
      password: PASSWORD,
    });
    const body = await verifyShare(link.shareLink.token, {
      password: PASSWORD,
    });
    assert.equal(body.presentation.slides.length, 2);
    assert.ok(!JSON.stringify(body).includes(NOTE));
  });
});

// ---------------------------------------------------------------------------
// Follow-along audience
// ---------------------------------------------------------------------------

describe('GET /api/follow/:id/presentation', () => {
  it('the audience gets the slides without a note', async () => {
    const session = await createLiveSession(
      { repoRoot: REPO_ROOT, organizationId: ORG, actorEmail: null },
      { presentationId: deckId },
    );
    const row = db.__tables.presentations.find((r) => r.id === deckId);
    await updateLiveSessionState(
      { repoRoot: REPO_ROOT, organizationId: ORG },
      session.sessionId,
      {
        slideId: row.slides[0].id,
        slideIndex: 0,
        slideType: row.slides[0].type,
        updatedAt: Date.now(),
      },
    );
    for (const query of ['', '?lang=en-GB']) {
      const res = createMockRes();
      await handleFollowPresentation(
        {
          repoRoot: REPO_ROOT,
          req: { method: 'GET', headers: {}, socket: {} },
          res,
          url: new URL(
            `/api/follow/${deckId}/presentation${query}`,
            'http://localhost',
          ),
        },
        deckId,
      );
      assert.equal(res.statusCode, 200, res.body);
      const body = JSON.parse(res.body);
      assert.equal(body.status, 'live');
      assert.equal(body.presentation.slides.length, 2);
      assert.ok(!res.body.includes(NOTE), `no note in follow${query}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Server-rendered public pages
// ---------------------------------------------------------------------------

describe('embed and published page', () => {
  /** The deck as the publish routes load it. */
  const storedDeck = () =>
    structuredClone(db.__tables.presentations.find((r) => r.id === deckId));

  it('the embed renders no note', () => {
    const html = buildEmbedHtml(REPO_ROOT, storedDeck(), { publishId: 'p1' });
    assert.match(html, /Eerste/);
    assert.ok(!html.includes(NOTE));
  });

  it('the published page renders no note', async () => {
    const html = await buildStandaloneHtml(REPO_ROOT, storedDeck(), {
      context: 'published',
    });
    assert.match(html, /Eerste/);
    assert.ok(!html.includes(NOTE));
  });
});

// ---------------------------------------------------------------------------
// Public v1
// ---------------------------------------------------------------------------

async function v1Get(email) {
  const req = Readable.from([]);
  req.method = 'GET';
  req.headers = {};
  const res = createMockRes();
  await handlePresentations({
    req,
    res,
    url: new URL(`http://localhost/api/v1/presentations/${deckId}`),
    repoRoot: REPO_ROOT,
    storageScope: testScope(REPO_ROOT),
    apiKey: {
      id: 'key-1',
      tier: 'free',
      ownerEmail: email,
      permissions: ['read'],
      organizationId: ORG,
    },
    authedUser: {
      id: userIdFor(email),
      email,
      role: 'user',
      organizationId: ORG,
    },
  });
  assert.equal(res.statusCode, 200, res.body);
  return JSON.parse(res.body);
}

describe('GET /api/v1/presentations/:id', () => {
  it('a view collaborator gets no note, in any version', async () => {
    const body = await v1Get(VIEWER);
    assert.equal(body.presentation.slides.length, 2);
    assert.deepEqual(aiKeysIn(body.presentation), []);
  });

  it('the owner keeps them, so a GET-then-PUT does not drop them', async () => {
    const body = await v1Get(OWNER);
    assert.equal(
      aiKeysIn(body.presentation).length,
      AI_REVIEW_KEYS.length * 2 * 3,
    );
  });

  it('an edit collaborator keeps them, so their GET-then-PUT does not drop them', async () => {
    const body = await v1Get(EDITOR);
    assert.equal(
      aiKeysIn(body.presentation).length,
      AI_REVIEW_KEYS.length * 2 * 3,
    );
  });
});
