/**
 * B609: one deck create that carries its content, on every contract.
 *
 * The internal AI wizards (`createDeckFromParts` in `routes/api/ai/shared.js`),
 * the public v1 AI wizard and MCP's `create_presentation` /
 * `create_presentation_from_slides` used to create an empty deck and then
 * write the generated slides into it with a second storage call, building the
 * i18n block by hand in between; MCP ran the write seam once more up front so
 * a refused payload would not leave the empty deck behind. Now every one of
 * them hands `createPresentation` the slides and the factory does the rest
 * (the language version, fresh ids, the instance keys, the write seam): one
 * insert, no update, and a storage refusal is the service's 409, not a 201
 * with no id (v1) or a bare `Error` (MCP) (A7.4, D252–D256).
 *
 * The LLM is the one way out of the generating contracts, so the provider's
 * `fetch` is swapped for a double that answers one JSON object every parser
 * in the chain accepts (the one-shot deck parser reads `type`/`content`, the
 * two-phase outline parser reads `intent`/`roughContent`, and an unparseable
 * refinement falls back to deterministic slides), following
 * tests/post-cancel.test.js. Handler-import level against the database double,
 * like tests/service-layer-b608.test.js.
 *
 * Run with: node --test tests/service-layer-b609.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { brandSeedRow } from './helpers/theme-seed.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b609']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
process.env.APP_URL = 'https://deck.example';
process.env.LLM_VENDOR = 'openai';
process.env.OPENAI_API = 'test-key';
process.env.OPENAI_MODEL = 'test-model';
delete process.env.SANDBOX_MODE;
delete process.env.AI_ENABLED;
delete process.env.DISABLE_AI;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER_EMAIL = 'owner@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { handleAiWizard } = await import('../server/routes/api/ai/wizard.js');
const { createDeckFromParts } =
  await import('../server/routes/api/ai/shared.js');
const { handleAi: handleV1Ai } =
  await import('../server/routes/public-api/v1/ai.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');

const OWNER = {
  id: userIdFor(OWNER_EMAIL),
  email: OWNER_EMAIL,
  name: 'owner',
  role: 'user',
  organizationId: ORG,
};

// --- The store ----------------------------------------------------------------

async function installDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER_EMAIL),
    themes: [await brandSeedRow()],
    custom_slide_types: [],
    presentations: [],
    activity_events: [],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

const decks = (db) => db.__tables.presentations;

/** The presentation writes since `from` in the query log, by kind. */
function presentationWrites(db, from = 0) {
  const writes = db.__queryLog
    .slice(from)
    .filter((q) => q.table === 'presentations' && q.op !== 'select');
  return {
    inserts: writes.filter((q) => q.op === 'insert').length,
    updates: writes.filter((q) => q.op === 'update').length,
  };
}

/** One insert and no update: the deck was written once, content and all. */
function assertOneWrite(db, from, where) {
  assert.deepEqual(
    presentationWrites(db, from),
    { inserts: 1, updates: 0 },
    `${where}: one create carries the content`,
  );
}

const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value),
  );

// --- The model ----------------------------------------------------------------

/**
 * One answer every parser in the chain accepts: the one-shot deck parser
 * reads `type` and `content`, the two-phase outline parser `intent` and
 * `roughContent`; the rest is ignored by whichever reads it.
 */
const MODEL_ANSWER = JSON.stringify({
  format: 'deckyard.deck',
  version: 1,
  title: 'Tide pools',
  theme: 'default',
  slides: [
    {
      type: 'title-slide',
      content: { title: 'Tide pools', subheading: 'Who lives there' },
      intent: 'content',
      roughContent: 'Tide pools and who lives there',
    },
    {
      type: 'content-slide',
      content: { title: 'Anemones', body: '- They sting\n- They wait' },
      intent: 'content',
      roughContent: 'Anemones and their neighbours',
    },
  ],
});

/** Swap the provider's `fetch` for a double for one test; counts the calls. */
function stubModel(t) {
  const saved = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, opts = {}) => {
    calls.push(opts);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: MODEL_ANSWER } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  t.after(() => {
    globalThis.fetch = saved;
  });
  return calls;
}

// --- The contracts ------------------------------------------------------------

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

function makeReq(body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'POST';
  req.headers = { host: 'deck.example', 'content-type': 'application/json' };
  req.socket = { remoteAddress: '203.0.113.9' };
  return req;
}

/** The internal one-shot wizard, as the session user. */
async function internalWizard(body) {
  const res = makeRes();
  await handleAiWizard({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(OWNER, { repoRoot: process.cwd() }),
    req: makeReq(body),
    res,
    url: new URL('http://deck.example/api/ai/wizard'),
    authedUser: OWNER,
  });
  return res;
}

