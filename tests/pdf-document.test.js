/**
 * A report PDF reaches the AI as one document with headings (B773): the
 * document layer of `pdf-extract` reads the page models of the whole PDF,
 * and `readPdf()` hands a document-shaped PDF over as marked-up text
 * instead of a "slide" per page.
 *
 * The Kamerbrief fixture runs everywhere. The Philips and IEA reports of the
 * generation suite may not be redistributed, so their tests read the copy
 * `npm run ai-suite:fetch` puts in `test-suite/cases/` and skip without it.
 *
 * Run with: node --test tests/pdf-document.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  readDocument,
  extractPdfDocument,
} from '../server/utils/pdf-extract/index.js';
import { readTextRuns } from '../server/utils/pdf-extract/text-runs.js';
import { readPdf } from '../server/utils/convert-file/pdf-reader.js';
import { formatDocumentForAi } from '../server/utils/convert-file/helpers.js';

const readFixture = (name) =>
  fs.readFile(new URL(`./fixtures/${name}`, import.meta.url));

async function suiteSource(caseId, file) {
  try {
    return await fs.readFile(
      new URL(`../test-suite/cases/${caseId}/source/${file}`, import.meta.url),
    );
  } catch {
    return null;
  }
}

const headings = (text) => text.split('\n').filter((l) => /^#+ /.test(l));

// --- the Kamerbrief ---------------------------------------------------------

const letter = await readPdf(
  await readFixture('kamerbrief-duurzame-digitalisering.pdf'),
);

test('a letter is read in the document shape', () => {
  assert.equal(letter.shape, 'document');
  assert.equal(typeof letter.document, 'string');
  assert.equal(letter.slides.length, 3, 'the text per page stays');
});

test('the paragraph over the page break p1-p2 is one paragraph', () => {
  const paragraphs = letter.document.split('\n\n');
  const across = paragraphs.filter((p) =>
    p.includes('dat op 17 juni 2024 aan uw Kamer is verstuurd.'),
  );
  assert.equal(across.length, 1);
  assert.match(across[0], /^Daarom bied ik u hierbij/);
  assert.ok(!paragraphs.some((p) => p.startsWith('Kamer is verstuurd.')));
});

test('the letter heading keeps the subject and date, not the address column', () => {
  const [head] = letter.document.split('\n\n');
  assert.equal(
    head,
    [
      'Datum 19 november 2025',
      'Betreft Actieprogramma Duurzame Digitalisering 2026-2028',
    ].join('\n'),
  );
  for (const noise of [
    'Overheidsidentificatienr',
    '070 379 8911',
    'Bezuidenhoutseweg',
    'Retouradres',
    'DGED-DE',
    'Pagina 1 van 3',
    'Kamerstuk 26 643',
  ]) {
    assert.ok(!letter.document.includes(noise), `in the document: ${noise}`);
  }
});

test('a bold short paragraph at body size is a heading', () => {
  assert.deepEqual(headings(letter.document), [
    '## Het Actieprogramma Duurzame Digitalisering 2026 - 2028',
  ]);
});

test('the document goes to the AI without slide framing', () => {
  const input = formatDocumentForAi(letter.document, { title: 'Brief' });
  assert.match(input, /^DOCUMENT TITLE: Brief\n\n=== DOCUMENT ===\n\nDatum/);
  assert.ok(!input.includes('--- SLIDE'));
});

test('a deck keeps the slide shape', async () => {
  const deck = await readPdf(await readFixture('slide-deck-tagged.pdf'));
  assert.equal(deck.shape, 'slides');
  assert.equal(deck.document, undefined);
});

// --- the document layer on page models ------------------------------------

const PAGE = { width: 595, height: 842 };

function page(n, blocks, extra = {}) {
  return {
    page: n,
    ...PAGE,
    tagged: false,
    heading: null,
    headingSource: null,
    lines: [],
    blocks,
    images: [],
    drawing: { paths: 0, labels: [] },
    dropped: [],
    ...extra,
  };
}

const para = (y, text, size = 9, bold = false) => ({
  kind: 'para',
  y,
  text,
  bold,
  size,
});

const BODY =
  'Running text long enough to set the body size of the document, as a report carries it page after page.';

test('a footer that recurs on every page is dropped, the text is not', () => {
  const { text } = readDocument({
    pages: [1, 2, 3].map((n) =>
      page(n, [
        para(100, `${BODY} (${n}).`),
        para(818, `Annual Report - ${n}`),
      ]),
    ),
  });
  assert.ok(!text.includes('Annual Report'));
  assert.equal(text.split('\n\n').length, 3);
});

test('a margin line that occurs once stays', () => {
  const { text } = readDocument({
    pages: [
      page(1, [para(30, 'Draft for discussion'), para(100, `${BODY}.`)]),
      page(2, [para(100, `${BODY}.`)]),
    ],
  });
  assert.match(text, /^Draft for discussion/);
});

test('heading levels follow the recurring heading sizes; the cover is the title', () => {
  const { title, text } = readDocument({
    pages: [
      page(1, [para(60, 'Annual Report', 30, true), para(100, `${BODY}.`)]),
      page(2, [
        para(60, 'Results', 20, true),
        para(90, 'Revenue', 11, true),
        para(110, `${BODY}.`),
        para(300, 'Costs', 11, true),
        para(320, `${BODY}.`),
      ]),
      page(3, [
        para(60, 'Outlook', 20, true),
        para(90, 'Note', 9, true),
        para(110, `${BODY}.`),
      ]),
    ],
  });
  assert.equal(title, 'Annual Report');
  assert.deepEqual(headings(text), [
    '# Annual Report',
    '## Results',
    '### Revenue',
    '### Costs',
    '## Outlook',
    '#### Note',
  ]);
});

test('a heading set over several paragraphs is one heading', () => {
  const { title } = readDocument({
    pages: [
      page(1, [
        para(60, 'World Energy', 40, true),
        para(100, 'Outlook', 40, true),
        para(140, '2024', 40, true),
        para(200, `${BODY}.`),
      ]),
    ],
  });
  assert.equal(title, 'World Energy Outlook 2024');
});

test('a paragraph closed with a full stop does not run on over the page break', () => {
  const { blocks } = readDocument({
    pages: [
      page(1, [para(700, `${BODY}.`)]),
      page(2, [para(60, 'A new paragraph starts here.')]),
    ],
  });
  assert.deepEqual(
    blocks.map((b) => b.text),
    [`${BODY}.`, 'A new paragraph starts here.'],
  );
});

test('a list runs on into the list on the next page', () => {
  const list = (y, items) => ({
    kind: 'list',
    y,
    variant: 'numbers',
    items: items.map((text) => ({ text, parts: [text] })),
  });
  const { text } = readDocument({
    pages: [
      page(1, [para(100, `${BODY}.`), list(700, ['One', 'Two'])]),
      page(2, [list(60, ['Three'])]),
    ],
  });
  assert.match(text, /1\. One\n2\. Two\n3\. Three/);
});

test('a data table is a pipe table; aligned prose columns stay lines', () => {
  const table = (rows, headerRow = false) => ({
    kind: 'table',
    y: 200,
    headerRow,
    rows,
  });
  const { text } = readDocument({
    pages: [
      page(1, [
        para(100, `${BODY}.`),
        table([
          ['Region', 'Q3', 'Q4'],
          ['North | East', '120', '140'],
          ['A\\B', '1', '2'],
        ]),
        table([
          ['The agency examines', 'Members'],
          ['the full spectrum', 'Australia'],
        ]),
      ]),
    ],
  });
  assert.match(
    text,
    /\| Region \| Q3 \| Q4 \|\n\| --- \| --- \| --- \|\n\| North \\\| East \| 120 \| 140 \|\n\| A\\\\B \| 1 \| 2 \|/,
  );
  assert.match(
    text,
    /The agency examines Members\nthe full spectrum Australia/,
  );
});

test('extractPdfDocument reads the bytes in one call', async () => {
  const doc = await extractPdfDocument(
    new Uint8Array(await readFixture('kamerbrief-duurzame-digitalisering.pdf')),
  );
  assert.equal(doc.text, letter.document);
});

// --- runs ---------------------------------------------------------------------

test('a run turned 90° is no wider than its line (no glued column headers)', () => {
  const viewport = { convertToViewportPoint: (x, y) => [x, 842 - y] };
  const [flat, turned] = readTextRuns(
    {
      items: [
        { str: 'flat', transform: [9, 0, 0, 9, 50, 700], width: 40 },
        { str: 'turned', transform: [0, 9, -9, 0, 80, 700], width: 60 },
      ],
    },
    { viewport },
  );
  assert.equal(flat.width, 40);
  assert.equal(turned.width, 0);
  assert.equal(turned.size, 9);
});

// --- the suite reports (local copies only) ----------------------------------

const philips = await suiteSource('philips-q4-2024', 'results-report.pdf');
const iea = await suiteSource('iea-weo-2024', 'executive-summary.pdf');

test(
  'Philips: chapters and sections are headings, the running footer is gone',
  { skip: philips ? false : 'run `npm run ai-suite:fetch` for the source' },
  async () => {
    const doc = await readPdf(philips);
    assert.equal(doc.shape, 'document');
    const found = headings(doc.document);
    assert.equal(found[0], '# Quarterly report - Q4 2024');
    for (const heading of [
      '## Full Year and Q4 Group performance highlights',
      '### Group and segment performance',
      '### Innovation highlights',
      '### Outlook',
      '### Respironics Recall',
      '## Fourth quarter highlights',
      '## Performance per segment',
      '### Diagnosis & Treatment',
    ]) {
      assert.ok(found.includes(heading), `missing: ${heading}`);
    }
    assert.ok(!/Quarterly Report 2024 - Q4 \d/.test(doc.document));
  },
);

test(
  'IEA: the section headings are ## headings, the licence footer is gone',
  { skip: iea ? false : 'run `npm run ai-suite:fetch` for the source' },
  async () => {
    const doc = await readPdf(iea);
    assert.equal(doc.shape, 'document');
    const found = headings(doc.document);
    assert.equal(found[0], '# World Energy Outlook 2024 - Executive Summary');
    for (const heading of [
      '## Geopolitical tensions and fragmentation are major risks for energy security and for coordinated action on reducing emissions',
      '## How fast will clean energy transitions unfold?',
      '## Who will ride the wave of new LNG?',
      '## Choices and consequences',
    ]) {
      assert.ok(found.includes(heading), `missing: ${heading}`);
    }
    assert.ok(!doc.document.includes('CC BY 4.0'));
  },
);
