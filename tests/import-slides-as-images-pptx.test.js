/**
 * "Import slides as images" takes a PowerPoint file too, and its speaker notes
 * become the notes of the image slides (B700).
 *
 * Next to the import that interprets a deck into Deckyard slide types, there is
 * the import that keeps every source slide as a flat picture. For a PDF that
 * was all there was; a PPTX is printed to a PDF by LibreOffice first and its
 * notes are read from the package itself, in the deck's own order, hidden
 * slides left out the way LibreOffice leaves them out of the PDF.
 *
 * LibreOffice is a system package, so the route is driven here with a stand-in
 * `soffice` (`SOFFICE_PATH`) that writes a PDF printed by the shared browser
 * and keeps a copy of the file it was handed. That covers the whole route:
 * the spawn, the notes, the slides in the deck. The last test runs the real
 * LibreOffice where one is installed.
 *
 * Run with: node --test tests/import-slides-as-images-pptx.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import {
  getPuppeteerBrowser,
  closePuppeteerBrowser,
  resolveChromeExecutablePath,
  toNodeBuffer,
} from '../server/utils/puppeteer-browser.js';
import { SOFFICE_CANDIDATE_PATHS } from '../server/render/pptx-to-pdf.js';

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

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { readPptxSlideNotes } =
  await import('../server/utils/convert-file/index.js');
const { getFeatureFlags } = await import('../server/config/flags-snapshot.js');
const { handlePresentationImportSlidesAsImages } =
  await import('../server/routes/api/presentations/import-slides-as-images.js');

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

async function runImport(buffer, filename) {
  const res = makeSseRes();
  const mime = filename.endsWith('.pdf')
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  await handlePresentationImportSlidesAsImages(
    {
      repoRoot: process.cwd(),
      storageScope: scope(),
      req: makeReq({
        dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
        filename,
      }),
      res,
      authedUser: OWNER,
    },
    DECK,
  );
  return res;
}

/**
 * Four slides; the second has no notes, the third is hidden, the fourth
 * carries a hyperlink (an external relationship).
 */