/** The v1 wizard with the owner's AI-capable key already authenticated. */
async function v1Wizard(body) {
  const res = makeRes();
  await handleV1Ai({
    req: makeReq(body),
    res,
    url: new URL('http://deck.example/api/v1/ai/wizard'),
    repoRoot: process.cwd(),
    storageScope: {
      repoRoot: process.cwd(),
      organizationId: ORG,
      actorUserId: OWNER.id,
      actorEmail: OWNER_EMAIL,
    },
    apiKey: {
      id: 'key-1',
      name: 'Test key',
      tier: 'free',
      ownerEmail: OWNER_EMAIL,
      permissions: ['read', 'write', 'ai'],
      organizationId: ORG,
    },
    authedUser: OWNER,
  });
  return res;
}

/** An MCP tool, called the way an SSE session calls it. */
function mcpTool(name) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER_EMAIL });
  const tool = server.tools.get(name);
  assert.ok(tool, `${name} is not registered`);
  return (args) =>
    tool.handler(args, { ownerEmail: OWNER_EMAIL, organizationId: ORG });
}

const FROM_SLIDES = {
  title: 'Van een agent',
  lang: 'nl',
  slides: [
    { type: 'title-slide', content: { title: 'Hoi' }, notes: 'Welkom' },
    { type: 'content-slide', content: { title: 'Twee', body: 'Tekst' } },
  ],
};

/** Run `fn` with the hard slide limit at `limit`. */
async function withSlideLimit(limit, fn) {
  const previous = process.env.PRESENTATION_HARD_SLIDE_LIMIT;
  process.env.PRESENTATION_HARD_SLIDE_LIMIT = String(limit);
  try {
    return await fn();
  } finally {
    if (previous === undefined)
      delete process.env.PRESENTATION_HARD_SLIDE_LIMIT;
    else process.env.PRESENTATION_HARD_SLIDE_LIMIT = previous;
  }
}

// =============================================================================
// MCP create_presentation_from_slides: the agent's payload lands in one write
// =============================================================================

test('MCP from_slides: one insert, no update; slides, notes and the language version land under fresh ids', async () => {
  const db = await installDb();
  const from = db.__queryLog.length;

  const result = await mcpTool('create_presentation_from_slides')(FROM_SLIDES);
  assertOneWrite(db, from, 'MCP from_slides');

  assert.equal(result.slideCount, 2);
  const [row] = decks(db);
  assert.equal(row.id, result.id);
  assert.equal(row.owner_email, OWNER_EMAIL, 'the deck is the session owner’s');
  assert.deepEqual(
    row.slides.map((s) => [s.type, s.content.title, s.notes]),
    [
      ['title-slide', 'Hoi', 'Welkom'],
      ['content-slide', 'Twee', ''],
    ],
  );
  assert.ok(
    row.slides.every((s) => isUuid(s.id)),
    'fresh slide ids',
  );
  assert.deepEqual(
    row.i18n.versions.nl.slides.map((s) => s.id),
    row.slides.map((s) => s.id),
    'the nl version holds the same slides',
  );
  assert.equal(row.i18n.versions.nl.title, 'Van een agent');
  assert.equal(row.lang, 'nl');
});

test('MCP from_slides: a follow-invite slide carries the new deck’s id (re-keyed in the create)', async () => {
  const db = await installDb();
  const result = await mcpTool('create_presentation_from_slides')({
    ...FROM_SLIDES,
    slides: [
      { type: 'title-slide', content: { title: 'Hoi' } },
      { type: 'follow-invite-slide', content: {} },
    ],
  });
  const [row] = decks(db);
  const invite = row.slides.find((s) => s.type === 'follow-invite-slide');
  assert.ok(invite, 'the invite slide is stored');
  assert.equal(invite.content.presentationId, result.id);
});

test('MCP from_slides: a deck over the size limit is a 409 limit_exceeded and nothing is written', async () => {
  const db = await installDb();
  await withSlideLimit(1, () =>
    assert.rejects(
      () => mcpTool('create_presentation_from_slides')(FROM_SLIDES),
      (err) => {
        // It used to be a bare `Error('updatePresentation failed: …')` with
        // the empty deck left behind.
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'limit_exceeded');
        return true;
      },
    ),
  );
  assert.equal(decks(db).length, 0, 'no empty deck is left behind');
});

// =============================================================================
// The generating contracts: the model's deck lands in one write
// =============================================================================

