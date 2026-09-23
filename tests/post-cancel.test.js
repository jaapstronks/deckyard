/**
 * Long POST routes stop when the client goes away: the four SSE streams
 * (B347) and the two plain JSON routes that do the same work (B397).
 *
 * `openSseStream` has exposed a disconnect `signal` since #1187 (B338), but
 * only the analyze route read it. These four kept working for nobody: the
 * model call ran to completion, images were uploaded, and a presentation was
 * created or a deck rewritten for a reader who had already left.
 *
 * Each test drives the real route and disconnects mid-flight. The seam is
 * `globalThis.fetch` — the one way out of the provider and the Notion API —
 * following `tests/digest-generation.test.js`; no `mock.module`, no network.
 * The assertion that carries each test is negative and checked against
 * storage, not against the events: after the client leaves, nothing is
 * written.
 *
 * The PDF route is the exception: its work is a real browser render, so it
 * uses puppeteer (like the export tests) and cancels between page uploads.
 *
 * The JSON routes have no stream, so no `openSseStream` signal: they take
 * theirs from `clientDisconnectSignal`, the one source both carriers share.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import JSZip from 'jszip';
import {
  getPuppeteerBrowser,
  closePuppeteerBrowser,
  resolveChromeExecutablePath,
} from '../server/utils/puppeteer-browser.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.SANDBOX_MODE;
process.env.LLM_VENDOR = 'openai';
process.env.OPENAI_API = 'test-key';
process.env.OPENAI_MODEL = 'test-model';
process.env.NOTION_SECRET = 'test-notion-secret';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const DECK = 'deck-pdf-target';
const OWNER = {
  id: 'user-owner',
  email: 'owner@example.com',
  name: 'Olive Owner',
  organizationId: ORG,
};

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { handleAiWizardV2Stream } =
  await import('../server/routes/api/ai/wizard-v2-stream.js');
const { handleNotionImport, handleNotionImportStream } =
  await import('../server/routes/api/notion/import.js');
const { handlePresentationImportSlidesAsImages } =
  await import('../server/routes/api/presentations/import-slides-as-images.js');
const convertRoutes = await import('../server/routes/api/convert.js');

const handleConvertStream = convertRoutes.ROUTES.find(
  (r) => r.pattern === '/api/convert/stream',
).handler;
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

function seed() {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: [
      {
        id: OWNER.id,
        organization_id: ORG,
        email: OWNER.email,
        name: OWNER.name,
        role: 'user',
        auth_source: 'database',
        password_hash: null,
        settings: {},
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    presentations: [
      {
        id: DECK,
        organization_id: ORG,
        title: 'Deck the PDF lands in',
        owner_email: OWNER.email,
        created_by: OWNER.email,
        updated_by: OWNER.email,
        owner_user_id: OWNER.id,
        created_by_user_id: OWNER.id,
        updated_by_user_id: OWNER.id,
        visibility: 'private',
        theme: 'default',
        lang: 'en',
        revision: 1,
        is_view_only: false,
        slides: [
          { id: 's1', type: 'content-slide', content: { title: 'Slide one' } },
        ],
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

const storedPresentations = () => db.__tables.presentations || [];
const deckSlides = () =>
  storedPresentations().find((p) => p.id === DECK)?.slides || [];

/** A response double that behaves like an SSE `ServerResponse`. */
function makeSseRes({ onEvent } = {}) {
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
    if (event) {
      res.events.push(event);
      onEvent?.(event, text, res);
    }
    return true;
  };
  res.end = () => {
    res.writableEnded = true;
    res.writable = false;
  };
  return res;
}

/**
 * A response double for a plain JSON route: nothing is written until the
 * answer, and ending it is what marks the request answered.
 */
function makeJsonRes() {
  const res = new EventEmitter();
  res.writable = true;
  res.writableEnded = false;
  res.writableFinished = false;
  res.statusCode = null;
  res.writeHead = (status) => {
    res.statusCode = status;
  };
  res.end = () => {
    res.writableEnded = true;
    res.writableFinished = true;
    res.writable = false;
  };
  return res;
}

/** The client leaving mid-stream, the way an aborted fetch lands on the socket. */
function disconnect(res) {
  res.writable = false;
  res.emit('close');
}

function makeReq(body = {}) {
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

function scope() {
  return createStorageScope(OWNER, { repoRoot: process.cwd() });
}

/** Swap the global fetch (the provider's only way out) for one test. */
function stubFetch(t, impl) {
  const saved = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => {
    globalThis.fetch = saved;
  });
}

/** A chat-completions body the provider parser accepts. */
function chatResponse(content) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * An outline phase 1 accepts. Phase 2 may be fed the same thing: an
 * unparseable refinement falls back to deterministic slides rather than
 * failing, so an un-cancelled run still reaches the save — which is what
 * makes these tests fail loudly when the signal is not wired.
 */
