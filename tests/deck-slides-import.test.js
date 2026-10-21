/**
 * The import of an existing deck as editable slides (B752, PR 2 of B737):
 * `services/deck-slides-import.js` maps each page model of
 * `server/utils/pdf-extract/` onto a slide type, with the text literal, and
 * lets a page that fits no type fall back on its own as a picture of itself.
 *
 * Two promises are pinned here: every kept line of the source lands letter
 * for letter, and in order, in the slide's content; and each fallback reason
 * is reached by the page shape it names. The tests need no browser: the
 * fixture PDF is committed, the untagged pages are written by hand
 * (`helpers/minimal-pdf.js`) and the page rasteriser is a stub.
 *
 * Run with: node --test tests/deck-slides-import.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  extractPdfPages,
  lineBox,
  overlapArea,
  pageText,
} from '../server/utils/pdf-extract/index.js';
import sharp from 'sharp';

import {
  CROP_MAX_COVER,
  CROP_MIN_COVER,
  DECORATION_MAX_COVER,
  FALLBACK_REASONS,
  REPORT_ERROR_CODES,
  blocksToMarkdown,
  buildDeckSlides,
  chooseSlide,
  composeNotes,
  cutOutOfRendering,
  findDecorations,
  planPage,
} from '../server/services/deck-slides-import.js';
import { SLIDE_TYPES } from '../shared/slide-types.js';
import { escapeMarkdownText, markdownToSafeHtml } from '../shared/markdown.js';
import { minimalPdf } from './helpers/minimal-pdf.js';

let PptxGenJS = null;
try {
  PptxGenJS = (await import('pptxgenjs')).default;
  // eslint-disable-next-line no-restricted-syntax -- an install without optional dependencies has no deck writer; the test that needs one skips
} catch {
  // skipped below
}

const fixture = await fs.readFile(
  new URL('./fixtures/slide-deck-tagged.pdf', import.meta.url),
);
const { pages: fixturePages } = await extractPdfPages(fixture);

const ctx = { slideTypes: SLIDE_TYPES, lang: 'en' };

/** Undo the markdown escapes, so a body reads as the text it renders. */
const unescape = (s) => String(s).replace(/\\([!-/:-@[-`{-~])/g, '$1');

/**
 * The text of a slide in reading order: the fields a reader meets, top to
 * bottom, with nested items and cells flattened.
 */
function slideText(slide) {
  const order = ['title', 'subheading', 'meta', 'body', 'items', 'rows'];
  const out = [];
  const walk = (value) => {
    if (typeof value === 'string') out.push(unescape(value));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      for (const key of ['title', 'text', 'body', 'blocks']) walk(value[key]);
      for (const key of Object.keys(value).filter((k) => /^c\d+$/.test(k))) {
        walk(value[key]);
      }
    }
  };
  for (const key of order) walk(slide.content[key]);
  walk(slide.content.caption);
  return out.join('\n');
}

/** Every kept line of the page: the heading, then each block's text. */
function keptLines(page) {
  const lines = page.heading ? [page.heading] : [];
  for (const block of page.blocks) {
    if (block.kind === 'list') lines.push(...block.items.map((i) => i.text));
    else if (block.kind === 'table') lines.push(...block.rows.flat());
    else if (block.kind === 'cards')
      lines.push(...block.cards.flatMap((c) => [c.title, c.body]));
    else lines.push(block.text);
  }
  return lines.filter((l) => l.trim());
}

/** Assert each line occurs in `text`, literally, each after the one before. */
function assertInOrder(text, lines, label) {
  let from = 0;
  for (const line of lines) {
    const at = text.indexOf(line, from);
    assert.ok(
      at >= 0,
      `${label}: "${line}" is not on the slide (after offset ${from}) in:\n${text}`,
    );
    from = at + line.length;
  }
}

// ---------------------------------------------------------------------------
// Literal text
// ---------------------------------------------------------------------------

test('the fixture maps to title, list, image+text and table slides', () => {
  const types = fixturePages.map((p) => planPage(p, ctx).slide?.type);
  assert.deepEqual(types, [
    'title-slide',
    'list-slide',
    'image-text-slide',
    'table-slide',
  ]);
});

test('every kept source line lands letter for letter, and in order, on its slide', () => {
  for (const page of fixturePages) {
    const plan = planPage(page, ctx);
    assert.ok(plan.slide, `page ${page.page} fell back: ${plan.reason}`);
    const lines = keptLines(page);
    assert.ok(lines.length, `page ${page.page} has no text to check`);
    assertInOrder(slideText(plan.slide), lines, `page ${page.page}`);
  }
});

test('the fixture slides carry the page structure, not only its text', () => {
  const [title, list, imageText, table] = fixturePages.map(
    (p) => planPage(p, ctx).slide,
  );
  assert.deepEqual(
    [title.content.title, title.content.subheading, title.content.meta],
    ['Quarterly results 2025', 'Growth across every region', '17 October 2025'],
  );
  assert.equal(list.content.variant, 'bullets');
  assert.equal(list.content.items.length, 4);
  assert.equal(imageText.content.alt, 'Floor plan of the new office');
  assert.equal(imageText.content.imageSide, 'left');
  assert.equal(table.content.headerRow, 'on');
  assert.equal(table.content.colCount, '3');
  assert.deepEqual(table.content.rows[1], {
    c1: 'North',
    c2: '120',
    c3: '140',
  });
});

test('markdown markers in source text stay characters, not formatting', () => {
  const tricky = [
    'Ship the *new* app',
    '1. not a list',
    '- not a bullet',
    '# not a heading',
    '> not a quote',
    'snake_case and _emphasis_',
    'cost: $5 and $x$ maths',
    'a `code` span and a [link](https://x.test)',
    'back\\slash',
  ];
  for (const text of tricky) {
    // Without a DOM the sanitizer escapes the markup once more: decode until
    // nothing changes (the sample text holds no `<`), then strip the tags.
    let html = markdownToSafeHtml(escapeMarkdownText(text));
    for (let prev = ''; prev !== html;) {
      prev = html;
      html = html
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&amp;/g, '&');
    }
    assert.doesNotMatch(html, /<(em|strong|ol|ul|li|h3|blockquote|code|a)\b/);
    // Strip the paragraph tags until none is left: the text is compared, not
    // served, so this is a reader, not a sanitizer.
    let plain = html;
    for (let prev = ''; prev !== plain;) {
      prev = plain;
      plain = plain.replace(/<[^>]*>/g, '');
    }
    assert.equal(plain, text, `rendered ${JSON.stringify(text)} as ${html}`);
  }
  const cell = escapeMarkdownText('a | b', { tableCell: true });
  assert.equal(cell, 'a \\| b');
});

test('a body keeps paragraphs, lists and tables as markdown with literal text', () => {
  const md = blocksToMarkdown([
    { kind: 'para', text: 'Intro *line*', bold: false },
    {
      kind: 'list',
      variant: 'numbers',
      items: [{ text: 'First' }, { text: 'Second' }],
    },
    {
      kind: 'table',
      headerRow: true,
      rows: [
        ['A', 'B|C'],
        ['1', '2'],
      ],
    },
  ]);
  assert.equal(
    md,
    'Intro \\*line\\*\n\n1. First\n2. Second\n\n| A | B\\|C |\n| --- | --- |\n| 1 | 2 |',
  );
});

// ---------------------------------------------------------------------------
// Fallback per page: one test per reason
// ---------------------------------------------------------------------------

/** A page model with the defaults of an empty 16:9 page. */
function model(over = {}) {
  return {
    page: 2,
    width: 720,
    height: 405,
    tagged: true,
    heading: null,
    headingSource: null,
    lines: [],
    blocks: [],
    images: [],
    drawing: { paths: 0, labels: [] },
    dropped: [],
    ...over,
  };
}

const line = (text, role = 'para', size = 16) => ({
  text,
  role,
  size,
  x: 40,
  y: 100,
  width: 200,
  bold: false,
});
const image = (box) => ({ png: Buffer.from('png'), box, pixels: box });
const para = (text) => ({ kind: 'para', y: 120, text, bold: false });

test('the reasons are a closed set, each reached below', () => {
  assert.deepEqual([...FALLBACK_REASONS].sort(), [
    'drawing',
    'multi-image',
    'no-heading',
    'no-text',
    'table-untagged',
    'too-long',
  ]);
});

test('fallback no-text: a page without text and without a picture', () => {
  assert.deepEqual(chooseSlide(model()), { reason: 'no-text' });
  // A drawing without text keeps its pixels too.
  assert.deepEqual(
    chooseSlide(model({ drawing: { paths: 120, labels: [] } })),
    {
      reason: 'no-text',
    },
  );
});

test('fallback drawing: a heading and text beside a vector drawing', () => {
  const page = model({
    heading: 'Revenue',
    lines: [line('Revenue', 'heading', 28), line('Up in every quarter')],
    blocks: [para('Up in every quarter')],
    drawing: { paths: 61, labels: [] },
  });
  assert.deepEqual(chooseSlide(page), { reason: 'drawing' });
  // Sixty paths are a few rules and boxes, not a drawing.
  page.drawing.paths = 60;
  assert.equal(chooseSlide(page).reason, undefined);
});

test('fallback table-untagged: a table found by geometry alone', () => {
  const page = model({
    tagged: false,
    heading: 'Revenue',
    blocks: [
      {
        kind: 'table',
        y: 120,
        headerRow: false,
        rows: [
          ['North', '1'],
          ['South', '2'],
        ],
      },
    ],
  });
  assert.deepEqual(chooseSlide(page), { reason: 'table-untagged' });
  // The same table from the structure tree is a table slide.
  assert.equal(chooseSlide({ ...page, tagged: true }).type, 'table-slide');
});

test('a table cell keeps its markdown markers as characters', () => {
  // The table slide renders cells as inline markdown, unlike the other
  // string fields: a source cell with an asterisk is escaped like a body.
  const page = model({
    heading: 'Key figures',
    blocks: [
      {
        kind: 'table',
        y: 120,
        headerRow: true,
        rows: [
          ['Measure', 'Q4'],
          ['EBITA *adjusted*', '$1.2bn'],
        ],
      },
    ],
  });
  const { content } = chooseSlide(page);
  assert.equal(content.rows[1].c1, 'EBITA \\*adjusted\\*');
  assert.equal(content.rows[1].c2, '\\$1.2bn');
  const html = markdownToSafeHtml(content.rows[1].c1);
  assert.doesNotMatch(html, /<em\b/);
  assert.match(html, /EBITA \*adjusted\*/);
});

test('fallback multi-image: more than one picture beside the text', () => {
  const page = model({
    heading: 'Our partners',
    blocks: [para('Thanks to all of them')],
    images: [
      image({ x: 40, y: 200, width: 100, height: 60 }),
      image({ x: 200, y: 200, width: 100, height: 60 }),
    ],
  });
  assert.deepEqual(chooseSlide(page), { reason: 'multi-image' });
});

test('fallback no-heading: running text without a heading', () => {
  const texts = ['One small line', 'Two', 'Three', 'Four'];
  const page = model({
    lines: texts.map((t) => line(t, 'para', 12)),
    blocks: texts.map(para),
  });
  assert.deepEqual(chooseSlide(page), { reason: 'no-heading' });
});

test('fallback too-long: literal text longer than any slide field holds', () => {
  const page = model({
    heading: `A heading that runs on ${'and on '.repeat(20)}`.trim(),
    lines: [line('x', 'heading', 28), line('Body')],
    blocks: [para('Body text')],
  });
  assert.ok(page.heading.length > 140);
  assert.deepEqual(planPage(page, ctx), { reason: 'too-long' });
});

test('a page with a picture has no second home without it: too long falls back (B826)', () => {
  // The alt text of the figure is longer than `image-text-slide` holds;
  // `content-slide` would take the text, but only by dropping the picture.
  const page = model({
    heading: 'The figure',
    lines: [line('The figure', 'heading', 28), line('Body')],
    blocks: [para('Body text')],
    images: [
      {
        ...image({ x: 400, y: 100, width: 280, height: 200 }),
        alt: `A long description ${'of the figure '.repeat(20)}`.trim(),
      },
    ],
  });
  assert.ok(page.images[0].alt.length > 180);
  const choice = chooseSlide(page);
  assert.equal(choice.type, 'image-text-slide');
  assert.equal(choice.uploads.length, 1);
  assert.deepEqual(planPage(page, ctx), { reason: 'too-long' });
});

test('a list longer than the list slide holds becomes a text slide, still literal', () => {
  const items = Array.from({ length: 10 }, (_v, i) => ({
    text: `Point ${i + 1}`,
    parts: [`Point ${i + 1}`],
  }));
  const page = model({
    heading: 'Ten points',
    lines: [
      line('Ten points', 'heading', 28),
      ...items.map((i) => line(i.text)),
    ],
    blocks: [{ kind: 'list', y: 120, variant: 'bullets', items }],
  });
  const plan = planPage(page, ctx);
  assert.equal(plan.slide.type, 'content-slide');
  assertInOrder(slideText(plan.slide), keptLines(page), 'ten points');
});

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

test('notes: speaker notes first, then the page text, then what is not on the slide', () => {
  assert.equal(
    composeNotes({
      speakerNotes: 'Say hello',
      pageText: 'Heading\nBody',
      notOnSlide: ['Page 4', ''],
      lang: 'nl',
    }),
    'Say hello\n\nHeading\nBody\n\nNiet op de slide:\nPage 4',
  );
  assert.equal(
    composeNotes({ notOnSlide: ['Footer'], lang: 'en' }),
    'Not on the slide:\nFooter',
  );
  assert.equal(composeNotes({ speakerNotes: 'Only this' }), 'Only this');
});

test('the page text of a fallback is the heading, the blocks, then the drawing labels', () => {
  const page = model({
    heading: 'Chart',
    blocks: [para('Caption under it')],
    drawing: { paths: 90, labels: [{ text: '2024', x: 0, y: 0 }] },
  });
  assert.equal(pageText(page), 'Chart\nCaption under it\n2024');
});

// ---------------------------------------------------------------------------
// The whole import, without a browser
// ---------------------------------------------------------------------------

/** Three untagged pages: blank, a heading beside a drawing, a list. */
const handPdf = minimalPdf([
  { texts: [] },
  {
    texts: [
      { text: 'Chart of growth', size: 28, x: 50, y: 60, bold: true },
      { text: 'Revenue rose in every quarter', size: 14, x: 50, y: 110 },
    ],
    paths: 61,
  },
  {
    texts: [
      { text: 'Plans for 2026', size: 28, x: 50, y: 60, bold: true },
      { text: '- Hire two engineers', size: 16, x: 50, y: 120 },
      { text: '- Open an office in Ghent', size: 16, x: 50, y: 150 },
      { text: '- Ship the *new* app', size: 16, x: 50, y: 180 },
    ],
  },
]);

function stubRenderer() {
  const calls = [];
  const render = async ({ pages }) => {
    calls.push(pages);
    return pages.map((page) => ({ page, buffer: Buffer.from(`page ${page}`) }));
  };
  return { render, calls };
}

test('only the pages that fall back are rendered; each is an image slide with its text in the notes', async () => {
  const { render, calls } = stubRenderer();
  const { slides, report } = await buildDeckSlides({
    files: { pdfBytes: handPdf, pptxBytes: null, filename: 'hand.pdf' },
    theme: null,
    lang: 'en',
    slideTypes: SLIDE_TYPES,
    signal: new AbortController().signal,
    onProgress: () => {},
    renderPages: render,
  });
  assert.deepEqual(calls, [[1, 2]]);
  assert.deepEqual(
    slides.map((s) => [s.type, s.content.bleed ?? null]),
    [
      ['image-slide', true],
      ['image-slide', true],
      ['list-slide', null],
    ],
  );
  assert.equal(
    slides[1].notes,
    'Chart of growth\nRevenue rose in every quarter',
  );
  assert.deepEqual(
    slides[2].content.items.map((i) => i.title),
    ['Hire two engineers', 'Open an office in Ghent', 'Ship the *new* app'],
  );
  assert.equal(report.slidesExtracted, 3);
  assert.equal(report.slidesConverted, 1);
  assert.deepEqual(
    report.pages.map(({ page, type, reason }) => [page, type, reason ?? null]),
    [
      [1, 'image-slide', 'no-text'],
      [2, 'image-slide', 'drawing'],
      [3, 'list-slide', null],
    ],
  );
  // No media provider in this test: the uploads fail, and the report says so
  // instead of a silently empty slide, with a code and no sentence (B826).
  assert.deepEqual(report.errors, [
    { page: 1, code: 'upload-failed' },
    { page: 2, code: 'upload-failed' },
  ]);
});

test('the error codes are a closed set, and a page the rasteriser skipped is one of them', async () => {
  assert.deepEqual([...REPORT_ERROR_CODES].sort(), [
    'not-rendered',
    'upload-failed',
  ]);
  // The rasteriser returns page 1 only: page 2 fell back and has no image,
  // so nothing is uploaded for it and the report names the page.
  const render = async ({ pages }) =>
    pages
      .filter((page) => page === 1)
      .map((page) => ({ page, buffer: Buffer.from(`page ${page}`) }));
  const { slides, report } = await buildDeckSlides({
    files: { pdfBytes: handPdf, pptxBytes: null, filename: 'hand.pdf' },
    theme: null,
    lang: 'en',
    slideTypes: SLIDE_TYPES,
    signal: new AbortController().signal,
    onProgress: () => {},
    renderPages: render,
  });
  assert.equal(slides[1].type, 'image-slide');
  assert.equal(slides[1].content.image, '');
  assert.deepEqual(report.errors, [
    { page: 1, code: 'upload-failed' },
    { page: 2, code: 'not-rendered' },
  ]);
  for (const error of report.errors) {
    assert.ok(REPORT_ERROR_CODES.includes(error.code));
    assert.equal('message' in error, false);
  }
});

test(
  'the notes of the PowerPoint file come first, the page text after them',
  { skip: PptxGenJS ? false : 'pptxgenjs is not installed' },
  async () => {
    const pptx = new PptxGenJS();
    ['Open with a story', 'Point at the chart', 'Three plans'].forEach(
      (notes, i) => {
        const slide = pptx.addSlide();
        slide.addText(`Slide ${i + 1}`, { x: 1, y: 1 });
        slide.addNotes(notes);
      },
    );
    const pptxBytes = Buffer.from(
      await pptx.write({ outputType: 'nodebuffer' }),
    );
    const { render } = stubRenderer();
    const { slides } = await buildDeckSlides({
      files: { pdfBytes: handPdf, pptxBytes, filename: 'hand.pdf' },
      theme: null,
      lang: 'en',
      slideTypes: SLIDE_TYPES,
      signal: new AbortController().signal,
      onProgress: () => {},
      renderPages: render,
    });
    assert.deepEqual(
      slides.map((s) => s.notes),
      [
        'Open with a story',
        'Point at the chart\n\nChart of growth\nRevenue rose in every quarter',
        'Three plans',
      ],
    );
  },
);

test('text the slide does not show goes to its notes, under its own heading', async () => {
  const { slides, report } = await buildDeckSlides({
    files: { pdfBytes: fixture, pptxBytes: null, filename: 'deck.pdf' },
    theme: null,
    lang: 'nl',
    slideTypes: SLIDE_TYPES,
    signal: new AbortController().signal,
    onProgress: () => {},
    renderPages: () => assert.fail('nothing on the fixture falls back'),
  });
  assert.equal(
    slides[3].notes,
    'Niet op de slide:\nFigures in thousands of euros.',
  );
  assert.equal(report.pages[3].dropped, 1);
  assert.equal(report.slidesConverted, 4);
});

test('a missing or unreadable PDF is refused, and an abort stops the reading', async () => {
  const base = {
    theme: null,
    lang: 'en',
    slideTypes: SLIDE_TYPES,
    onProgress: () => {},
    signal: new AbortController().signal,
  };
  await assert.rejects(
    buildDeckSlides({ ...base, files: { pdfBytes: null, pptxBytes: null } }),
    { message: 'A PDF of the deck is required' },
  );
  await assert.rejects(
    buildDeckSlides({
      ...base,
      files: { pdfBytes: Buffer.from('%PDF-1.4 broken'), pptxBytes: null },
    }),
    { message: 'The PDF could not be read' },
  );
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    buildDeckSlides({
      ...base,
      signal: aborted.signal,
      files: { pdfBytes: fixture, pptxBytes: null },
    }),
    { name: 'AbortError' },
  );
});

// ---------------------------------------------------------------------------
// Mixed pages and decoration (B831)
// ---------------------------------------------------------------------------

test('a tagged table beside text is no drawing: its paths are the table', () => {
  const page = model({
    heading: 'Cash flow',
    lines: [
      line('Cash flow', 'heading', 28),
      line('Free cash flow rose'),
      line('Q4', 'table-cell', 12),
    ],
    blocks: [
      para('Free cash flow rose'),
      {
        kind: 'table',
        y: 200,
        headerRow: true,
        rows: [
          ['Measure', 'Q4'],
          ['Free cash flow', '1.2'],
        ],
      },
    ],
    // Philips p20: 70 paths, 14 of them the table's rules and fills.
    drawing: { paths: 70, tablePaths: 14, labels: [], box: null },
  });
  const plan = planPage(page, ctx);
  assert.equal(plan.slide.type, 'content-slide');
  assert.match(
    plan.slide.content.body,
    /\| Measure \| Q4 \|\n\| --- \| --- \|\n\| Free cash flow \| 1\.2 \|/,
  );
  assertInOrder(slideText(plan.slide), keptLines(page), 'table beside text');
  // The same paths outside a table are a drawing.
  page.drawing.tablePaths = 0;
  assert.equal(chooseSlide(page).reason, 'drawing');
});

const chartFixture = await fs.readFile(
  new URL('./fixtures/chart-slide-tagged.pdf', import.meta.url),
);
const {
  pages: [chartPage],
} = await extractPdfPages(chartFixture);

/**
 * The chart slide of the fixture with a body beside the chart: two
 * paragraphs left of it, at a size above the chart's labels, and the paths
 * of a real chart (the fixture's own 17 are under the drawing threshold).
 */
function chartWithBody() {
  const body = ['Alfa leads the quarter', 'Charlie closes the gap by year end'];
  const lines = body.map((text, i) => ({
    text,
    role: 'para',
    size: 24,
    x: 48,
    y: 260 + i * 80,
    width: 250,
    bold: false,
    color: '#000000',
  }));
  return {
    ...chartPage,
    lines: [...chartPage.lines, ...lines],
    blocks: lines.map((l) => ({
      kind: 'para',
      y: l.y,
      text: l.text,
      bold: false,
      size: l.size,
      box: lineBox(l),
    })),
    drawing: { ...chartPage.drawing, paths: 120 },
  };
}

test('a drawing beside text is cut out of the page, with no heading or body line in it', () => {
  const page = chartWithBody();
  const plan = planPage(page, ctx);
  assert.equal(plan.slide.type, 'image-text-slide');
  assert.equal(plan.slide.content.imageSide, 'right');
  assert.equal(plan.slide.content.alt, 'Chart data');
  const [upload] = plan.uploads;
  assert.equal(upload.key, 'image');
  assert.deepEqual(upload.crop, page.drawing.box);
  const share =
    (upload.crop.width * upload.crop.height) / (page.width * page.height);
  assert.ok(share >= CROP_MIN_COVER && share <= CROP_MAX_COVER, `${share}`);
  for (const l of page.lines.filter((l) => l.role !== 'label')) {
    assert.equal(
      overlapArea(lineBox(l), upload.crop),
      0,
      `"${l.text}" is in the cut-out`,
    );
  }
  // Every kept line stands literally on the slide; the labels are in the
  // picture and, through the import, in the notes.
  assertInOrder(slideText(plan.slide), keptLines(page), 'chart with body');
});

test('a drawing with a body line in it, or without pixels to cut from, keeps its page whole', () => {
  const page = chartWithBody();
  assert.equal(chooseSlide(page, { pagePixels: false }).reason, 'drawing');
  assert.equal(planPage(page, { ...ctx, pagePixels: false }).reason, 'drawing');
  // The second paragraph moved into the chart.
  const [first, second] = page.blocks;
  const moved = { ...page.lines.at(-1), x: 500, y: 400 };
  const inside = {
    ...page,
    lines: [...page.lines.slice(0, -1), moved],
    blocks: [first, { ...second, y: moved.y, box: lineBox(moved) }],
  };
  assert.equal(chooseSlide(inside).reason, 'drawing');
  // Nothing outside the drawing: no text for the slide beside it.
  assert.equal(chooseSlide({ ...page, blocks: [] }).reason, 'drawing');
});

test('the cut-out is the box of the page in the rendering, at its scale and offset', async () => {
  // A 1920×1080 rendering of a 1200×675 page (scale 1.6) with a red block
  // where the page has its drawing.
  const page = { width: 1200, height: 675 };
  const box = { x: 600, y: 200, width: 300, height: 200 };
  const rendering = await sharp({
    create: { width: 1920, height: 1080, channels: 3, background: '#ffffff' },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 480,
            height: 320,
            channels: 3,
            background: '#ff0000',
          },
        })
          .png()
          .toBuffer(),
        left: 960,
        top: 320,
      },
    ])
    .png()
    .toBuffer();
  const cut = await cutOutOfRendering(rendering, page, box);
  const { data, info } = await sharp(cut)
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [480, 320]);
  const corners = [0, info.width - 1, (info.height - 1) * info.width];
  for (const at of corners) {
    const px = at * info.channels;
    assert.deepEqual([...data.subarray(px, px + 3)], [255, 0, 0]);
  }
});

/** A heading, two lines of body and a drawing of 120 paths right of them. */
const mixedPdf = minimalPdf([
  {
    texts: [
      { text: 'Growth per region', size: 28, x: 50, y: 60, bold: true },
      { text: 'North doubled its revenue', size: 14, x: 50, y: 120 },
      { text: 'South held steady', size: 14, x: 50, y: 150 },
    ],
    paths: 120,
  },
]);

async function solidRendering() {
  return sharp({
    create: { width: 1920, height: 1080, channels: 3, background: '#3366cc' },
  })
    .png()
    .toBuffer();
}

test('the import renders the page a drawing is cut out of, and uploads the cut-out', async () => {
  const calls = [];
  const buffer = await solidRendering();
  const { slides, report } = await buildDeckSlides({
    files: { pdfBytes: mixedPdf, pptxBytes: null, filename: 'mixed.pdf' },
    theme: null,
    lang: 'en',
    slideTypes: SLIDE_TYPES,
    signal: new AbortController().signal,
    onProgress: () => {},
    renderPages: async ({ pages }) => {
      calls.push(pages);
      return pages.map((page) => ({ page, buffer }));
    },
  });
  assert.deepEqual(calls, [[1]]);
  assert.equal(slides[0].type, 'image-text-slide');
  assert.equal(
    unescape(slides[0].content.body),
    'North doubled its revenue\n\nSouth held steady',
  );
  assert.deepEqual(report.pages[0].reason, undefined);
  assert.equal(report.slidesConverted, 1);
  // The cut was made; the media library of this test refuses it.
  assert.deepEqual(report.errors, [{ page: 1, code: 'upload-failed' }]);
});

test('a page whose rendering is missing keeps its page whole instead of a cut-out', async () => {
  const { slides, report } = await buildDeckSlides({
    files: { pdfBytes: mixedPdf, pptxBytes: null, filename: 'mixed.pdf' },
    theme: null,
    lang: 'en',
    slideTypes: SLIDE_TYPES,
    signal: new AbortController().signal,
    onProgress: () => {},
    renderPages: async () => [],
  });
  assert.equal(slides[0].type, 'image-slide');
  assert.equal(report.pages[0].reason, 'drawing');
  assert.deepEqual(report.errors, [{ page: 1, code: 'not-rendered' }]);
});

/** Three list pages with the same picture in the top right corner. */
function decoratedPdf(picture) {
  return minimalPdf(
    [1, 2, 3].map((n) => ({
      texts: [
        { text: `Plans ${n}`, size: 28, x: 50, y: 60, bold: true },
        { text: '- Hire two engineers', size: 16, x: 50, y: 120 },
        { text: '- Open an office in Ghent', size: 16, x: 50, y: 150 },
      ],
      images: [picture],
    })),
  );
}

test('a small picture in the same place on three pages is decoration: left out, named once', async () => {
  const logo = { x: 670, y: 15, width: 30, height: 30 };
  assert.ok((30 * 30) / (720 * 405) <= DECORATION_MAX_COVER);
  const { slides, report } = await buildDeckSlides({
    files: { pdfBytes: decoratedPdf(logo), pptxBytes: null, filename: 'd.pdf' },
    theme: null,
    lang: 'en',
    slideTypes: SLIDE_TYPES,
    signal: new AbortController().signal,
    onProgress: () => {},
    renderPages: () => assert.fail('nothing falls back'),
  });
  assert.deepEqual(
    slides.map((s) => s.type),
    ['list-slide', 'list-slide', 'list-slide'],
  );
  assert.deepEqual(report.decorations, [{ pages: [1, 2, 3] }]);
  assert.deepEqual(report.errors, []);
});

test('the same picture at 20% of the page is content and stays on every page', async () => {
  const photo = { x: 400, y: 100, width: 300, height: 195 };
  assert.ok(Math.abs((300 * 195) / (720 * 405) - 0.2) < 0.01);
  const { slides, report } = await buildDeckSlides({
    files: {
      pdfBytes: decoratedPdf(photo),
      pptxBytes: null,
      filename: 'd.pdf',
    },
    theme: null,
    lang: 'en',
    slideTypes: SLIDE_TYPES,
    signal: new AbortController().signal,
    onProgress: () => {},
    renderPages: () => assert.fail('nothing falls back'),
  });
  assert.deepEqual(
    slides.map((s) => s.type),
    ['image-text-slide', 'image-text-slide', 'image-text-slide'],
  );
  assert.deepEqual(report.decorations, []);
});

test('decoration needs the same pixels, the same place and three pages', () => {
  const png = Buffer.from('logo');
  const at = (page, box, bytes = png) =>
    model({ page, images: [{ png: bytes, box, pixels: box }] });
  const corner = { x: 670, y: 15, width: 30, height: 30 };
  const nudged = { ...corner, x: corner.x + 1.5 };
  // Within two points is the same place.
  assert.deepEqual(
    findDecorations([at(1, corner), at(2, nudged), at(3, corner)]).decorations,
    [{ pages: [1, 2, 3] }],
  );
  // Two pages are no pattern; other pixels are another picture; a box
  // three points off is another place.
  for (const pages of [
    [at(1, corner), at(2, corner)],
    [at(1, corner), at(2, corner), at(3, corner, Buffer.from('other'))],
    [at(1, corner), at(2, corner), at(3, { ...corner, y: 18.5 })],
  ]) {
    const { pages: kept, decorations } = findDecorations(pages);
    assert.deepEqual(decorations, []);
    assert.ok(kept.every((p) => p.images.length === 1));
  }
});