test('v1 wizard: one insert, no update; 201 with the generated deck, owned by the key owner', async (t) => {
  const db = await installDb();
  const calls = stubModel(t);
  const from = db.__queryLog.length;

  const res = await v1Wizard({
    raw: 'A talk about tide pools.',
    lang: 'en-GB',
  });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(calls.length, 1, 'one model call');
  assertOneWrite(db, from, 'v1 wizard');

  const pres = res.body.data?.presentation ?? res.body.presentation;
  assert.equal(pres.slideCount, 2);
  assert.equal(pres.title, 'Tide pools');
  assert.equal(pres.lang, 'en-GB');
  assert.ok(pres.createdAt && pres.updatedAt, 'published timestamps');

  const [row] = decks(db);
  assert.equal(row.id, pres.id);
  assert.equal(row.owner_email, OWNER_EMAIL);
  assert.deepEqual(
    row.slides.map((s) => s.content.title),
    ['Tide pools', 'Anemones'],
  );
  assert.deepEqual(
    row.i18n.versions['en-GB'].slides.map((s) => s.id),
    row.slides.map((s) => s.id),
  );
});

test('v1 wizard: a generated deck over the size limit is a 409 limit_exceeded, not a 201 without an id', async (t) => {
  const db = await installDb();
  stubModel(t);
  const res = await withSlideLimit(1, () =>
    v1Wizard({ raw: 'A talk about tide pools.' }),
  );
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.error, 'limit_exceeded');
  assert.equal(decks(db).length, 0, 'no empty deck is left behind');
});

test('v1 wizard and MCP create_presentation: a refused body costs no model call', async (t) => {
  const db = await installDb();
  const calls = stubModel(t);

  const v1 = await v1Wizard({ raw: 'Tide pools.', lang: 'xx' });
  assert.equal(v1.statusCode, 400);
  assert.equal(v1.body.error, 'invalid');
  assert.equal(v1.body.details.field, 'lang');

  await assert.rejects(
    () =>
      mcpTool('create_presentation')({ content: 'Tide pools.', lang: 'xx' }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.details?.field, 'lang');
      return true;
    },
  );

  assert.equal(calls.length, 0, 'the model was called for a refused body');
  assert.equal(decks(db).length, 0);
});

test('MCP create_presentation: one insert, no update; the generated slides land', async (t) => {
  const db = await installDb();
  stubModel(t);
  const from = db.__queryLog.length;

  const result = await mcpTool('create_presentation')({
    content: 'A talk about tide pools and what lives in them.',
    lang: 'en-GB',
    title: 'Rock pools',
  });
  assertOneWrite(db, from, 'MCP create_presentation');

  const [row] = decks(db);
  assert.equal(row.id, result.id);
  assert.equal(row.title, 'Rock pools', 'the caller’s title wins');
  assert.equal(result.slideCount, row.slides.length);
  assert.ok(row.slides.length >= 1, 'the generated slides are stored');
  assert.equal(row.owner_email, OWNER_EMAIL);
  assert.deepEqual(
    result.slides.map((s) => s.index),
    row.slides.map((_s, i) => i),
  );
});

test('internal wizard: one insert, no update; 201 with the deck', async (t) => {
  const db = await installDb();
  stubModel(t);
  const from = db.__queryLog.length;

  const res = await internalWizard({ raw: 'A talk about tide pools.' });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assertOneWrite(db, from, 'internal wizard');

  const [row] = decks(db);
  assert.equal(row.id, res.body.id);
  assert.equal(res.body.slides.length, 2);
  assert.deepEqual(
    row.slides.map((s) => s.content.title),
    ['Tide pools', 'Anemones'],
  );
});

test('the two-phase wizard’s review metadata survives the create (the editor’s review grid reads it)', async () => {
  const db = await installDb();
  const parts = {
    title: 'Reviewed',
    slides: [
      {
        id: 'from-the-model',
        type: 'content-slide',
        content: { title: 'One', body: 'Body' },
        notes: '',
        _aiReasoning: 'A list of parallel points.',
        _aiAlternatives: ['icon-card-grid-slide'],
      },
    ],
  };
  const created = await createDeckFromParts(
    createStorageScope(OWNER, { repoRoot: process.cwd() }),
    { parts, lang: 'nl', authedUser: OWNER, theme: undefined },
  );
  const [row] = decks(db);
  assert.equal(row.id, created.id);
  const [slide] = row.slides;
  assert.notEqual(slide.id, 'from-the-model', 'the id is re-keyed');
  assert.equal(slide._aiReasoning, 'A list of parallel points.');
  assert.deepEqual(slide._aiAlternatives, ['icon-card-grid-slide']);
  assert.equal(created.slides[0]._aiReasoning, 'A list of parallel points.');
});
