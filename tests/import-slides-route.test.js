/**
 * `POST /api/presentations/import/slides` (B752): an existing deck as a new
 * deck of editable slides, next to `import/images` (every page a picture).
 * Same body, same refusals of the files, its own endpoint (D235); the
 * `complete` event carries the deck and the report. Cancelling writes
 * nothing. Driven against the in-memory database double; the fixture maps
 * every page, so no test here renders a page in a browser.
 *
 * Run with: node --test tests/import-slides-route.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { seedRow } from './helpers/theme-seed.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.SANDBOX_MODE;
delete process.env.IMAGEKIT_PRIVATE_KEY;
delete process.env.MEDIA_PROVIDER;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = {
  id: 'user-owner',
  email: 'owner@example.com',
  name: 'Olive Owner',
  organizationId: ORG,
};

const BRAND = await seedRow('brand');

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { initializeMediaProvider } = await import('../server/media/index.js');
const { handlePresentationsImportSlides } =
  await import('../server/routes/api/presentations/import-slides.js');

const fixture = await fs.readFile(
  new URL('./fixtures/slide-deck-tagged.pdf', import.meta.url),
);
const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** @type {ReturnType<typeof createFakeDb>} */
let db;
let mediaRoot;

test.before(async () => {
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default' }] }));
  await initializeStorage();
  // A local media library in a scratch folder, so the fixture's picture
  // really uploads.
  mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'b752-media-'));
  await initializeMediaProvider(mediaRoot);
});

test.after(async () => {
  __setTestDb(null);
  if (mediaRoot) await fs.rm(mediaRoot, { recursive: true, force: true });
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
    presentations: [],
    presentation_collaborators: [],
    presentation_comments: [],
    themes: [BRAND],
  });
  __setTestDb(db);
}

const deckCount = () => (db.__tables.presentations || []).length;