async function sampleDeck() {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  const titles = ['One', 'Two', 'Three', 'Four'];
  titles.forEach((title, i) => {
    const slide = pptx.addSlide();
    slide.addText(
      i === 3
        ? [
            {
              text: `Slide ${title}`,
              options: { hyperlink: { url: 'https://tracker.example.test/' } },
            },
          ]
        : `Slide ${title}`,
      { x: 1, y: 1, w: 8, h: 1, fontSize: 40 },
    );
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

/**
 * A stand-in `soffice`: writes `pdf` where LibreOffice would and keeps the
 * file it was handed in `seen`. Pointed at through `SOFFICE_PATH`.
 */
async function fakeSoffice(t, pdf) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'b700-soffice-'));
  const pdfPath = path.join(dir, 'out.pdf');
  const seen = path.join(dir, 'seen.pptx');
  await fs.writeFile(pdfPath, pdf);
  const bin = path.join(dir, 'soffice');
  await fs.writeFile(
    bin,
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const outdir = args[args.indexOf('--outdir') + 1];
const input = args[args.length - 1];
fs.copyFileSync(input, ${JSON.stringify(seen)});
fs.copyFileSync(${JSON.stringify(pdfPath)}, path.join(outdir, path.basename(input, '.pptx') + '.pdf'));
`,
    { mode: 0o755 },
  );
  const before = process.env.SOFFICE_PATH;
  process.env.SOFFICE_PATH = bin;
  t.after(async () => {
    if (before === undefined) delete process.env.SOFFICE_PATH;
    else process.env.SOFFICE_PATH = before;
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { seen };
}

test(
  'readPptxSlideNotes: notes per slide in deck order, hidden slides marked, body text only',
  {
    skip: noPptxgen,
  },
  async () => {
    const slides = await readPptxSlideNotes(await sampleDeck());
    assert.deepEqual(
      slides.map((s) => [s.hidden, s.notes]),
      [
        [false, 'Notes for One & <co>\nsecond line'],
        [false, ''],
        [true, 'Notes for Three & <co>\nsecond line'],
        [false, 'Notes for Four & <co>\nsecond line'],
      ],
    );
  },
);

test(
  'readPptxSlideNotes: a reordered deck follows presentation.xml, not the part names',
  {
    skip: noPptxgen,
  },
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
    assert.match(slides[0].notes, /^Notes for Four/);
  },
);

test(
  'a PPTX with notes lands as one image slide per shown slide, each with its notes',
  {
    skip: noPptxgen || noChrome,
  },
  async (t) => {
    seed();
    // Three pages: what LibreOffice prints for the four slides, the hidden one
    // left out.
    const { seen } = await fakeSoffice(
      t,
      await printPdf(['One', 'Two', 'Four']),
    );
    assert.equal(getFeatureFlags().pptxRasterImport, true);

    const res = await runImport(await sampleDeck(), 'talk.pptx');

    assert.ok(res.events.includes('complete'), res.chunks.join(''));
    const slides = deckSlides();
    assert.equal(slides[0].id, 's1');
    const imported = slides.slice(1);
    assert.equal(imported.length, 3);
    assert.ok(imported.every((s) => s.type === 'image-slide'));
    assert.deepEqual(
      imported.map((s) => s.notes),
      [
        'Notes for One & <co>\nsecond line',
        '',
        'Notes for Four & <co>\nsecond line',
      ],
    );
    assert.deepEqual(
      imported.map((s) => s.content.alt),
      ['talk - Slide 1', 'talk - Slide 2', 'talk - Slide 3'],
    );

    // What reached LibreOffice had no external address left in it.
    const handed = await JSZip.loadAsync(await fs.readFile(seen));
    for (const name of Object.keys(handed.files).filter((n) =>
      n.endsWith('.rels'),
    )) {
      const xml = await handed.file(name).async('string');
      assert.ok(!xml.includes('tracker.example.test'), name);
    }
  },
);

test(
  'a page count that does not match the shown slides imports without notes',
  {
    skip: noPptxgen || noChrome,
  },
  async (t) => {
    seed();
    await fakeSoffice(t, await printPdf(['One', 'Two']));
    const res = await runImport(await sampleDeck(), 'talk.pptx');
    assert.ok(res.events.includes('complete'), res.chunks.join(''));
    const imported = deckSlides().slice(1);
    assert.equal(imported.length, 2);
    assert.deepEqual(
      imported.map((s) => s.notes),
      ['', ''],
    );
  },
);

test(
  'a PDF still imports page by page, without notes',
  {
    skip: noChrome,
  },
  async () => {
    seed();
    const res = await runImport(await printPdf(['A', 'B']), 'source.pdf');
    assert.ok(res.events.includes('complete'), res.chunks.join(''));
    const imported = deckSlides().slice(1);
    assert.deepEqual(
      imported.map((s) => [s.type, s.notes, s.content.alt]),
      [
        ['image-slide', '', 'source - Page 1'],
        ['image-slide', '', 'source - Page 2'],
      ],
    );
  },
);

test('a file that is neither a PDF nor a zip is refused before the stream opens', async () => {
  seed();
  const res = await runImport(Buffer.from('hello, world'), 'notes.txt');
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.events, []);
  assert.deepEqual(
    deckSlides().map((s) => s.id),
    ['s1'],
  );
});

test(
  'without LibreOffice a PPTX is refused with its own code, and the flag is off',
  {
    skip: noPptxgen,
  },
  async (t) => {
    const installed = [];
    for (const p of SOFFICE_CANDIDATE_PATHS) {
      try {
        await fs.access(p, fs.constants.X_OK);
        installed.push(p);
        // eslint-disable-next-line no-restricted-syntax -- not installed at this path, which is what this test wants
      } catch {
        // not here
      }
    }
    if (installed.length) {
      t.skip(`LibreOffice is installed (${installed[0]})`);
      return;
    }
    const before = process.env.SOFFICE_PATH;
    process.env.SOFFICE_PATH = path.join(os.tmpdir(), 'no-such-soffice');
    t.after(() => {
      if (before === undefined) delete process.env.SOFFICE_PATH;
      else process.env.SOFFICE_PATH = before;
    });
    seed();
    assert.equal(getFeatureFlags().pptxRasterImport, false);
    const res = await runImport(await sampleDeck(), 'talk.pptx');
    assert.equal(res.statusCode, 400);
    assert.equal(
      JSON.parse(res.chunks.join('')).error,
      'pptx_import_unavailable',
    );
  },
);

test(
  'with the real LibreOffice, the notes still line up',
  {
    skip: noPptxgen || noChrome,
  },
  async (t) => {
    const { resolveSofficePath } =
      await import('../server/render/pptx-to-pdf.js');
    if (!resolveSofficePath()) {
      t.skip('LibreOffice is not installed');
      return;
    }
    seed();
    const res = await runImport(await sampleDeck(), 'talk.pptx');
    assert.ok(res.events.includes('complete'), res.chunks.join(''));
    assert.deepEqual(
      deckSlides()
        .slice(1)
        .map((s) => s.notes),
      [
        'Notes for One & <co>\nsecond line',
        '',
        'Notes for Four & <co>\nsecond line',
      ],
    );
  },
);
