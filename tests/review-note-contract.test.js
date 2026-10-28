/**
 * One public review explanation: `reviewNote` on MCP and v1 (B590 PR C).
 *
 * An agent that builds a deck itself sends a slide's explanation for the
 * author as `reviewNote`. It is stored as the AI review keys
 * (`_aiReasoning`, `_aiReview` with origin `agent`, no source passage),
 * bound by the write seam to the slide as stored, so a fresh agent deck
 * reads as current and an edit makes it stale. v1 refuses the raw `_ai*`
 * keys, answers writers with `reviewNote` only, and a PUT keeps the stored
 * review keys of a slide unless it sends another note. Where the review can
 * open, the answers carry a `reviewUrl`.
 *
 * Against the in-memory database double.
 *
 * Run with: node --test tests/review-note-contract.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { brandSeedRow } from './helpers/theme-seed.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.SANDBOX_MODE;
process.env.APP_URL = 'https://slides.example';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const NOTE = 'A list reads best for three partners.';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');
const { handlePresentations } =
  await import('../server/routes/public-api/v1/presentations.js');
const { handleSlides } =
  await import('../server/routes/public-api/v1/slides.js');
const { isAiReviewCurrent } = await import('../shared/ai-review.js');
const { REVIEW_NOTE_MAX_LENGTH, reviewUrlFor } =
  await import('../server/utils/ai/review-note.js');

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default' }] }));
  await initializeStorage();
});

test.after(() => {
  __setTestDb(null);
  delete process.env.APP_URL;
  delete process.env.AI_ENABLED;
});

async function setup(presentations = []) {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER),
    themes: [await brandSeedRow()],
    presentations,
  });
  __setTestDb(db);
  delete process.env.AI_ENABLED;
}

const stored = (id) => db.__tables.presentations.find((p) => p.id === id);

function mcp() {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  const session = { ownerEmail: OWNER, organizationId: ORG };
  return (name, args) => server.tools.get(name).handler(args, session);
}

const LIST = {
  type: 'list-slide',
  content: {
    title: 'Our partners',
    items: [
      { title: 'Alpha', text: 'Builds' },
      { title: 'Beta', text: 'Ships' },
    ],
  },
};

/** Run one v1 request through a router; answers `{ status, body }`. */
async function v1(router, method, pathname, payload) {
  const req = Readable.from(
    payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))],
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
    writeHead(status) {
      this.statusCode = status;
    },
    end(out) {
      this.body = out ? JSON.parse(out) : null;
    },
  };
  await router({
    req,
    res,
    url: new URL(`http://localhost${pathname}`),
    repoRoot: process.cwd(),
    storageScope: {
      repoRoot: process.cwd(),
      organizationId: ORG,
      actorUserId: userIdFor(OWNER),
      actorEmail: OWNER,
    },
    apiKey: {
      id: 'key-1',
      tier: 'free',
      ownerEmail: OWNER,
      permissions: ['read', 'write'],
      organizationId: ORG,
    },
    authedUser: {
      id: userIdFor(OWNER),
      email: OWNER,
      role: 'user',
      organizationId: ORG,
    },
  });
  return { status: res.statusCode, body: res.body };
}

const rawKeys = (slide) =>
  Object.keys(slide).filter((k) => k.startsWith('_ai'));

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

test('MCP create_presentation_from_slides stores a note as a current agent explanation', async () => {
  await setup();
  const call = mcp();
  const result = await call('create_presentation_from_slides', {
    title: 'Partners',
    slides: [{ ...LIST, reviewNote: `  ${NOTE}  ` }, { ...LIST }],
  });
  const [noted, plain] = stored(result.id).slides;
  assert.equal(noted._aiReasoning, NOTE);
  assert.equal(noted._aiReview.origin, 'agent');
  assert.equal(noted._aiReview.kind, 'content');
  assert.equal(noted._aiReview.sourceExcerpt, null);
  assert.ok(isAiReviewCurrent(noted), 'a fresh agent deck reads as current');
  assert.deepEqual(rawKeys(plain), []);
  assert.equal(
    result.reviewUrl,
    `https://slides.example/app/${result.id}?aiReview=1`,
  );
});

