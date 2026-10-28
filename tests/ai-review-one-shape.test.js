/**
 * One review shape for every AI prompt route (B590).
 *
 * Refine (wizard and imports), append ("add slides", internal and MCP) and
 * refine-section spoke three review dialects: `reasoning` plus one
 * `alternativeType`, `why` plus at most two `alternatives`, and `why` alone.
 * The internal append route re-attached its keys by hand and MCP
 * `append_slides` dropped them. Now every route asks for `why`,
 * `alternatives` (at most three) and an optional `imageSuggestionAfter`, and
 * reads them through `parseSlideReview()`. The wizard and the imports are
 * driven in `tests/ai-generation-paths-behaviour.test.js`; this file drives
 * the other routes and pins the prompt text: no route asks for a stock photo
 * or a "TODO: replace image" bullet any more.
 *
 * Against the in-memory database double, the model as `globalThis.fetch`.
 *
 * Run with: node --test tests/ai-review-one-shape.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { brandSeedRow } from './helpers/theme-seed.js';
import { createMockReq, createMockRes } from './helpers/http-mocks.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.SANDBOX_MODE;
process.env.LLM_VENDOR = 'openai';
process.env.OPENAI_API = 'test-key';
process.env.OPENAI_MODEL = 'test-model';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const WHY = 'Three partners read best as a list.';
const SUGGESTION = 'A photo of the partners together.';
/** What the model offers, and what the review keeps of it. */
const RAW_ALTERNATIVES = [
  { type: 'content-slide', reason: 'Plain text.' },
  { type: 'list-slide', reason: 'its own type' },
  { type: 'content-slide', reason: 'a repeat' },
  { type: 'nonsense-slide', reason: 'not a type' },
  { type: 'eu.deckyard.slide.quote', reason: 'One partner speaks.' },
  { type: 'icon-card-grid-slide', reason: 'One card per partner.' },
  { type: 'timeline-slide', reason: 'a fourth one' },
];
const KEPT = ['content-slide', 'quote-slide', 'icon-card-grid-slide'];

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { handleAiAppendSlides } =
  await import('../server/routes/api/ai/append-slides.js');
const { handleAiRefineSection } =
  await import('../server/routes/api/ai/refine-section.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');
const { parseSlideReview, offeredTypeResolver, MAX_REVIEW_ALTERNATIVES } =
  await import('../server/utils/ai/slide-review.js');
const { SLIDE_TYPES } = await import('../shared/slide-types/registry.js');
const { buildSlideTypesPrompt } =
  await import('../server/utils/openai/slide-types-prompt.js');
const { buildPhase2SystemPrompt } =
  await import('../server/utils/ai/prompts/base/refine-slides.js');
const { buildSectionSystemPrompt } =
  await import('../server/utils/ai/prompts/base/refine-section.js');
const { AI_REVIEW_KEYS, stripAiReviewMeta } =
  await import('../server/utils/public-output.js');

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default' }] }));
  await initializeStorage();
});

test.after(() => {
  __setTestDb(null);
});

async function setup() {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER),
    themes: [await brandSeedRow()],
    presentations: [],
  });
  __setTestDb(db);
}

/** One model answer for every route: a list slide with the full review. */
const ANSWER = {
  title: 'Partners',
  rationale: 'test',
  slides: [
    {
      intent: 'content',
      roughContent: 'The partners we work with',
      type: 'list-slide',
      content: {
        title: 'Our partners',
        items: [
          { title: 'Alpha', text: 'Builds' },
          { title: 'Beta', text: 'Ships' },
        ],
      },
      why: WHY,
      alternatives: RAW_ALTERNATIVES,
      imageSuggestionAfter: { reason: SUGGESTION },
    },
  ],
};

/**
 * Answer every model call with {@link ANSWER}; returns the request bodies.
 * @param {import('node:test').TestContext} t
 */
function stubModel(t) {
  const saved = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(String(init?.body ?? ''));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(ANSWER) } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  t.after(() => {
    globalThis.fetch = saved;
  });
  return bodies;
}

const AUTHED = { id: userIdFor(OWNER), email: OWNER, organizationId: ORG };

function ctx(body) {
  return {
    repoRoot: process.cwd(),
    storageScope: createStorageScope(AUTHED, { repoRoot: process.cwd() }),
    req: createMockReq({ method: 'POST', body }),
    res: createMockRes(),
    authedUser: AUTHED,
  };
}

const existingDeck = () => ({
  id: 'deck-1',
  title: 'Partners',
  lang: 'en',
  slides: [
    { id: 's1', type: 'title-slide', content: { title: 'Partners' } },
    { id: 's2', type: 'content-slide', content: { title: 'Old', body: '' } },
  ],
});

/** The review a route must deliver on its one slide. */
function assertReview(slide, label) {
  assert.equal(slide._aiReasoning, WHY, `${label}: why`);
  assert.deepEqual(
    slide._aiAlternatives.map((alt) => alt.type),
    KEPT,
    `${label}: alternatives`,
  );
  assert.deepEqual(
    slide._aiSuggestAfter,
    { reason: SUGGESTION },
    `${label}: suggestion`,
  );
}

