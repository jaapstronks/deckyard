/**
 * The AI generation paths read the organization's type map (B247).
 *
 * The catalog the model reads offers an organization's published types
 * (`loadSlideTypeOffer` → `customSlideTypes`), but the paths behind it fixed
 * and refined the answer against the process-wide `SLIDE_TYPES`, which cannot
 * hold a DB row. Two losses followed:
 *
 * - Phase 2 (`refine-slides.js`) allowed only core types for a content slide,
 *   so an org type the model chose on the wizard stream came back as the
 *   intent's fallback type.
 * - The fix pipeline found no definition for the org type, so its own
 *   `maxLength` was never applied: overlong text the declaration refuses went
 *   through append-slides, refine-section and iterate.
 *
 * The paths that did not offer the org's types at all (B659): MCP
 * `create_presentation`, `iterate_presentation` and `append_slides`,
 * `/api/convert` and the Notion import gave the model only the core catalog,
 * so phase 2 refused an org type there even though the fix pipeline knew it.
 * Every path now loads the one offer, `loadSlideTypeOffer()`.
 *
 * Each path is driven end to end here against the in-memory database double,
 * with the model as `globalThis.fetch` (as in
 * `tests/creation-routes-configured-map.test.js`); no network.
 *
 * Run with: node --test tests/ai-paths-org-registry.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';

import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { brandSeedRow } from './helpers/theme-seed.js';
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
/** The key the builder publishes the type under. */
const CUSTOM_TYPE = 'custom-partner-wall';
/** The type's own `maxLength` on `title`; core types allow far more. */
const TITLE_CAP = 12;
const SHORT = 'Our partners';
const LONG = 'A partner wall title far past the cap';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { handleAiWizardV2Stream } =
  await import('../server/routes/api/ai/wizard-v2-stream.js');
const { handleAiAppendSlides } =
  await import('../server/routes/api/ai/append-slides.js');
const { handleAiRefineSection } =
  await import('../server/routes/api/ai/refine-section.js');
const { handleAiIterate } = await import('../server/routes/api/ai/iterate.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');
const { loadSlideTypeOffer } =
  await import('../server/utils/org-slide-types.js');
const convertRoutes = await import('../server/routes/api/convert.js');
const { handleNotionImport } =
  await import('../server/routes/api/notion/import.js');

const handleConvertFile = convertRoutes.ROUTES.find(
  (r) => r.pattern === '/api/convert',
).handler;
const { SlideTextLengthError } =
  await import('../server/utils/ai/validate-slides/index.js');

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default' }] }));
  await initializeStorage();
});

test.after(() => {
  __setTestDb(null);
});

/** One published type with a single capped `title` field. */
function customTypeRow() {
  return {
    id: 'cst-partner-wall',
    organization_id: ORG,
    slug: 'partner-wall',
    label: 'Partner wall',
    base_type: null,
    fields: [
      { key: 'title', type: 'string', label: 'Titel', maxLength: TITLE_CAP },
    ],
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

async function setup() {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER),
    themes: [await brandSeedRow()],
    custom_slide_types: [customTypeRow()],
    presentations: [],
  });
  __setTestDb(db);
}

/**
 * One answer for every model call. The outline phases read `intent` and
 * `roughContent`, the refinement, append and refine-section read `type` and
 * `content` off `slides[]`; one slide object carries both.
 * @param {string} title
 */
function deckAnswer(title) {
  return {
    title: 'Partners',
    rationale: 'test',
    slides: [
      {
        intent: 'content',
        roughContent: 'The partners we work with',
        type: CUSTOM_TYPE,
        content: { title },
      },
    ],
  };
}

/**
 * Answer every model call with `answer`, and the Notion API with a page about
 * partners. Returns the request bodies the model was sent.
 * @param {import('node:test').TestContext} t
 * @param {object} answer
 * @returns {string[]}
 */