test('an edit makes the agent explanation stale', async () => {
  await setup();
  const { id } = await mcp()('create_presentation_from_slides', {
    title: 'Partners',
    slides: [{ ...LIST, reviewNote: NOTE }],
  });
  const slide = structuredClone(stored(id).slides[0]);
  slide.content.title = 'Our three partners';
  assert.equal(isAiReviewCurrent(slide), false);
});

test('reviewUrl only where a note was sent and the review can open', async () => {
  await setup();
  const call = mcp();
  const plain = await call('create_presentation_from_slides', {
    title: 'Partners',
    slides: [LIST],
  });
  assert.equal(plain.reviewUrl, undefined, 'no note, nothing to review');
  process.env.AI_ENABLED = 'false';
  const off = await call('create_presentation_from_slides', {
    title: 'Partners',
    slides: [{ ...LIST, reviewNote: NOTE }],
  });
  assert.equal(off.reviewUrl, undefined, 'the review does not open without ai');
  assert.equal(stored(off.id).slides[0]._aiReasoning, NOTE);
  assert.equal(reviewUrlFor(off.id), null);
});

test('MCP add_slide stores the note; an overlong note is refused', async () => {
  await setup();
  const call = mcp();
  const { id } = await call('create_presentation_from_slides', {
    title: 'Partners',
    slides: [LIST],
  });
  const added = await call('add_slide', {
    presentationId: id,
    ...LIST,
    reviewNote: NOTE,
  });
  const slide = stored(id).slides.find((s) => s.id === added.slideId);
  assert.equal(slide._aiReasoning, NOTE);
  assert.ok(isAiReviewCurrent(slide));

  await assert.rejects(
    call('add_slide', {
      presentationId: id,
      ...LIST,
      reviewNote: 'x'.repeat(REVIEW_NOTE_MAX_LENGTH + 1),
    }),
    (err) => err.code === 'invalid' && err.details?.field === 'reviewNote',
  );
  assert.equal(stored(id).slides.length, 2, 'nothing added on a refusal');
});

// ---------------------------------------------------------------------------
// v1
// ---------------------------------------------------------------------------

