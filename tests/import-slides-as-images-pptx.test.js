/**
 * "Import slides as images" keeps a deck's speaker notes (B700, D334).
 *
 * Next to the import that interprets a deck into Deckyard slide types, there
 * is the import that keeps every source slide as a flat picture. The pixels
 * come from a PDF the presentation app exported; the notes from the
 * PowerPoint file beside it, read from the package in the deck's own order and
 * paired by position. A PDF export leaves hidden slides out by default, so the
 * shown slides are paired first. Either file may come alone; when both come
 * and the counts differ, nothing is imported.
 *
 * The same import also creates a new deck (`POST /api/presentations/import/
 * images`, B306): the "import an existing deck" route of the creation view.
 * It builds the slides through the same service, so the cases below drive the
 * insert route for the pairing rules and the create route for what differs:
 * a new deck, no AI, nothing written on a refusal.
 *
 * Run with: node --test tests/import-slides-as-images-pptx.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import JSZip from 'jszip';
import {
  getPuppeteerBrowser,
  closePuppeteerBrowser,
  resolveChromeExecutablePath,
  toNodeBuffer,
} from '../server/utils/puppeteer-browser.js';
import { seedRow } from './helpers/theme-seed.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.SANDBOX_MODE;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const DECK = 'deck-pptx-target';
const OWNER = {
  id: 'user-owner',
  email: 'owner@example.com',
  name: 'Olive Owner',
  organizationId: ORG,
};

// The create route settles its theme like every create: absent is the
// installation default, which has to be a seeded theme row.
const BRAND = await seedRow('brand');

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { readPptxSlideNotes } =
  await import('../server/utils/convert-file/index.js');
const { handlePresentationImportSlidesAsImages } =
  await import('../server/routes/api/presentations/import-slides-as-images.js');
const { handlePresentationsImportImages } =
  await import('../server/routes/api/presentations/import-images.js');

let PptxGenJS = null;
try {
  PptxGenJS = (await import('pptxgenjs')).default;
  // eslint-disable-next-line no-restricted-syntax -- an install without optional dependencies has no deck writer; the tests that need one skip
} catch {
  // skipped below
}
const noPptxgen = PptxGenJS ? false : 'pptxgenjs is not installed';
const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());
const noChrome =
  chromePath || isCi ? false : 'no Chrome/Chromium found on this machine';

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default' }] }));
  await initializeStorage();
});

test.after(async () => {
  __setTestDb(null);
  await closePuppeteerBrowser();
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
        title: 'Deck the slides land in',
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
    themes: [BRAND],
  });
  __setTestDb(db);
}

const deckSlides = () =>
  (db.__tables.presentations || []).find((p) => p.id === DECK)?.slides || [];

/** A response double that behaves like an SSE `ServerResponse`. */
function makeSseRes() {
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
    if (event) res.events.push(event);
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

function scope() {
  return createStorageScope({ organizationId: ORG, user: OWNER });
}

const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** Drive the route with a PDF, a PowerPoint file, or both. */
async function runImport({ pdf = null, pptx = null, body = {} } = {}) {
  const res = makeSseRes();
  await handlePresentationImportSlidesAsImages(
    {
      repoRoot: process.cwd(),
      storageScope: scope(),
      req: makeReq({
        ...(pdf && {
          dataUrl: `data:application/pdf;base64,${pdf.toString('base64')}`,
          filename: 'talk.pdf',
        }),
        ...(pptx && {
          pptxDataUrl: `data:${PPTX_MIME};base64,${pptx.toString('base64')}`,
          pptxFilename: 'talk.pptx',
        }),
        ...body,
      }),
      res,
      authedUser: OWNER,
    },
    DECK,
  );
  return res;
}

/** Drive the create route with a PDF, a PowerPoint file, or both. */
async function runCreate({ pdf = null, pptx = null, body = {} } = {}) {
  const res = makeSseRes();
  await handlePresentationsImportImages({
    repoRoot: process.cwd(),
    storageScope: scope(),
    req: makeReq({
      ...(pdf && {
        dataUrl: `data:application/pdf;base64,${pdf.toString('base64')}`,
        filename: 'talk.pdf',
      }),
      ...(pptx && {
        pptxDataUrl: `data:${PPTX_MIME};base64,${pptx.toString('base64')}`,
        pptxFilename: 'talk.pptx',
      }),
      lang: 'nl',
      ...body,
    }),
    res,
    authedUser: OWNER,
  });
  return res;
}

const deckIds = () => (db.__tables.presentations || []).map((p) => p.id);

/** The `complete` payload, or the `error` message, of a finished stream. */
function lastEvent(res) {
  const text = res.chunks.join('');
  const blocks = text.split('\n\n').filter((b) => /^event: /m.test(b));
  const last = blocks.at(-1) || '';
  return {
    event: /^event: (.+)$/m.exec(last)?.[1],
    data: JSON.parse(/^data: (.+)$/m.exec(last)?.[1] || 'null'),
  };
}

const NOTES = {
  one: 'Notes for One & <co>\nsecond line',
  three: 'Notes for Three & <co>\nsecond line',
  four: 'Notes for Four & <co>\nsecond line',
};

/** Four slides; the second has no notes, the third is hidden. */
async function sampleDeck() {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  const titles = ['One', 'Two', 'Three', 'Four'];
  titles.forEach((title, i) => {
    const slide = pptx.addSlide();
    slide.addText(`Slide ${title}`, { x: 1, y: 1, w: 8, h: 1, fontSize: 40 });
    if (i !== 1) slide.addNotes(`Notes for ${title} & <co>\nsecond line`);
    if (i === 2) slide.hidden = true;
  });
  return toNodeBuffer(await pptx.write({ outputType: 'nodebuffer' }));
}

/** A PDF with one page per title, printed by the shared browser. */
async function printPdf(titles) {
  const browser = await getPuppeteerBrowser({
    featureName: 'PPTX import test',
  });
  const page = await browser.newPage();
  try {
    const body = titles
      .map((t) => `<section style="page-break-after: always">${t}</section>`)
      .join('');
    await page.setContent(`<!DOCTYPE html><html><body>${body}</body></html>`);
    return toNodeBuffer(await page.pdf({ width: '960px', height: '540px' }));
  } finally {
    await page.close();
  }
}

test(
  'readPptxSlideNotes: notes per slide in deck order, hidden slides marked, body text only',
  { skip: noPptxgen },
  async () => {
    const slides = await readPptxSlideNotes(await sampleDeck());
    assert.deepEqual(
      slides.map((s) => [s.hidden, s.notes]),
      [
        [false, NOTES.one],
        [false, ''],
        [true, NOTES.three],
        [false, NOTES.four],
      ],
    );
  },
);

test(
  'readPptxSlideNotes: a reordered deck follows presentation.xml, not the part names',
  { skip: noPptxgen },
  async () => {
    const zip = await JSZip.loadAsync(await sampleDeck());
    const presXml = await zip.file('ppt/presentation.xml').async('string');
    const reordered = presXml.replace(
      /(<p:sldIdLst\b[^>]*>)([\s\S]*?)(<\/p:sldIdLst>)/,
      (_, open, body, close) =>
        open +
        (body.match(/<p:sldId\b[^>]*\/>/g) || []).reverse().join('') +
        close,
    );
    assert.notEqual(reordered, presXml);
    zip.file('ppt/presentation.xml', reordered);
    const slides = await readPptxSlideNotes(
      await zip.generateAsync({ type: 'nodebuffer' }),
    );
    assert.deepEqual(
      slides.map((s) => s.part),
      [4, 3, 2, 1].map((n) => `ppt/slides/slide${n}.xml`),
    );
    assert.equal(slides[0].notes, NOTES.four);
  },
);

test(
  'a PDF with its PowerPoint file lands as one image slide per page, each with the notes of its slide',
  { skip: noPptxgen || noChrome },
  async () => {
    seed();
    // Three pages: what PowerPoint exports for the four slides, the hidden
    // one left out.
    const res = await runImport({
      pdf: await printPdf(['One', 'Two', 'Four']),
      pptx: await sampleDeck(),
    });

    const done = lastEvent(res);
    assert.equal(done.event, 'complete', res.chunks.join(''));
    assert.equal(done.data.withImages, true);
    assert.equal(done.data.withNotes, true);
    const slides = deckSlides();
    assert.equal(slides[0].id, 's1');
    const imported = slides.slice(1);
    assert.deepEqual(
      imported.map((s) => [s.type, s.notes, s.content.alt]),
      [
        ['image-slide', NOTES.one, 'talk - Page 1'],
        ['image-slide', '', 'talk - Page 2'],
        ['image-slide', NOTES.four, 'talk - Page 3'],
      ],
    );
  },
);

test(
  'a PDF that kept the hidden slide pairs with all slides',
  { skip: noPptxgen || noChrome },
  async () => {
    seed();
    const res = await runImport({
      pdf: await printPdf(['One', 'Two', 'Three', 'Four']),
      pptx: await sampleDeck(),
    });
    assert.equal(lastEvent(res).event, 'complete', res.chunks.join(''));
    assert.deepEqual(
      deckSlides()
        .slice(1)
        .map((s) => s.notes),
      [NOTES.one, '', NOTES.three, NOTES.four],
    );
  },
);

test(
  'a page count that matches neither is refused with both numbers, and the deck is left alone',
  { skip: noPptxgen || noChrome },
  async () => {
    seed();
    const res = await runImport({
      pdf: await printPdf(['One', 'Two']),
      pptx: await sampleDeck(),
    });
    const done = lastEvent(res);
    assert.equal(done.event, 'error');
    assert.match(done.data.message, /2 pages.*3 slides/);
    assert.deepEqual(
      deckSlides().map((s) => s.id),
      ['s1'],
    );
  },
);

test(
  'a PowerPoint file alone gives every shown slide its notes, without an image',
  { skip: noPptxgen },
  async () => {
    seed();
    const res = await runImport({ pptx: await sampleDeck() });
    const done = lastEvent(res);
    assert.equal(done.event, 'complete', res.chunks.join(''));
    assert.equal(done.data.withImages, false);
    assert.deepEqual(
      deckSlides()
        .slice(1)
        .map((s) => [s.type, s.content.image, s.notes]),
      [
        ['image-slide', '', NOTES.one],
        ['image-slide', '', ''],
        ['image-slide', '', NOTES.four],
      ],
    );
  },
);

test(
  'a PDF alone still imports page by page, without notes',
  { skip: noChrome },
  async () => {
    seed();
    const res = await runImport({ pdf: await printPdf(['A', 'B']) });
    const done = lastEvent(res);
    assert.equal(done.event, 'complete', res.chunks.join(''));
    assert.equal(done.data.withNotes, false);
    assert.deepEqual(
      deckSlides()
        .slice(1)
        .map((s) => [s.type, s.notes, s.content.alt]),
      [
        ['image-slide', '', 'talk - Page 1'],
        ['image-slide', '', 'talk - Page 2'],
      ],
    );
  },
);

test('files that are not what their field says are refused before the stream opens', async () => {
  const text = `data:application/pdf;base64,${Buffer.from('hello').toString('base64')}`;
  for (const body of [
    {},
    { dataUrl: text },
    { pptxDataUrl: text },
    {
      dataUrl: `data:application/pdf;base64,${Buffer.from('PK\x03\x04').toString('base64')}`,
    },
  ]) {
    seed();
    const res = await runImport({ body });
    assert.equal(res.statusCode, 400, JSON.stringify(Object.keys(body)));
    assert.deepEqual(res.events, []);
    assert.deepEqual(
      deckSlides().map((s) => s.id),
      ['s1'],
    );
  }
});

test('a zip that holds no slides is refused, and the deck is left alone', async () => {
  seed();
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document/>');
  const res = await runImport({
    pptx: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  const done = lastEvent(res);
  assert.equal(done.event, 'error');
  assert.match(done.data.message, /No slides found/);
  assert.deepEqual(
    deckSlides().map((s) => s.id),
    ['s1'],
  );
});

test(
  'create: a PDF with its PowerPoint file becomes a new deck, named after the file, one image slide per page',
  { skip: noPptxgen || noChrome },
  async () => {
    seed();
    const res = await runCreate({
      pdf: await printPdf(['One', 'Two', 'Four']),
      pptx: await sampleDeck(),
    });
    const done = lastEvent(res);
    assert.equal(done.event, 'complete', res.chunks.join(''));
    assert.equal(done.data.slidesAdded, 3);
    assert.equal(done.data.withImages, true);
    assert.equal(done.data.withNotes, true);
    const created = done.data.presentation;
    assert.notEqual(created.id, DECK);
    assert.equal(created.title, 'talk');
    assert.equal(created.lang, 'nl');
    assert.deepEqual(
      created.slides.map((s) => [s.type, s.notes, s.content.alt]),
      [
        ['image-slide', NOTES.one, 'talk - Page 1'],
        ['image-slide', '', 'talk - Page 2'],
        ['image-slide', NOTES.four, 'talk - Page 3'],
      ],
    );
    // The deck it was not asked about is left alone.
    assert.deepEqual(
      deckSlides().map((s) => s.id),
      ['s1'],
    );
  },
);

test(
  'create: a PowerPoint file alone becomes a deck of shown slides with their notes, without a browser',
  { skip: noPptxgen },
  async () => {
    seed();
    const res = await runCreate({ pptx: await sampleDeck() });
    const done = lastEvent(res);
    assert.equal(done.event, 'complete', res.chunks.join(''));
    assert.equal(done.data.withImages, false);
    assert.deepEqual(
      done.data.presentation.slides.map((s) => [s.type, s.notes]),
      [
        ['image-slide', NOTES.one],
        ['image-slide', ''],
        ['image-slide', NOTES.four],
      ],
    );
    assert.equal(deckIds().length, 2);
  },
);

test(
  'create: counts that match neither are refused with both numbers, and no deck is created',
  { skip: noPptxgen || noChrome },
  async () => {
    seed();
    const res = await runCreate({
      pdf: await printPdf(['One', 'Two']),
      pptx: await sampleDeck(),
    });
    const done = lastEvent(res);
    assert.equal(done.event, 'error');
    assert.match(done.data.message, /2 pages.*3 slides/);
    assert.deepEqual(deckIds(), [DECK]);
  },
);

test('create: files that are not what their field says are refused before the stream opens', async () => {
  const text = `data:application/pdf;base64,${Buffer.from('hello').toString('base64')}`;
  for (const body of [{}, { dataUrl: text }, { pptxDataUrl: text }]) {
    seed();
    const res = await runCreate({ body });
    assert.equal(res.statusCode, 400, JSON.stringify(Object.keys(body)));
    assert.deepEqual(res.events, []);
    assert.deepEqual(deckIds(), [DECK]);
  }
});

test('create: an unknown theme is refused before any work, and no deck is created', async () => {
  seed();
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document/>');
  await assert.rejects(
    runCreate({
      pptx: await zip.generateAsync({ type: 'nodebuffer' }),
      body: { theme: 'no-such-theme' },
    }),
    (err) => err?.statusCode === 400 && err?.details?.field === 'theme',
  );
  assert.deepEqual(deckIds(), [DECK]);
});

test('create: a zip that holds no slides is refused, and no deck is created', async () => {
  seed();
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document/>');
  const res = await runCreate({
    pptx: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  const done = lastEvent(res);
  assert.equal(done.event, 'error');
  assert.match(done.data.message, /No slides found/);
  assert.deepEqual(deckIds(), [DECK]);
});