function stubModel(t, answer) {
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
        choices: [{ message: { content: JSON.stringify(answer) } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  t.after(() => {
    globalThis.fetch = saved;
  });
  return prompts;
}

function makeRes() {
  const res = new EventEmitter();
  res.writable = true;
  res.writableEnded = false;
  res.writableFinished = false;
  res.statusCode = null;
  res.body = null;
  res.chunks = [];
  res.setHeader = () => {};
  res.flushHeaders = () => {};
  res.writeHead = (status) => {
    res.statusCode = status;
  };
  res.write = (chunk) => {
    res.chunks.push(String(chunk));
    return true;
  };
  res.end = (payload) => {
    if (payload) {
      try {
        res.body = JSON.parse(String(payload));
      } catch {
        res.chunks.push(String(payload));
      }
    }
    res.writableEnded = true;
    res.writableFinished = true;
    res.writable = false;
  };
  return res;
}

function makeReq(body) {
  const raw = JSON.stringify(body);
  return {
    method: 'POST',
    headers: { host: 'decks.example.test' },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(raw, 'utf8');
    },
  };
}

const AUTHED = { id: userIdFor(OWNER), email: OWNER, organizationId: ORG };

/** @param {object} body */
function ctx(body) {
  return {
    repoRoot: process.cwd(),
    storageScope: createStorageScope(AUTHED, { repoRoot: process.cwd() }),
    req: makeReq(body),
    res: makeRes(),
    authedUser: AUTHED,
  };
}

/** The slide types of every stored deck. */
function storedTypes() {
  return (db.__tables.presentations || []).flatMap((p) =>
    (p.slides || []).map((s) => s.type),
  );
}

/** A deck the editor routes revise or append to. */
function existingDeck() {
  return {
    id: 'deck-1',
    title: 'Partners',
    lang: 'en',
    slides: [
      { id: 's1', type: 'title-slide', content: { title: 'Partners' } },
      { id: 's2', type: 'content-slide', content: { title: 'Old', body: '' } },
    ],
  };
}

// ── composing paths: the org type survives Phase 2 ─────────────────────────

test('the wizard stream keeps the org type the model chose', async (t) => {
  await setup();
  stubModel(t, deckAnswer(SHORT));
  const c = ctx({
    raw: 'The partners we work with',
    lang: 'en',
  });
  await handleAiWizardV2Stream(c);
  assert.ok(
    storedTypes().includes(CUSTOM_TYPE),
    `stored types: ${storedTypes().join(', ')}\n${c.res.chunks.join('')}`,
  );
});

test('the wizard stream holds the org type to its own cap', async (t) => {
  await setup();
  stubModel(t, deckAnswer(LONG));
  const c = ctx({
    raw: 'The partners we work with',
    lang: 'en',
  });
  await handleAiWizardV2Stream(c);
  const stored = (db.__tables.presentations || []).flatMap((p) => p.slides);
  assert.ok(
    !stored.some((slide) => slide?.content?.title === LONG),
    'text past the org type cap is not stored, under any type',
  );
  // The stream ends in the SSE error event, naming the type and its cap, as a
  // core type past its cap does; the handler catches, so nothing rejects.
  const out = c.res.chunks.join('');
  assert.match(out, /^event: error$/m, out);
  assert.match(out, new RegExp(`${CUSTOM_TYPE}.*> ${TITLE_CAP}`), out);
});

// ── fixing paths: the org type's own declaration applies ───────────────────

test('append-slides returns the org type within its cap', async (t) => {
  await setup();
  stubModel(t, deckAnswer(SHORT));
  const c = ctx({ raw: 'Partners', lang: 'en', deck: existingDeck() });
  await handleAiAppendSlides(c);
  assert.equal(c.res.statusCode, 200, JSON.stringify(c.res.body));
  assert.deepEqual(
    c.res.body.slides.map((s) => s.type),
    [CUSTOM_TYPE],
  );
});

test('append-slides refuses text past the org type cap', async (t) => {
  await setup();
  stubModel(t, deckAnswer(LONG));
  await assert.rejects(
    handleAiAppendSlides(
      ctx({ raw: 'Partners', lang: 'en', deck: existingDeck() }),
    ),
    (err) =>
      err instanceof SlideTextLengthError &&
      new RegExp(`> ${TITLE_CAP}`).test(err.message),
  );
});

test('refine-section refuses text past the org type cap', async (t) => {
  await setup();
  stubModel(t, deckAnswer(LONG));
  const c = ctx({
    presentation: existingDeck(),
    slideIds: ['s2'],
    feedback: 'Make it a partner wall',
    lang: 'en',
  });
  await handleAiRefineSection(c);
  assert.notEqual(c.res.statusCode, 200, JSON.stringify(c.res.body));
});

test('refine-section returns the org type within its cap', async (t) => {
  await setup();
  stubModel(t, deckAnswer(SHORT));
  const c = ctx({
    presentation: existingDeck(),
    slideIds: ['s2'],
    feedback: 'Make it a partner wall',
    lang: 'en',
  });
  await handleAiRefineSection(c);
  assert.equal(c.res.statusCode, 200, JSON.stringify(c.res.body));
  assert.deepEqual(
    c.res.body.slides.map((s) => s.type),
    [CUSTOM_TYPE],
  );
});

test('iterate refuses text past the org type cap', async (t) => {
  await setup();
  stubModel(t, { type: CUSTOM_TYPE, content: { title: LONG } });
  const c = ctx({
    presentation: existingDeck(),
    command: 'make this punchier',
    currentSlideIndex: 1,
    lang: 'en',
  });
  await handleAiIterate(c);
  assert.notEqual(c.res.statusCode, 200, JSON.stringify(c.res.body));
});

// ── importing and MCP paths: the org type is offered at all (B659) ─────────

/** An MCP server with every tool registered, for the owner's session. */
function mcp() {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  const session = { ownerEmail: OWNER, organizationId: ORG };
  return (name, args) => server.tools.get(name).handler(args, session);
}

test('MCP stdio offers the default organization types', async () => {
  await setup();
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  const offer = await server.tools.get('get_slide_types').handler({});
  assert.ok(offer.types[CUSTOM_TYPE]);
  assert.equal(offer.types[CUSTOM_TYPE].label, 'Partner wall');
});

test('the offer loader refuses a missing organization scope', async () => {
  await assert.rejects(loadSlideTypeOffer({}), /no organizationId/);
});

for (const table of ['organizations', 'custom_slide_types']) {
  test(`the offer loader propagates ${table} lookup failures`, async (t) => {
    await setup();
    const failure = new Error(`${table} lookup failed`);
    const selectFrom = db.selectFrom;
    t.mock.method(db, 'selectFrom', (name) => {
      if (name === table) throw failure;
      return selectFrom(name);
    });
    await assert.rejects(
      loadSlideTypeOffer(createStorageScope({ organizationId: ORG })),
      failure,
    );
  });
}

test('MCP create_presentation keeps the org type the model chose', async (t) => {
  await setup();
  stubModel(t, deckAnswer(SHORT));
  await mcp()('create_presentation', {
    content: 'The partners we work with',
    lang: 'en',
  });
  assert.ok(
    storedTypes().includes(CUSTOM_TYPE),
    `stored types: ${storedTypes().join(', ')}`,
  );
});

test('the convert route keeps the org type the model chose', async (t) => {
  await setup();
  stubModel(t, deckAnswer(SHORT));
  const c = ctx({
    dataUrl: await minimalPptxDataUrl('The partners we work with'),
    filename: 'deck.pptx',
    lang: 'en',
  });
  await handleConvertFile(c);
  assert.equal(c.res.statusCode, 201, JSON.stringify(c.res.body));
  assert.ok(
    storedTypes().includes(CUSTOM_TYPE),
    `stored types: ${storedTypes().join(', ')}`,
  );
});

test('the Notion import keeps the org type the model chose', async (t) => {
  await setup();
  stubModel(t, deckAnswer(SHORT));
  const c = ctx({ url: NOTION_PAGE_ID, lang: 'en' });
  await handleNotionImport(c);
  assert.equal(c.res.statusCode, 201, JSON.stringify(c.res.body));
  assert.ok(
    storedTypes().includes(CUSTOM_TYPE),
    `stored types: ${storedTypes().join(', ')}`,
  );
});

// ── session logs: one instance setting, no switch per route (B661) ─────────

/** What the instance has written under `server/logs/ai/` so far. */
function sessionLogFiles() {
  const dir = new URL('../server/logs/ai/', import.meta.url);
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

test('convert and the Notion import write no session log with AI_SESSION_LOGS off', async (t) => {
  const previous = process.env.AI_SESSION_LOGS;
  process.env.AI_SESSION_LOGS = 'false';
  t.after(() => {
    if (previous === undefined) delete process.env.AI_SESSION_LOGS;
    else process.env.AI_SESSION_LOGS = previous;
  });
  const before = sessionLogFiles();

  await setup();
  stubModel(t, deckAnswer(SHORT));
  const convert = ctx({
    dataUrl: await minimalPptxDataUrl('The partners we work with'),
    filename: 'deck.pptx',
    lang: 'en',
  });
  await handleConvertFile(convert);
  assert.equal(convert.res.statusCode, 201, JSON.stringify(convert.res.body));

  const notion = ctx({ url: NOTION_PAGE_ID, lang: 'en' });
  await handleNotionImport(notion);
  assert.equal(notion.res.statusCode, 201, JSON.stringify(notion.res.body));

  assert.deepEqual(sessionLogFiles(), before);
});

test('MCP iterate_presentation and append_slides offer the org type', async (t) => {
  await setup();
  stubModel(t, deckAnswer(SHORT));
  const call = mcp();
  const { id } = await call('create_presentation', {
    content: 'The partners we work with',
    lang: 'en',
  });

  // Iterate reads a modification plan off the answer and finds none, so only
  // its offer is pinned; append reads `slides[]` and stores the org type.
  for (const [name, args] of [
    ['iterate_presentation', { presentationId: id, command: 'Add partners' }],
    ['append_slides', { presentationId: id, content: 'More partners' }],
  ]) {
    const prompts = stubModel(t, deckAnswer(SHORT));
    await call(name, args);
    assert.ok(prompts.length > 0, `${name} sent the model nothing`);
    assert.ok(
      prompts.every((body) => body.includes(CUSTOM_TYPE)),
      `${name} did not offer ${CUSTOM_TYPE}`,
    );
  }
  assert.deepEqual(
    storedTypes().filter((type) => type === CUSTOM_TYPE),
    [CUSTOM_TYPE, CUSTOM_TYPE],
    `stored types: ${storedTypes().join(', ')}`,
  );
});
