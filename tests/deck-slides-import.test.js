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

import { extractPdfPages } from '../server/utils/pdf-extract/index.js';
import {
  FALLBACK_REASONS,
  blocksToMarkdown,
  buildDeckSlides,
  chooseSlide,
  composeNotes,
  pageText,
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
  // instead of a silently empty slide.
  assert.deepEqual(
    report.errors.map((e) => e.page),
    [1, 2],
  );
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
