/**
 * The wizard stream, MCP `create_presentation`, the file import and the
 * Notion import generate the same deck (B756, B757).
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
 *     `subheading`, a content slide the `notes` phase 2 wrote;
 *   - the stored content slide keeps the review metadata (`_aiReasoning`,
 *     `_aiAlternatives`) the editor's review grid reads.
 *
 * The file and Notion imports ran a chain of their own (until B757): no theme
 * context, a hard `title-slide`, the notes and the review alternatives of
 * phase 2 dropped; and only the wizard re-attached the review metadata, so a
 * deck made through MCP never carried it. Now all four run
 * `generateSlides()` and store through `generatedDeckToParts()`.
 *
 * Against the in-memory database double with the model (and the Notion API)
 * as `globalThis.fetch`, as in `tests/ai-paths-org-registry.test.js`; no
 * network.
 *
 * Run with: node --test tests/ai-generation-paths-behaviour.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { isAiReviewCurrent } from '../shared/ai-review.js';

import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { brandSeedRow } from './helpers/theme-seed.js';
import { createMockReq, createMockRes } from './helpers/http-mocks.js';
import {
  NOTION_PAGE_ID,
  isNotionRequest,
  minimalPptxDataUrl,
  notionPageResponse,
} from './helpers/import-sources.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.SANDBOX_MODE;
process.env.LLM_VENDOR = 'openai';
process.env.OPENAI_API = 'test-key';
process.env.OPENAI_MODEL = 'test-model';
process.env.NOTION_SECRET = 'test-notion-secret';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const SUBTITLE = 'Who we build with';
const NOTES = 'Name the three partners and why each one matters.';
const REASONING = 'Three short points read best as one content slide.';
const ALTERNATIVE = 'list-slide';
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
const convertRoutes = await import('../server/routes/api/convert.js');
const { handleNotionImportStream } =
  await import('../server/routes/api/notion/import.js');

const handleConvertStream = convertRoutes.ROUTES.find(
  (r) => r.pattern === '/api/convert/stream',
).handler;

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
  sections: [
    {
      heading: 'Partners',
      keyPoints: ['The partners we work with'],
      excerpt: 'The partners we work with',
    },
  ],
  slides: [
    {
      intent: 'content',
      section: 0,
      roughContent: 'The partners we work with',
      type: 'content-slide',
      content: { title: 'Our partners', body: 'Three partners.' },
      presenterNotes: NOTES,
      reasoning: REASONING,
      alternativeType: ALTERNATIVE,
      alternativeReason: 'Each partner as its own item.',
    },
  ],
};

/**
 * Answer every model call with {@link ANSWER}, and the Notion API with a page
 * about partners; returns the model request bodies.
 * @param {import('node:test').TestContext} t
 * @returns {string[]}
 */
function stubModel(t) {
  const saved = globalThis.fetch;
  const prompts = [];
  globalThis.fetch = async (url, init) => {
    if (isNotionRequest(url)) {
      return notionPageResponse(String(url), {
        title: 'Partners',
        text: 'The partners we work with',
      });
    }
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
 * @param {{ titleSlide?: boolean }} [opts] - `false` for a source that opens
 *   with its own title slide, so the deck gets no automatic one.
 */
function assertOnePipeline(prompts, label, { titleSlide = true } = {}) {
  const phase2 = prompts.filter((body) => body.includes(PHASE2_MARKER));
  assert.ok(phase2.length > 0, `${label}: no phase 2 call`);
  for (const body of phase2) {
    assert.match(body, /Brand accent colors: #/, `${label}: phase 2 prompt`);
  }

  const deck = storedDeck();
  assert.equal(deck.lang, 'en-GB', `${label}: deck lang`);
  const rest = titleSlide ? deck.slides.slice(1) : deck.slides;
  if (titleSlide) {
    const [title] = deck.slides;
    assert.equal(title.content.subheading, SUBTITLE, `${label}: subheading`);
  }
  const content = rest.find((slide) => slide.notes === NOTES);
  assert.ok(
    content,
    `${label}: presenter notes on a content slide: ${JSON.stringify(rest)}`,
  );
  assert.equal(content._aiReasoning, REASONING, `${label}: _aiReasoning`);
  assert.equal(
    content._aiReview.sourceExcerpt,
    'The partners we work with',
    `${label}: verified source survives storage`,
  );
  assert.equal(
    isAiReviewCurrent(content),
    true,
    `${label}: saved content matches its explanation`,
  );
  assert.ok(
    deck.slides.every(isAiReviewCurrent),
    `${label}: title and content bindings survive normalization ${JSON.stringify(deck.slides.filter((s) => !isAiReviewCurrent(s)))}`,
  );
  assert.deepEqual(
    content._aiAlternatives?.map((alt) => alt.type),
    [ALTERNATIVE],
    `${label}: _aiAlternatives`,
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

test('the file import runs the one pipeline, notes and review metadata kept', async (t) => {
  await setup();
  const prompts = stubModel(t);
  const res = sseResponse();
  await handleConvertStream({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(AUTHED, { repoRoot: process.cwd() }),
    req: createMockReq({
      method: 'POST',
      body: {
        dataUrl: await minimalPptxDataUrl('The partners we work with'),
        filename: 'deck.pptx',
        lang: 'en',
        theme: brandThemeId,
      },
    }),
    res,
    authedUser: AUTHED,
  });
  const out = res.chunks.join('');
  assert.match(out, /^event: complete$/m, out);
  // The one-line source slide reads as the deck's own title slide, so the
  // import adds no automatic one.
  assertOnePipeline(prompts, 'file', { titleSlide: false });
});

test('the Notion import runs the one pipeline', async (t) => {
  await setup();
  const prompts = stubModel(t);
  const res = sseResponse();
  await handleNotionImportStream({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(AUTHED, { repoRoot: process.cwd() }),
    req: createMockReq({
      method: 'POST',
      body: { url: NOTION_PAGE_ID, lang: 'en', theme: brandThemeId },
    }),
    res,
    authedUser: AUTHED,
  });
  const out = res.chunks.join('');
  assert.match(out, /^event: complete$/m, out);
  assertOnePipeline(prompts, 'Notion');
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
