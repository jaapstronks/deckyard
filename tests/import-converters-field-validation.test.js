/**
 * The converters write their slides through the shared field validation
 * (B694).
 *
 * The declared field rules stand in front of create and the JSON and
 * `.deck` imports (B693); the file converter (`/api/convert` and its stream), the
 * Notion import (and its stream) and the Markdown import still created an
 * empty deck and wrote their slides with a storage update afterwards, past
 * every check. All five now go through `createImportedPresentation`, which
 * validates before anything exists. Model output has been through the AI fix
 * pipeline inside the converter already, so what is still invalid is refused
 * with its slide and field, and no deck is left behind.
 *
 * The model is `globalThis.fetch`, as in `tests/creation-routes-configured-map.test.js`;
 * it answers a team-cards slide with a `javascript:` LinkedIn link, a value
 * the fix pipeline and `deckToPresentationParts` leave alone (an enum or a
 * wrong type they already normalize) and the editor refuses. Markdown is plain text: a heading longer than the
 * content-slide title allows.
 *
 * Run with: node --test tests/import-converters-field-validation.test.js
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

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const convertRoutes = await import('../server/routes/api/convert.js');
const { handleNotionImport, handleNotionImportStream } =
  await import('../server/routes/api/notion/import.js');
const { handlePresentationsImportMarkdown } =
  await import('../server/routes/api/presentations/import-markdown.js');
const { extractPageId } = await import('../server/utils/notion/index.js');

const routeHandler = (pattern) =>
  convertRoutes.ROUTES.find((r) => r.pattern === pattern).handler;
const handleConvertFile = routeHandler('/api/convert');
const handleConvertStream = routeHandler('/api/convert/stream');

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
    custom_slide_types: [],
    presentations: [],
  });
  __setTestDb(db);
}

const storedDecks = () => db.__tables.presentations || [];

/**
 * One answer for every model call, as in the configured-map test: the outline
 * reads `intent`/`roughContent`, the refinement `type`/`content`.
 */
function answer(linkedin) {
  return JSON.stringify({
    title: 'Tide pools',
    slides: [
      {
        intent: 'content',
        roughContent: 'The people who study tide pools',
        type: 'team-cards-slide',
        content: {
          title: 'Team',
          members: [
            { name: 'Ana', linkedin },
            { name: 'Bo', linkedin: 'https://example.test/bo' },
          ],
        },
      },
    ],
  });
}

/** Swap the global fetch for one test: the model, and Notion if asked. */
function stubFetch(t, linkedin, { notion = false } = {}) {
  const saved = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (notion && isNotionRequest(url)) {
      return notionPageResponse(String(url), {
        title: 'Tide pools',
        text: 'Anemones live in tide pools',
      });
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: answer(linkedin) } }] }),
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