test('v1 create takes reviewNote, answers it back and gives a reviewUrl', async () => {
  await setup();
  const res = await v1(handlePresentations, 'POST', '/api/v1/presentations', {
    title: 'Partners',
    slides: [{ ...LIST, reviewNote: NOTE }],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const out = res.body.presentation;
  const reviewUrl = res.body.reviewUrl;
  assert.equal(out.slides[0].reviewNote, NOTE);
  assert.deepEqual(rawKeys(out.slides[0]), []);
  assert.equal(reviewUrl, `https://slides.example/app/${out.id}?aiReview=1`);
  assert.ok(isAiReviewCurrent(stored(out.id).slides[0]));
});

test('v1 create, PUT and add-slide refuse a raw review key', async () => {
  await setup();
  const create = await v1(
    handlePresentations,
    'POST',
    '/api/v1/presentations',
    {
      title: 'Partners',
      slides: [{ ...LIST, _aiReasoning: NOTE }],
    },
  );
  assert.equal(create.status, 400, JSON.stringify(create.body));
  assert.equal(create.body.error, 'invalid');
  assert.equal(create.body.details.field, '_aiReasoning');
  assert.equal(db.__tables.presentations.length, 0);

  const ok = await v1(handlePresentations, 'POST', '/api/v1/presentations', {
    title: 'Partners',
    slides: [LIST],
  });
  const id = ok.body.presentation.id;
  const slideId = stored(id).slides[0].id;
  const put = await v1(
    handlePresentations,
    'PUT',
    `/api/v1/presentations/${id}`,
    {
      slides: [{ id: slideId, ...LIST, _aiReview: { kind: 'content' } }],
    },
  );
  assert.equal(put.status, 400, JSON.stringify(put.body));
  assert.equal(put.body.details.field, '_aiReview');

  const add = await v1(
    handleSlides,
    'POST',
    `/api/v1/presentations/${id}/slides`,
    {
      ...LIST,
      _aiAlternatives: [],
    },
  );
  assert.equal(add.status, 400, JSON.stringify(add.body));
  assert.equal(add.body.details.field, '_aiAlternatives');
});

test('v1 add-slide takes reviewNote and answers it back', async () => {
  await setup();
  const ok = await v1(handlePresentations, 'POST', '/api/v1/presentations', {
    title: 'Partners',
    slides: [LIST],
  });
  const id = ok.body.presentation.id;
  const add = await v1(
    handleSlides,
    'POST',
    `/api/v1/presentations/${id}/slides`,
    {
      ...LIST,
      reviewNote: NOTE,
    },
  );
  assert.equal(add.status, 201, JSON.stringify(add.body));
  const slide = add.body.slide;
  assert.equal(slide.reviewNote, NOTE);
  assert.ok(
    isAiReviewCurrent(stored(id).slides.find((s) => s.id === slide.id)),
  );
});

/** An AI-generated slide with the full review the wizard leaves. */
const GENERATED_ID = '51000590-0000-4000-8000-000000000001';
function generatedDeck() {
  const slide = {
    id: GENERATED_ID,
    ...structuredClone(LIST),
    _aiReasoning: 'Kept the three partners from page 2.',
    _aiAlternatives: [{ type: 'content-slide', reason: 'Plain text.' }],
    _aiReview: {
      kind: 'content',
      sourceExcerpt: 'Alpha builds, Beta ships',
      fingerprint: 'abc123',
    },
  };
  return {
    id: 'd0000590-0000-4000-8000-000000000590',
    organization_id: ORG,
    owner_email: OWNER,
    created_by: OWNER,
    updated_by: OWNER,
    owner_user_id: userIdFor(OWNER),
    created_by_user_id: userIdFor(OWNER),
    updated_by_user_id: userIdFor(OWNER),
    title: 'Generated',
    theme: 'default',
    lang: 'en',
    visibility: 'private',
    revision: 1,
    slides: [slide],
    created_at: '2026-10-28T00:00:00.000Z',
    modified_at: '2026-10-28T00:00:00.000Z',
    trashed_at: null,
  };
}

test('v1 GET-then-PUT keeps the source passage and the alternatives', async () => {
  const deck = generatedDeck();
  await setup([deck]);
  const get = await v1(
    handlePresentations,
    'GET',
    `/api/v1/presentations/${deck.id}`,
  );
  const pres = get.body.presentation;
  assert.equal(
    pres.slides[0].reviewNote,
    'Kept the three partners from page 2.',
  );
  assert.deepEqual(rawKeys(pres.slides[0]), []);

  const put = await v1(
    handlePresentations,
    'PUT',
    `/api/v1/presentations/${deck.id}`,
    {
      slides: pres.slides,
    },
  );
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const [after] = stored(deck.id).slides;
  assert.equal(after._aiReasoning, 'Kept the three partners from page 2.');
  assert.equal(after._aiReview.sourceExcerpt, 'Alpha builds, Beta ships');
  assert.equal(after._aiReview.fingerprint, 'abc123');
  assert.deepEqual(after._aiAlternatives, [
    { type: 'content-slide', reason: 'Plain text.' },
  ]);

  // Without any reviewNote the stored keys stay as well.
  const { reviewNote: _drop, ...bare } = pres.slides[0];
  await v1(handlePresentations, 'PUT', `/api/v1/presentations/${deck.id}`, {
    slides: [bare],
  });
  assert.equal(
    stored(deck.id).slides[0]._aiReview.sourceExcerpt,
    'Alpha builds, Beta ships',
  );
});

test('v1 PUT with another reviewNote replaces only the explanation', async () => {
  const deck = generatedDeck();
  await setup([deck]);
  const put = await v1(
    handlePresentations,
    'PUT',
    `/api/v1/presentations/${deck.id}`,
    {
      slides: [{ id: GENERATED_ID, ...LIST, reviewNote: NOTE }],
    },
  );
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const [after] = stored(deck.id).slides;
  assert.equal(after._aiReasoning, NOTE);
  assert.equal(after._aiReview.origin, 'agent');
  assert.equal(after._aiReview.sourceExcerpt, null);
  assert.ok(isAiReviewCurrent(after));
  assert.deepEqual(after._aiAlternatives, [
    { type: 'content-slide', reason: 'Plain text.' },
  ]);
});