/** The review rules in a prompt body, and no stand-in picture. */
function assertPrompt(body, label) {
  assert.match(body, /imageSuggestionAfter/, `${label}: review rules`);
  assert.match(body, /never invent an image URL/i, `${label}: empty image`);
  assert.doesNotMatch(
    body,
    /TODO: replace image|demo-aurora/,
    `${label}: stand-in`,
  );
}

test('parseSlideReview keeps at most three offered types, never its own', () => {
  const offeredType = offeredTypeResolver(SLIDE_TYPES, ['timeline-slide']);
  const review = parseSlideReview(
    {
      why: `  ${WHY} `,
      alternatives: [
        ...RAW_ALTERNATIVES.slice(0, 4),
        { type: 'timeline-slide', reason: 'switched off' },
        ...RAW_ALTERNATIVES.slice(4),
        { type: 'process-slide', reason: 'past the cap' },
      ],
      imageSuggestionAfter: { reason: ` ${SUGGESTION} ` },
    },
    { type: 'list-slide', offeredType },
  );
  assert.equal(MAX_REVIEW_ALTERNATIVES, 3);
  assert.deepEqual(review, {
    why: WHY,
    alternatives: [
      { type: 'content-slide', reason: 'Plain text.' },
      { type: 'quote-slide', reason: 'One partner speaks.' },
      { type: 'icon-card-grid-slide', reason: 'One card per partner.' },
    ],
    imageSuggestionAfter: { reason: SUGGESTION },
  });
  for (const raw of [
    {},
    { imageSuggestionAfter: 'a string' },
    { imageSuggestionAfter: { reason: '  ' } },
    { alternatives: 'list-slide' },
  ]) {
    assert.deepEqual(
      parseSlideReview(raw, { type: 'list-slide', offeredType }),
      {
        why: '',
        alternatives: [],
        imageSuggestionAfter: null,
      },
    );
  }
});

test('the suggestion is author material: every reader projection strips it', () => {
  assert.ok(AI_REVIEW_KEYS.includes('_aiSuggestAfter'));
  const slide = { id: 'a', type: 'list-slide', content: {} };
  const out = stripAiReviewMeta({
    slides: [{ ...slide, _aiSuggestAfter: { reason: SUGGESTION } }],
    i18n: {
      versions: {
        de: { slides: [{ ...slide, _aiSuggestAfter: { reason: 'x' } }] },
      },
    },
  });
  assert.deepEqual(out.slides[0], slide);
  assert.deepEqual(out.i18n.versions.de.slides[0], slide);
});

test('the internal append route returns the one review shape', async (t) => {
  await setup();
  const bodies = stubModel(t);
  const c = ctx({ raw: 'Partners', lang: 'en', deck: existingDeck() });
  await handleAiAppendSlides(c);
  assert.equal(c.res.statusCode, 200, String(c.res.body));
  assertReview(c.res.json().slides[0], 'append');
  assertPrompt(bodies[0], 'append');
});

test('refine-section returns the one review shape', async (t) => {
  await setup();
  const bodies = stubModel(t);
  const c = ctx({
    presentation: existingDeck(),
    slideIds: ['s2'],
    feedback: 'Make it a list',
    lang: 'en',
  });
  await handleAiRefineSection(c);
  assert.equal(c.res.statusCode, 200, String(c.res.body));
  assertReview(c.res.json().slides[0], 'refine-section');
  assertPrompt(bodies[0], 'refine-section');
});

test('MCP append_slides stores the review on the slides it appends', async (t) => {
  await setup();
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  const session = { ownerEmail: OWNER, organizationId: ORG };
  const call = (name, args) => server.tools.get(name).handler(args, session);
  stubModel(t);
  process.env.APP_URL = 'https://slides.example';
  t.after(() => delete process.env.APP_URL);
  const created = await call('create_presentation', {
    content: 'The partners we work with',
    lang: 'en',
  });
  const { id } = created;
  const reviewUrl = `https://slides.example/app/${id}?aiReview=1`;
  assert.equal(created.reviewUrl, reviewUrl, 'create_presentation');
  const bodies = stubModel(t);
  const result = await call('append_slides', {
    presentationId: id,
    content: 'More partners',
  });
  assert.equal(result.appended, 1);
  assert.equal(result.reviewUrl, reviewUrl, 'append_slides');
  assertPrompt(bodies[0], 'MCP append_slides');
  const stored = db.__tables.presentations.find((p) => p.id === id);
  const appended = stored.slides.filter((s) => s._aiReasoning === WHY);
  // create_presentation stored one reviewed slide, append_slides a second.
  assert.equal(appended.length, 2, JSON.stringify(stored.slides));
  assertReview(appended[1], 'MCP append_slides');
});

test('no prompt asks for a stock photo or a TODO bullet', () => {
  const catalog = buildSlideTypesPrompt();
  assert.doesNotMatch(catalog, /TODO: replace image|demo-aurora/);
  assert.match(catalog, /never invent an image URL/i);
  assertPrompt(
    buildPhase2SystemPrompt({
      lang: 'en',
      themeContext: null,
      disabledSlideTypes: [],
      customSlideTypes: [],
    }),
    'phase 2',
  );
  assertPrompt(buildSectionSystemPrompt({ langLabel: 'ENGLISH' }), 'section');
});
