/**
 * The wizard stream and MCP `create_presentation` generate the same deck
 * (B756).
 *
 * Both ran their own outline → refine chain, and each lost something: MCP
 * gave phase 2 no theme context, so the model never saw the brand colours;
 * the wizard wrote the title slide's subheading under `subtitle`, a key the
 * title slide does not declare, so it never landed, and passed the request
 * language to the create instead of the one the generation settled on. Both
 * now run `generateDeck()` (`server/utils/ai/generate-deck.js`); this drives
 * each end to end and checks what the one pipeline promises:
 *
 *   - every phase 2 prompt carries the theme's brand colours;
 *   - the stored deck has a language (`lang`), the title slide its
 *     `subheading`, a content slide the `notes` phase 2 wrote.
 *
 * Against the in-memory database double with the model as
 * `globalThis.fetch`, as in `tests/ai-paths-org-registry.test.js`; no network.
 * The file and Notion imports join next (B757).
 *
 * Run with: node --test tests/ai-generation-paths-behaviour.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

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
const SUBTITLE = 'Who we build with';
const NOTES = 'Name the three partners and why each one matters.';
/** Only the phase 2 system prompt has this header. */
const PHASE2_MARKER = 'PRESENTATION CONTEXT';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { handleAiWizardV2Stream } =
  await import('../server/routes/api/ai/wizard-v2-stream.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');

/** @type {ReturnType<typeof createFakeDb>} */
let db;
/** The brand seed's id, and its brand colours as the theme resolves them. */
let brandThemeId;

test.before(async () => {
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default' }] }));
  await initializeStorage();
});

test.after(() => {
  __setTestDb(null);
});

async function setup() {
  const brand = await brandSeedRow();
  brandThemeId = brand.id;
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER),
    themes: [brand],
    presentations: [],
  });
  __setTestDb(db);
}

/**
 * One answer for every model call: the outline steps read `title`,
 * `subtitle`, `intent` and `roughContent`, phase 2 reads `type`, `content`
 * and `presenterNotes` off `slides[]`.
 */
const ANSWER = {
  title: 'Partners',
  subtitle: SUBTITLE,
  summary: 'The partners we work with',
  rationale: 'test',
  slides: [
    {
      intent: 'content',
      roughContent: 'The partners we work with',
      type: 'content-slide',
      content: { title: 'Our partners', body: 'Three partners.' },
      presenterNotes: NOTES,
    },
  ],
};

/**
 * Answer every model call with {@link ANSWER}; returns the request bodies.
 * @param {import('node:test').TestContext} t
 * @returns {string[]}
 */
function stubModel(t) {
  const saved = globalThis.fetch;
  const prompts = [];
  globalThis.fetch = async (_url, init) => {
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

/**
 * The shared response double, made an event stream: it records what the
 * handler writes and emits `close` like a socket would.
 */
function sseResponse() {
  const res = Object.assign(new EventEmitter(), createMockRes(), {
    writable: true,
    writableEnded: false,
    writableFinished: false,
    chunks: [],
    flushHeaders() {},
    write(chunk) {
      this.chunks.push(String(chunk));
      return true;
    },
    end(payload) {
      if (payload) this.chunks.push(String(payload));
      this.writableEnded = true;
      this.writableFinished = true;
      this.writable = false;
      return this;
    },
  });
  return res;
}

const AUTHED = { id: userIdFor(OWNER), email: OWNER, organizationId: ORG };

/** The one stored deck. */
function storedDeck() {
  const decks = db.__tables.presentations || [];
  assert.equal(decks.length, 1, 'one deck stored');
  return decks[0];
}

/**
 * What every path must deliver.
 * @param {string[]} prompts
 * @param {string} label
 */
function assertOnePipeline(prompts, label) {
  const phase2 = prompts.filter((body) => body.includes(PHASE2_MARKER));
  assert.ok(phase2.length > 0, `${label}: no phase 2 call`);
  for (const body of phase2) {
    assert.match(body, /Brand accent colors: #/, `${label}: phase 2 prompt`);
  }

  const deck = storedDeck();
  assert.equal(deck.lang, 'en-GB', `${label}: deck lang`);
  const [title, ...rest] = deck.slides;
  assert.equal(title.content.subheading, SUBTITLE, `${label}: subheading`);
  assert.ok(
    rest.some((slide) => slide.notes === NOTES),
    `${label}: presenter notes on a content slide: ${JSON.stringify(rest)}`,
  );
}

test('the wizard stream runs the one pipeline', async (t) => {
  await setup();
  const prompts = stubModel(t);
  const res = sseResponse();
  await handleAiWizardV2Stream({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(AUTHED, { repoRoot: process.cwd() }),
    req: createMockReq({
      method: 'POST',
      body: {
        raw: 'The partners we work with',
        lang: 'en',
        theme: brandThemeId,
      },
    }),
    res,
    authedUser: AUTHED,
  });
  const out = res.chunks.join('');
  assert.match(out, /^event: complete$/m, out);
  // The outline status line reads the language off the hook, in the deck's
  // language (`en-GB` here), not off a rule of the route's own.
  assert.match(out, /Outline ready: \d+ slides in \d+ sections/, out);
  assert.doesNotMatch(out, /"budget"/, 'complete carries no budget');
  assertOnePipeline(prompts, 'wizard');
});

test('MCP create_presentation runs the one pipeline', async (t) => {
  await setup();
  const prompts = stubModel(t);
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  await server.tools
    .get('create_presentation')
    .handler(
      { content: 'The partners we work with', lang: 'en', theme: brandThemeId },
      { ownerEmail: OWNER, organizationId: ORG },
    );
  assertOnePipeline(prompts, 'MCP');
});

test('MCP create_presentation passes the caller signal to the model', async (t) => {
  await setup();
  stubModel(t);
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    server.tools
      .get('create_presentation')
      .handler(
        { content: 'The partners we work with', lang: 'en' },
        { ownerEmail: OWNER, organizationId: ORG, signal: controller.signal },
      ),
    (err) => err?.name === 'AbortError',
  );
  assert.equal((db.__tables.presentations || []).length, 0, 'no deck stored');
});