const OUTLINE = JSON.stringify({
  title: 'Tide pools',
  slides: [
    { intent: 'content', roughContent: 'Anemones and their neighbours' },
  ],
});

/**
 * A provider that answers after `delayMs` and rejects when its signal aborts —
 * the model call still in flight while the client walks away. Without the
 * disconnect signal the answer arrives and the route works on to the save;
 * with it, the abort wins.
 */
function slowProvider(onCall, delayMs = 250) {
  return (_url, opts = {}) => {
    onCall?.(opts);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(chatResponse(OUTLINE)), delayMs);
      opts.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(opts.signal.reason ?? new Error('aborted'));
      });
    });
  };
}

test('wizard-v2 stream: leaving during the outline aborts the model call and saves nothing', async (t) => {
  seed();
  let providerSignal = null;
  stubFetch(
    t,
    slowProvider((opts) => {
      providerSignal = opts.signal;
    }),
  );

  const res = makeSseRes();
  const done = handleAiWizardV2Stream({
    repoRoot: process.cwd(),
    storageScope: scope(),
    req: makeReq({ raw: 'A talk about tide pools and what lives in them.' }),
    res,
    authedUser: OWNER,
  });

  // Let the route reach the provider, then leave.
  await waitFor(() => providerSignal !== null);
  disconnect(res);
  await done;

  assert.equal(
    providerSignal.aborted,
    true,
    'the outline call keeps running after the client left',
  );
  assert.equal(
    storedPresentations().length,
    1,
    'a presentation was saved for a client that had already left',
  );
  assert.ok(
    !res.events.includes('complete'),
    'a cancelled stream reported completion',
  );
  assert.ok(
    !res.events.includes('error'),
    'a cancel was reported to the client as a failure',
  );
});

test('convert stream: leaving during the conversion aborts the model call and saves nothing', async (t) => {
  seed();
  let providerSignal = null;
  stubFetch(
    t,
    slowProvider((opts) => {
      providerSignal = opts.signal;
    }),
  );

  const dataUrl = `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${(await minimalPptx()).toString('base64')}`;
  const res = makeSseRes();
  const done = handleConvertStream({
    repoRoot: process.cwd(),
    storageScope: scope(),
    req: makeReq({ dataUrl, filename: 'deck.pptx' }),
    res,
    authedUser: OWNER,
  });

  await waitFor(() => providerSignal !== null, 20_000);
  disconnect(res);
  await done;

  assert.equal(
    providerSignal.aborted,
    true,
    'the conversion keeps calling the model after the client left',
  );
  assert.equal(
    storedPresentations().length,
    1,
    'a converted presentation was saved for a client that had already left',
  );
  assert.ok(!res.events.includes('complete'));
  assert.ok(
    !res.events.includes('error'),
    'a cancel was reported to the client as a failure',
  );
});

/**
 * The smallest file `parsePptx` accepts: a zip with one slide part holding one
 * text run. Built here rather than committed as a binary fixture.
 */
