/**
 * The analysis offers the model the organization's slide types (B660).
 *
 * `analyzePresentation()` built its "available slide types" from the core
 * catalog alone and validated a `proposedSlide` against that same catalog, so
 * a suggestion could never propose an org type and could propose a type the
 * org turned off, while the apply route (`comments-actions.js`) composes
 * against the org's registry. Every AI path offers the one catalog (D329):
 * the REST route and MCP `analyze_presentation` now spread
 * `loadSlideTypeOffer()` into the analysis, like the generating paths
 * (`tests/ai-paths-org-registry.test.js`).
 *
 * Both callers are driven end to end against the in-memory database double,
 * with the model as `globalThis.fetch`; no network.
 *
 * Run with: node --test tests/analyze-offers-org-types.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { userIdFor, userRows } from './helpers/identity-fixtures.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.SANDBOX_MODE;
process.env.LLM_VENDOR = 'openai';
process.env.OPENAI_API = 'test-key';
process.env.OPENAI_MODEL = 'test-model';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const DECK = 'deck-analyzed';
/** The key the builder publishes the type under. */
const CUSTOM_TYPE = 'custom-partner-wall';
/** A core type this organization turned off; the prompt names it nowhere else. */
const DISABLED_TYPE = 'funnel-slide';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { handlePresentationAnalyze } =
  await import('../server/routes/api/presentations/analyze.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default' }] }));
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

/** One published type with a single `title` field. */
function customTypeRow() {
  return {
    id: 'cst-partner-wall',
    organization_id: ORG,
    slug: 'partner-wall',
    label: 'Partner wall',
    base_type: null,
    fields: [{ key: 'title', type: 'string', label: 'Titel' }],
    defaults: { title: '' },
    defaults_by_lang: null,
    template: '<div class="slide"><h2>{{esc title}}</h2></div>',
    css: null,
    usage: null,
    is_published: true,
    sort_order: 0,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    created_by: null,
  };
}

function setup() {
  db = createFakeDb({
    organizations: [
      {
        id: ORG,
        name: 'Default',
        slug: 'default',
        settings: { disabledSlideTypes: [DISABLED_TYPE] },
      },
    ],
    users: userRows(OWNER),
    custom_slide_types: [customTypeRow()],
    presentations: [
      {
        id: DECK,
        organization_id: ORG,
        title: 'Partners',
        owner_email: OWNER,
        created_by: OWNER,
        updated_by: OWNER,
        owner_user_id: userIdFor(OWNER),
        created_by_user_id: userIdFor(OWNER),
        updated_by_user_id: userIdFor(OWNER),
        visibility: 'private',
        theme: 'default',
        lang: 'en',
        revision: 1,
        is_view_only: false,
        slides: ['s1', 's2'].map((id) => ({
          id,
          type: 'content-slide',
          content: { title: `Slide ${id}`, body: 'The partners we work with' },
        })),
        i18n: null,
        settings: {},
        created_at: '2026-02-01T00:00:00.000Z',
        modified_at: '2026-02-01T00:00:00.000Z',
        trashed_at: null,
      },
    ],
    presentation_collaborators: [],
    presentation_comments: [],
  });
  __setTestDb(db);
}

/**
 * The model's answer: one suggestion proposing the org type, one proposing
 * the type the org turned off.
 */
const ANSWER = {
  suggestions: [
    {
      slideId: 's1',
      slideIndex: 0,
      category: 'slide-type',
      body: 'Show the partners as a partner wall.',
      proposedSlide: { type: CUSTOM_TYPE, content: { title: 'Our partners' } },
    },
    {
      slideId: 's2',
      slideIndex: 1,
      category: 'slide-type',
      body: 'Show the steps as a funnel.',
      proposedSlide: {
        type: DISABLED_TYPE,
        content: { title: 'Steps', stages: [] },
      },
    },
  ],
};

/**
 * Answer every model call with `ANSWER`. Returns the request bodies the
 * model was sent.
 * @param {import('node:test').TestContext} t
 * @returns {string[]}
 */
function stubModel(t) {
  const saved = globalThis.fetch;
  const prompts = [];
  globalThis.fetch = async (url, init) => {
    prompts.push(String(init?.body ?? ''));
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
  return prompts;
}

/** A response double that behaves like an SSE `ServerResponse`. */
function makeSseRes() {
  const res = new EventEmitter();
  res.writable = true;
  res.writableEnded = false;
  res.writableFinished = false;
  res.chunks = [];
  res.writeHead = (status) => {
    res.statusCode = status;
  };
  res.flushHeaders = () => {};
  res.write = (chunk) => {
    res.chunks.push(String(chunk));
    return true;
  };
  res.end = () => {
    res.writableEnded = true;
    res.writable = false;
  };
  return res;
}

const AUTHED = { id: userIdFor(OWNER), email: OWNER, organizationId: ORG };

/** Run the REST route against a fresh SSE response double. */
function analyzeViaRoute() {
  const res = makeSseRes();
  const req = {
    method: 'POST',
    headers: { host: 'decks.example.test' },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {},
  };
  return handlePresentationAnalyze(
    {
      storageScope: createStorageScope(AUTHED, { repoRoot: process.cwd() }),
      req,
      res,
      authedUser: AUTHED,
    },
    DECK,
  ).then(() => res);
}

/** An MCP server with every tool registered, for the owner's session. */
function mcp() {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  const session = { ownerEmail: OWNER, organizationId: ORG };
  return (name, args) => server.tools.get(name).handler(args, session);
}

/** The prompt names the org type and not the type the org turned off. */
function assertOffer(prompts, label) {
  assert.equal(prompts.length, 1, `${label}: one model call`);
  assert.ok(
    prompts[0].includes(CUSTOM_TYPE),
    `${label}: the prompt offers ${CUSTOM_TYPE}`,
  );
  assert.ok(
    !prompts[0].includes(DISABLED_TYPE),
    `${label}: the prompt still names ${DISABLED_TYPE}`,
  );
}

test('the analyze route offers the org type and stores it as a proposal', async (t) => {
  setup();
  const prompts = stubModel(t);
  const res = await analyzeViaRoute();
  assert.match(res.chunks.join(''), /^event: complete$/m, res.chunks.join(''));
  assertOffer(prompts, 'route');

  // The store keeps the proposal as a JSON column
  const proposed = (db.__tables.presentation_comments || []).map((c) => {
    const raw = c.proposed_slide;
    const slide = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return slide?.type ?? null;
  });
  assert.ok(
    proposed.includes(CUSTOM_TYPE),
    `stored proposals: ${JSON.stringify(proposed)}`,
  );
  assert.ok(
    !proposed.includes(DISABLED_TYPE),
    `a type the org turned off is stored as a proposal: ${JSON.stringify(proposed)}`,
  );
});

test('MCP analyze_presentation offers the org type and returns it as a proposal', async (t) => {
  setup();
  const prompts = stubModel(t);
  const result = await mcp()('analyze_presentation', { presentationId: DECK });
  assertOffer(prompts, 'MCP');

  const proposed = result.suggestions.map((s) => s.proposedSlide?.type ?? null);
  assert.ok(
    proposed.includes(CUSTOM_TYPE),
    `returned proposals: ${JSON.stringify(proposed)}`,
  );
  assert.ok(
    !proposed.includes(DISABLED_TYPE),
    `a type the org turned off is returned as a proposal: ${JSON.stringify(proposed)}`,
  );
});