/** A response double that behaves like an SSE `ServerResponse`. */
function makeSseRes({ onEvent } = {}) {
  const res = new EventEmitter();
  res.writable = true;
  res.writableEnded = false;
  res.writableFinished = false;
  res.events = [];
  res.chunks = [];
  res.writeHead = (status) => {
    res.statusCode = status;
  };
  res.flushHeaders = () => {};
  res.write = (chunk) => {
    const text = String(chunk);
    res.chunks.push(text);
    const event = /^event: (.+)$/m.exec(text)?.[1];
    if (event) {
      res.events.push(event);
      onEvent?.(event, text, res);
    }
    return true;
  };
  res.end = (chunk) => {
    if (chunk) res.chunks.push(String(chunk));
    res.writableEnded = true;
    res.writable = false;
  };
  return res;
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

const scope = () => createStorageScope({ organizationId: ORG, user: OWNER });

const pdfBody = (pdf) => ({
  dataUrl: `data:application/pdf;base64,${pdf.toString('base64')}`,
  filename: 'results.pdf',
});

async function run(body, res = makeSseRes()) {
  await handlePresentationsImportSlides({
    repoRoot: process.cwd(),
    storageScope: scope(),
    req: makeReq({ lang: 'en', ...body }),
    res,
    authedUser: OWNER,
  });
  return res;
}

/** The `complete` payload, or the `error` message, of a finished stream. */
function lastEvent(res) {
  const blocks = res.chunks
    .join('')
    .split('\n\n')
    .filter((b) => /^event: /m.test(b));
  const last = blocks.at(-1) || '';
  return {
    event: /^event: (.+)$/m.exec(last)?.[1],
    data: JSON.parse(/^data: (.+)$/m.exec(last)?.[1] || 'null'),
  };
}

test('a slide PDF becomes a new deck of editable slides, with the report', async () => {
  seed();
  const res = await run(pdfBody(fixture));
  const done = lastEvent(res);
  assert.equal(done.event, 'complete', res.chunks.join(''));
  const { presentation, report } = done.data;
  assert.equal(presentation.title, 'results');
  assert.equal(presentation.lang, 'en-GB');
  assert.deepEqual(
    presentation.slides.map((s) => s.type),
    ['title-slide', 'list-slide', 'image-text-slide', 'table-slide'],
  );
  // The fixture's picture is uploaded and placed.
  assert.match(presentation.slides[2].content.image, /\.png$/);
  assert.equal(
    presentation.slides[3].notes,
    'Not on the slide:\nFigures in thousands of euros.',
  );
  assert.deepEqual(
    {
      slidesExtracted: report.slidesExtracted,
      slidesConverted: report.slidesConverted,
      errors: report.errors,
    },
    { slidesExtracted: 4, slidesConverted: 4, errors: [] },
  );
  assert.deepEqual(
    report.pages.map((p) => [p.page, p.type, p.reason ?? null, p.dropped]),
    [
      [1, 'title-slide', null, 0],
      [2, 'list-slide', null, 0],
      [3, 'image-text-slide', null, 0],
      [4, 'table-slide', null, 1],
    ],
  );
  assert.equal(deckCount(), 1);
  // No `mode` switch exists on the request or in the answer.
  assert.equal('mode' in done.data, false);
});

test('leaving during the import creates no deck and reports no failure', async () => {
  seed();
  const res = makeSseRes({
    onEvent: (_event, text, response) => {
      if (text.includes('Building slide 1')) {
        response.writable = false;
        response.emit('close');
      }
    },
  });
  await run(pdfBody(fixture), res);
  assert.equal(deckCount(), 0, 'a deck was created for a client that left');
  assert.ok(!res.events.includes('complete'));
  assert.ok(!res.events.includes('error'));
});

test('files that are not what their field says are refused like import/images, before the stream opens', async () => {
  const text = `data:application/pdf;base64,${Buffer.from('hello').toString('base64')}`;
  const cases = [
    [{}, 'A PDF or a PowerPoint file is required'],
    [{ dataUrl: text }, 'dataUrl must be a PDF file'],
    [{ pptxDataUrl: text }, 'pptxDataUrl must be a PowerPoint (.pptx) file'],
  ];
  for (const [body, message] of cases) {
    seed();
    const res = await run(body);
    assert.equal(res.statusCode, 400, JSON.stringify(Object.keys(body)));
    assert.equal(JSON.parse(res.chunks.join('')).message, message);
    assert.deepEqual(res.events, []);
    assert.equal(deckCount(), 0);
  }
});

test('a PowerPoint file alone is refused: editable slides are read from the PDF', async () => {
  seed();
  const zip = `data:${PPTX_MIME};base64,${Buffer.from('PK\x03\x04rest').toString('base64')}`;
  const res = await run({ pptxDataUrl: zip, pptxFilename: 'talk.pptx' });
  assert.equal(res.statusCode, 400);
  assert.equal(
    JSON.parse(res.chunks.join('')).message,
    'A PDF of the deck is required',
  );
  assert.equal(deckCount(), 0);
});

test('an unknown theme is refused before any work, and no deck is created', async () => {
  seed();
  await assert.rejects(
    run({ ...pdfBody(fixture), theme: 'no-such-theme' }),
    (err) => err?.status === 400 || err?.statusCode === 400,
  );
  assert.equal(deckCount(), 0);
});

test('a PowerPoint file whose slide count does not pair is refused with both numbers', async () => {
  seed();
  let PptxGenJS;
  try {
    PptxGenJS = (await import('pptxgenjs')).default;
    // eslint-disable-next-line no-restricted-syntax -- an install without optional dependencies has no deck writer; the pairing is covered by the image import
  } catch {
    return;
  }
  const pptx = new PptxGenJS();
  for (const t of ['One', 'Two']) pptx.addSlide().addText(t, { x: 1, y: 1 });
  const bytes = Buffer.from(await pptx.write({ outputType: 'nodebuffer' }));
  const res = await run({
    ...pdfBody(fixture),
    pptxDataUrl: `data:${PPTX_MIME};base64,${bytes.toString('base64')}`,
    pptxFilename: 'talk.pptx',
  });
  const done = lastEvent(res);
  assert.equal(done.event, 'error');
  assert.match(done.data.message, /4 pages.*2 slides/);
  assert.equal(deckCount(), 0);
});