async function minimalPptx() {
  const zip = new JSZip();
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>Quarterly review</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`,
  );
  return await zip.generateAsync({ type: 'nodebuffer' });
}

/** Wait for a condition, polling, with a deadline that fails loudly. */
async function waitFor(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for the route to reach the seam');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('notion import stream: leaving during the conversion aborts the model call and saves nothing', async (t) => {
  seed();
  let providerSignal = null;
  const provider = slowProvider((opts) => {
    providerSignal = opts.signal;
  });
  stubFetch(t, (url, opts = {}) => {
    const href = String(url);
    // The Notion API answers instantly; only the model call is slow enough
    // for a client to walk away during it.
    if (new URL(href).hostname === 'api.notion.com')
      return notionResponse(href);
    return provider(url, opts);
  });

  const res = makeSseRes();
  const done = handleNotionImportStream({
    repoRoot: process.cwd(),
    storageScope: scope(),
    req: makeReq({ url: NOTION_PAGE_ID }),
    res,
    authedUser: OWNER,
  });

  await waitFor(() => providerSignal !== null, 20_000);
  disconnect(res);
  await done;

  assert.equal(
    providerSignal.aborted,
    true,
    'the import keeps calling the model after the client left',
  );
  assert.equal(
    storedPresentations().length,
    1,
    'an imported presentation was saved for a client that had already left',
  );
  assert.ok(!res.events.includes('complete'));
  assert.ok(
    !res.events.includes('error'),
    'a cancel was reported to the client as a failure',
  );
});

const NOTION_PAGE_ID = '11111111222233334444555566667777';

/** The two Notion API shapes this import reads: the page, and its blocks. */
function notionResponse(href) {
  const json = (payload) =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  if (href.includes('/children')) {
    return json({
      results: [
        {
          id: 'block-1',
          type: 'paragraph',
          has_children: false,
          paragraph: {
            rich_text: [{ plain_text: 'Anemones and their neighbours' }],
          },
        },
      ],
      has_more: false,
      next_cursor: null,
    });
  }
  return json({
    id: NOTION_PAGE_ID,
    last_edited_time: '2026-02-01T00:00:00.000Z',
    properties: {
      title: { type: 'title', title: [{ plain_text: 'Tide pools' }] },
    },
  });
}

/**
 * The PDF route's work is a browser render, so this one drives the real
 * thing. It cancels between page uploads — the point where the route used to
 * keep uploading pages and then rewrite the deck for a reader who had left.
 */
test('import-slides-as-images: leaving between pages stops the upload and leaves the deck alone', async (t) => {
  const chrome = await resolveChromeExecutablePath();
  if (!chrome) {
    t.skip('no Chrome on this machine');
    return;
  }
  t.after(closePuppeteerBrowser);
  seed();

  const dataUrl = `data:application/pdf;base64,${(await twoPagePdf()).toString('base64')}`;

  // Leave as soon as the first page is being uploaded: everything after that
  // — the remaining page and the deck write — is work for nobody.
  const res = makeSseRes({
    onEvent: (_event, text, response) => {
      if (text.includes('Uploading page 1')) disconnect(response);
    },
  });

  await handlePresentationImportSlidesAsImages(
    {
      repoRoot: process.cwd(),
      storageScope: scope(),
      req: makeReq({ dataUrl, filename: 'source.pdf' }),
      res,
      authedUser: OWNER,
    },
    DECK,
  );

  assert.deepEqual(
    deckSlides().map((s) => s.id),
    ['s1'],
    'slides were added to the deck for a client that had already left',
  );
  assert.ok(!res.events.includes('complete'));
  assert.ok(
    !res.events.includes('error'),
    'a cancel was reported to the client as a failure',
  );
});

/** A two-page PDF, rendered by the same browser the route uses. */
async function twoPagePdf() {
  const browser = await getPuppeteerBrowser({ featureName: 'PDF Import' });
  const page = await browser.newPage();
  try {
    await page.setContent(
      '<h1>Page one</h1><div style="page-break-before: always"></div><h1>Page two</h1>',
    );
    return toNodeBuffer(await page.pdf({ format: 'A4' }));
  } finally {
    await page.close();
  }
}

function toNodeBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

test('convert (JSON): leaving during the conversion aborts the model call and saves nothing', async (t) => {
  seed();
  let called = false;
  let providerSignal = null;
  stubFetch(
    t,
    slowProvider((opts) => {
      called = true;
      providerSignal = opts.signal;
    }),
  );

  const dataUrl = `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${(await minimalPptx()).toString('base64')}`;
  const res = makeJsonRes();
  const done = handleConvertFile({
    repoRoot: process.cwd(),
    storageScope: scope(),
    req: makeReq({ dataUrl, filename: 'deck.pptx' }),
    res,
    authedUser: OWNER,
  });

  await waitFor(() => called, 20_000);
  disconnect(res);
  await done;

  assert.equal(
    providerSignal?.aborted,
    true,
    'the conversion keeps calling the model after the client left',
  );
  assert.equal(
    storedPresentations().length,
    1,
    'a converted presentation was saved for a client that had already left',
  );
  assert.equal(
    res.statusCode,
    null,
    'a cancel was answered as if someone were still listening',
  );
});

test('notion import (JSON): leaving during the conversion aborts the model call and saves nothing', async (t) => {
  seed();
  let called = false;
  let providerSignal = null;
  const provider = slowProvider((opts) => {
    called = true;
    providerSignal = opts.signal;
  });
  stubFetch(t, (url, opts = {}) => {
    const href = String(url);
    if (new URL(href).hostname === 'api.notion.com')
      return notionResponse(href);
    return provider(url, opts);
  });

  const res = makeJsonRes();
  const done = handleNotionImport({
    repoRoot: process.cwd(),
    storageScope: scope(),
    req: makeReq({ url: NOTION_PAGE_ID }),
    res,
    authedUser: OWNER,
  });

  await waitFor(() => called, 20_000);
  disconnect(res);
  await done;

  assert.equal(
    providerSignal?.aborted,
    true,
    'the import keeps calling the model after the client left',
  );
  assert.equal(
    storedPresentations().length,
    1,
    'an imported presentation was saved for a client that had already left',
  );
  assert.equal(
    res.statusCode,
    null,
    'a cancel was answered as if someone were still listening',
  );
});
