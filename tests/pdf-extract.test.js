/**
 * The page model of a slide PDF (B751): `extractPdfPages()` reads a tagged
 * PDF that Chrome printed from `tests/fixtures/slide-deck-tagged.html` (four
 * pages: title, bulleted list, text with an image, table) and must give each
 * page its heading, blocks, image and dropped text, in reading order. The PDF
 * is committed, so no test here starts a browser; the HTML says how to
 * regenerate it.
 *
 * Run with: node --test tests/pdf-extract.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { extractPdfPages } from '../server/utils/pdf-extract/index.js';

const fixture = await fs.readFile(
  new URL('./fixtures/slide-deck-tagged.pdf', import.meta.url),
);
const result = await extractPdfPages(fixture);
const page = (n) => result.pages[n - 1];
const texts = (p) => p.lines.map((l) => l.text);

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

test('the fixture is read as a tagged four-page 16:9 deck', () => {
  assert.equal(result.pageCount, 4);
  assert.equal(result.pages.length, 4);
  assert.equal(result.tagged, true);
  assert.ok(result.pages.every((p) => p.tagged));
  assert.equal(Math.round(result.size.width), 720);
  assert.equal(Math.round(result.size.height), 405);
});

test('page 1: heading from the H1, then subtitle and date in reading order', () => {
  const p = page(1);
  assert.equal(p.heading, 'Quarterly results 2025');
  assert.equal(p.headingSource, 'struct');
  assert.deepEqual(texts(p), [
    'Quarterly results 2025',
    'Growth across every region',
    '17 October 2025',
  ]);
  assert.deepEqual(
    p.blocks.map((b) => [b.kind, b.text]),
    [
      ['para', 'Growth across every region'],
      ['para', '17 October 2025'],
    ],
  );
  assert.equal(p.lines[0].role, 'heading');
  assert.equal(p.lines[0].bold, true);
  assert.ok(p.lines[0].size > p.lines[1].size);
});

test('page 2: a bulleted list of four literal items', () => {
  const p = page(2);
  assert.equal(p.heading, 'What we learned');
  const lists = p.blocks.filter((b) => b.kind === 'list');
  assert.equal(lists.length, 1);
  assert.equal(lists[0].variant, 'bullets');
  assert.deepEqual(
    lists[0].items.map((i) => i.text),
    [
      'Customers want faster onboarding',
      'Pricing is clear enough',
      'Support response times improved',
      'Mobile usage doubled',
    ],
  );
  assert.deepEqual(texts(p), [
    'What we learned',
    ...lists[0].items.map((i) => i.text),
  ]);
});

test('page 3: a paragraph and exactly one image as a PNG with its box and alt', () => {
  const p = page(3);
  // The heading is split around an "ffi" ligature run; it comes out whole.
  assert.equal(p.heading, 'Our new office');
  assert.deepEqual(
    p.blocks.map((b) => [b.kind, b.text]),
    [['para', 'The team moved into a brighter space in the city centre.']],
  );
  assert.equal(p.images.length, 1);
  const [img] = p.images;
  assert.ok(Buffer.isBuffer(img.png));
  assert.deepEqual(img.png.subarray(0, 8), PNG_SIGNATURE);
  assert.deepEqual(img.pixels, { width: 120, height: 80 });
  assert.equal(img.alt, 'Floor plan of the new office');
  // 240×160 CSS px at 0.75 pt/px, below the paragraph, inside the page.
  assert.ok(Math.abs(img.box.width - 180) < 1);
  assert.ok(Math.abs(img.box.height - 120) < 1);
  assert.ok(img.box.x >= 0 && img.box.x + img.box.width <= p.width);
  assert.ok(
    img.box.y > p.lines.at(-1).y && img.box.y + img.box.height <= p.height,
  );
});

test('page 4: a table with a header row and the footnote dropped', () => {
  const p = page(4);
  assert.equal(p.heading, 'Revenue by region');
  const tables = p.blocks.filter((b) => b.kind === 'table');
  assert.equal(tables.length, 1);
  assert.equal(tables[0].headerRow, true);
  assert.deepEqual(tables[0].rows, [
    ['Region', 'Q3', 'Q4'],
    ['North', '120', '140'],
    ['South', '95', '110'],
    ['West', '80', '99'],
  ]);
  assert.deepEqual(p.dropped, [
    { text: 'Figures in thousands of euros.', reason: 'footnote' },
  ]);
  assert.ok(!texts(p).includes('Figures in thousands of euros.'));
});

test('no page carries drawing labels or stray drops', () => {
  for (const p of result.pages) {
    assert.deepEqual(p.drawing.labels, []);
    assert.ok(p.drawing.paths >= 0);
    if (p.page !== 4) assert.deepEqual(p.dropped, []);
  }
});

test('read by geometry only, the fixture still yields headings and the table', async () => {
  const geometry = await extractPdfPages(fixture, { useStructTree: false });
  assert.equal(geometry.tagged, false);
  assert.deepEqual(
    geometry.pages.map((p) => p.heading),
    [
      'Quarterly results 2025',
      'What we learned',
      'Our new office',
      'Revenue by region',
    ],
  );
  assert.ok(geometry.pages.every((p) => p.headingSource === 'geometry'));
  const table = geometry.pages[3].blocks.find((b) => b.kind === 'table');
  assert.deepEqual(table.rows[0], ['Region', 'Q3', 'Q4']);
  assert.equal(table.rows.length, 4);
  assert.equal(table.headerRow, true);
});

test('an already-aborted signal rejects before the document opens', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    extractPdfPages(fixture, { signal: controller.signal }),
    {
      name: 'AbortError',
    },
  );
});

test('an abort during extraction rejects, and the next extraction still works', async () => {
  // Trips on the third check: before the document, before page 1, before page 2.
  let checks = 0;
  const controller = new AbortController();
  const signal = {
    throwIfAborted() {
      checks += 1;
      if (checks === 3) controller.abort();
      controller.signal.throwIfAborted();
    },
  };
  await assert.rejects(extractPdfPages(fixture, { signal }), {
    name: 'AbortError',
  });
  assert.equal(checks, 3);
  const again = await extractPdfPages(fixture);
  assert.equal(again.pageCount, 4);
});

test('the caller buffer is left intact', async () => {
  const copy = Buffer.from(fixture);
  await extractPdfPages(copy);
  assert.deepEqual(copy, fixture);
});
