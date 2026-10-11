/**
 * Every route that composes slides composes them from the organization's map
 * (B655).
 *
 * A type could take a default from the installation (`configDefaults`, folded
 * in by `buildMergedSlideTypes()`; B653), but the import seam
 * `deckToPresentationParts()` fell back to the module-wide `SLIDE_TYPES` and
 * twelve of its callers never handed it the map, so an AI-generated or
 * imported deck came out without the configured value. The seams now take
 * `slideTypes` as a required argument; these tests drive three of those
 * routes end to end and read the value off the stored deck.
 *
 * The observable is `video-slide`'s `bunnyLibraryId`, the one configured
 * default core declares: with `BUNNY_LIBRARY_ID` set, a video slide the model
 * returns without a library must be stored with this installation's. The
 * model is `globalThis.fetch`, as in `tests/post-cancel.test.js`; no network.
 *
 * Run with: node --test tests/creation-routes-configured-map.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

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
const LIBRARY = '424242';
const VIDEO = '0f0e0d0c-0b0a-4908-8706-050403020100';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');
const convertRoutes = await import('../server/routes/api/convert.js');
const { handleNotionImport } =
  await import('../server/routes/api/notion/import.js');

const handleConvertFile = convertRoutes.ROUTES.find(
  (r) => r.pattern === '/api/convert',
).handler;

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

/** A fresh database and this installation's Bunny library, for one test. */
async function setup(t) {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER),
    themes: [await brandSeedRow()],
    custom_slide_types: [],
    presentations: [],
  });
  __setTestDb(db);
  const saved = process.env.BUNNY_LIBRARY_ID;
  process.env.BUNNY_LIBRARY_ID = LIBRARY;
  t.after(() => {
    if (saved === undefined) delete process.env.BUNNY_LIBRARY_ID;
    else process.env.BUNNY_LIBRARY_ID = saved;
  });
}

/**
 * One answer for every model call. The outline phases read `intent` and
 * `roughContent`, the refinement reads `type` and `content`; one slide object
 * carries both, so each phase finds what it parses.
 */
const ANSWER = JSON.stringify({
  title: 'Tide pools',
  slides: [
    {
      intent: 'content',
      roughContent: 'A short film about anemones',
      type: 'video-slide',
      content: { title: 'Anemones', source: VIDEO },
    },
  ],
});

/** Swap the global fetch for one test: the model, and Notion if asked. */
function stubFetch(t, { notion = false } = {}) {
  const saved = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (notion && isNotionRequest(url)) {
      return notionPageResponse(String(url), {
        title: 'Tide pools',
        text: 'A short film about anemones',
      });
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: ANSWER } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  t.after(() => {
    globalThis.fetch = saved;
  });
}

function makeJsonRes() {
  const res = new EventEmitter();
  res.writable = true;
  res.writableEnded = false;
  res.writableFinished = false;
  res.statusCode = null;
  res.body = null;
  res.setHeader = () => {};
  res.writeHead = (status) => {
    res.statusCode = status;
  };
  res.end = (payload) => {
    res.body = payload ? JSON.parse(String(payload)) : null;
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

function scope() {
  return createStorageScope(AUTHED, { repoRoot: process.cwd() });
}

/** The video slides of every stored deck, in every language version. */
function storedVideoSlides() {
  return (db.__tables.presentations || []).flatMap((p) =>
    (p.slides || []).filter((s) => s.type === 'video-slide'),
  );
}

function assertConfiguredLibrary(route) {
  const videos = storedVideoSlides();
  assert.ok(videos.length > 0, `${route} stored no video slide`);
  for (const slide of videos) {
    assert.equal(
      slide.content.bunnyLibraryId,
      LIBRARY,
      `${route} composed its video slide without the configured library`,
    );
  }
}

test('MCP create_presentation composes from the configured map', async (t) => {
  await setup(t);
  stubFetch(t);
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  await server.tools
    .get('create_presentation')
    .handler(
      { content: 'A short film about anemones', lang: 'en' },
      { ownerEmail: OWNER, organizationId: ORG },
    );
  assertConfiguredLibrary('create_presentation');
});

test('the convert route composes from the configured map', async (t) => {
  await setup(t);
  stubFetch(t);
  const dataUrl = await minimalPptxDataUrl('A short film about anemones');
  const res = makeJsonRes();
  await handleConvertFile({
    repoRoot: process.cwd(),
    storageScope: scope(),
    req: makeReq({ dataUrl, filename: 'deck.pptx', lang: 'en' }),
    res,
    authedUser: AUTHED,
  });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assertConfiguredLibrary('/api/convert');
});

test('the Notion import composes from the configured map', async (t) => {
  await setup(t);
  stubFetch(t, { notion: true });
  const res = makeJsonRes();
  await handleNotionImport({
    repoRoot: process.cwd(),
    storageScope: scope(),
    req: makeReq({ url: NOTION_PAGE_ID, lang: 'en' }),
    res,
    authedUser: AUTHED,
  });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assertConfiguredLibrary('/api/notion/import');
});