/** An SSE response double that keeps every event with its parsed data. */
function makeSseRes() {
  const res = new EventEmitter();
  res.writable = true;
  res.writableEnded = false;
  res.writableFinished = false;
  res.events = [];
  res.writeHead = (status) => {
    res.statusCode = status;
  };
  res.flushHeaders = () => {};
  res.write = (chunk) => {
    const text = String(chunk);
    const event = /^event: (.+)$/m.exec(text)?.[1];
    const data = /^data: (.+)$/m.exec(text)?.[1];
    if (event) res.events.push({ event, data: data ? JSON.parse(data) : null });
    return true;
  };
  res.end = () => {
    res.writableEnded = true;
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

function ctx(body, res) {
  return {
    repoRoot: process.cwd(),
    storageScope: createStorageScope(AUTHED, { repoRoot: process.cwd() }),
    req: makeReq(body),
    res,
    authedUser: AUTHED,
  };
}

/** The JSON routes answer the refusal in the internal envelope. */
async function callJson(handler, body) {
  const res = makeJsonRes();
  try {
    await handler(ctx(body, res));
  } catch (err) {
    // The dispatcher's `withErrorHandler` renders a typed refusal; a handler
    // called directly lets it through.
    if (typeof err?.toJSON !== 'function') throw err;
    return { status: err.statusCode, body: err.toJSON() };
  }
  return { status: res.statusCode, body: res.body };
}

function assertRefusedLink(route, { status, body }) {
  assert.equal(status, 400, `${route}: ${JSON.stringify(body)}`);
  assert.equal(body.error, 'invalid');
  assert.equal(body.details.field, 'members');
  assert.equal(body.details.lang, 'en-GB');
  assert.equal(typeof body.details.index, 'number');
  assert.equal(storedDecks().length, 0, `${route} left a deck behind`);
}

test('convert: a refused field is answered 400 with its slide and no deck', async (t) => {
  await setup();
  stubFetch(t, 'javascript:alert(1)');
  const dataUrl = await minimalPptxDataUrl('Anemones live in tide pools');
  assertRefusedLink(
    '/api/convert',
    await callJson(handleConvertFile, {
      dataUrl,
      filename: 'deck.pptx',
      lang: 'en',
    }),
  );
});

test('convert: the same deck with a valid field is stored', async (t) => {
  await setup();
  stubFetch(t, 'https://example.test/ana');
  const dataUrl = await minimalPptxDataUrl('Anemones live in tide pools');
  const { status, body } = await callJson(handleConvertFile, {
    dataUrl,
    filename: 'deck.pptx',
    lang: 'en',
  });
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(storedDecks().length, 1);
  // The create carries the converter's settings; the update sets the language
  // version explicitly (review of #1645).
  assert.equal(storedDecks()[0].settings.stepParagraphs, true);
  assert.equal(storedDecks()[0].settings.transitions.preset, 'fade');
  assert.equal(storedDecks()[0].i18n.versions['en-GB'].slides.length, 1);
  const team = storedDecks()[0].slides.find(
    (s) => s.type === 'team-cards-slide',
  );
  assert.equal(team?.content.members[0].linkedin, 'https://example.test/ana');
});

test('convert stream: a refused field ends in an error event and no deck', async (t) => {
  await setup();
  stubFetch(t, 'javascript:alert(1)');
  const dataUrl = await minimalPptxDataUrl('Anemones live in tide pools');
  const res = makeSseRes();
  await handleConvertStream(
    ctx({ dataUrl, filename: 'deck.pptx', lang: 'en' }, res),
  );
  const names = res.events.map((e) => e.event);
  assert.ok(names.includes('error'), names.join(','));
  assert.ok(!names.includes('complete'), 'the stream reported completion');
  assert.equal(storedDecks().length, 0);
});

test('Notion import: a refused field is answered 400 with its slide and no deck', async (t) => {
  await setup();
  stubFetch(t, 'javascript:alert(1)', { notion: true });
  assertRefusedLink(
    '/api/notion/import',
    await callJson(handleNotionImport, { url: NOTION_PAGE_ID, lang: 'en' }),
  );
});

test('Notion import: a valid page is stored with its source page id', async (t) => {
  await setup();
  stubFetch(t, 'https://example.test/ana', { notion: true });
  const { status, body } = await callJson(handleNotionImport, {
    url: NOTION_PAGE_ID,
    lang: 'en',
  });
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(storedDecks().length, 1);
  assert.equal(
    storedDecks()[0].notion_source_page_id,
    extractPageId(NOTION_PAGE_ID),
  );
  assert.equal(storedDecks()[0].settings.stepParagraphs, true);
});

test('Notion import stream: a refused field ends in an error event and no deck', async (t) => {
  await setup();
  stubFetch(t, 'javascript:alert(1)', { notion: true });
  const res = makeSseRes();
  await handleNotionImportStream(ctx({ url: NOTION_PAGE_ID, lang: 'en' }, res));
  const names = res.events.map((e) => e.event);
  assert.ok(names.includes('error'), names.join(','));
  assert.ok(!names.includes('complete'), 'the stream reported completion');
  assert.equal(storedDecks().length, 0);
});

test('Markdown import: an overlong title is refused with its slide and no deck', async () => {
  await setup();
  const markdown = `# Intro\n\nHello.\n\n---\n\n# ${'Anemones '.repeat(20)}\n\nBody text.\n`;
  const { status, body } = await callJson(handlePresentationsImportMarkdown, {
    markdown,
    lang: 'en',
  });
  assert.equal(status, 400, JSON.stringify(body));
  assert.equal(body.error, 'invalid');
  assert.equal(body.details.field, 'title');
  assert.equal(body.details.lang, 'en-GB');
  assert.equal(body.details.index, 1);
  assert.equal(storedDecks().length, 0, 'the Markdown import left a deck');
});

test('Markdown import: a valid deck is stored', async () => {
  await setup();
  const { status, body } = await callJson(handlePresentationsImportMarkdown, {
    markdown: '# Intro\n\nHello.\n\n---\n\n# Anemones\n\nBody text.\n',
    lang: 'en',
  });
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(storedDecks().length, 1);
  assert.equal(storedDecks()[0].slides.length, 2);
});
