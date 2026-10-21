/**
 * Layout variant and background from the page model (B830, track 1b of
 * B755): where a slide type offers a choice the page already made, the
 * imported slide follows the page. The width and corner of a picture beside
 * text, two columns of blocks, the height and centring of a heading, and a
 * dark or tinted page, chosen only from options the types declare, with
 * `validateSlideFields` as the boundary (`planPage` returns no slide that
 * fails it).
 *
 * Run with: node --test tests/deck-slides-layout.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { extractPdfPages } from '../server/utils/pdf-extract/index.js';
import {
  backgroundOf,
  inTwoColumns,
  planPage,
} from '../server/services/deck-slides-import.js';
import { readCoreThemeSeeds } from '../server/utils/theme-seeds.js';
import { buildThemeConfig } from '../server/utils/theme-builder.js';
import { SLIDE_TYPES } from '../shared/slide-types.js';
import { validateSlideFields } from '../shared/slide-types/presentation.js';
import { normalizeTheme } from '../shared/theme-normalize.js';

const fixture = await fs.readFile(
  new URL('./fixtures/slide-deck-tagged.pdf', import.meta.url),
);
const { pages: fixturePages } = await extractPdfPages(fixture);

const seeds = await readCoreThemeSeeds();
/** A core theme as a deck resolves it. */
const theme = (slug) =>
  normalizeTheme(
    buildThemeConfig(seeds.find((s) => s.record.slug === slug).record),
  );

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
    background: { color: '#ffffff' },
    drawing: { paths: 0, labels: [], tablePaths: 0, box: null },
    dropped: [],
    ...over,
  };
}

const headingLine = (
  text,
  { x = 40, y = 70, width = 300, size = 28 } = {},
) => ({
  text,
  role: 'heading',
  size,
  x,
  y,
  width,
  bold: true,
  color: '#000000',
});
const box = (x, y, width, height) => ({ x, y, width, height });
const para = (text, b) => ({ kind: 'para', y: b.y, text, bold: false, box: b });
const image = (b) => ({ png: Buffer.from('png'), box: b, pixels: b });

/** A text page under a heading. */
const textPage = (blocks, over = {}) =>
  model({
    heading: 'Two sides',
    lines: [headingLine('Two sides')],
    blocks,
    ...over,
  });

const plan = (page, opts = {}) => {
  const result = planPage(page, {
    slideTypes: SLIDE_TYPES,
    lang: 'en',
    ...opts,
  });
  assert.ok(result.slide, `fell back: ${result.reason}`);
  assert.deepEqual(
    validateSlideFields(result.slide, { slideTypes: SLIDE_TYPES }),
    [],
  );
  return result.slide;
};

// ---------------------------------------------------------------------------
// The picture beside text
// ---------------------------------------------------------------------------

test('the fixture picture takes the split width nearest to its share of the page', () => {
  const page = fixturePages[2];
  const share = page.images[0].box.width / page.width;
  assert.ok(share < 0.3, `the fixture picture is ${share} of the page`);
  const slide = plan(page);
  assert.equal(slide.type, 'image-text-slide');
  assert.equal(slide.content.layout, 'split');
  assert.equal(slide.content.imageSide, 'left');
  assert.equal(slide.content.imageWidth, 'narrow');
});

test('a picture on the right half is a half split on the right (Philips p4, p21)', () => {
  const page = textPage(
    [
      {
        kind: 'list',
        y: 100,
        variant: 'bullets',
        items: [{ text: 'One' }, { text: 'Two' }],
        box: box(43, 89, 317, 231),
      },
    ],
    { images: [image(box(360, 0, 360, 405))] },
  );
  const slide = plan(page);
  assert.equal(slide.type, 'image-text-slide');
  assert.deepEqual(
    [slide.content.layout, slide.content.imageSide, slide.content.imageWidth],
    ['split', 'right', 'half'],
  );
  // Two thirds of the page is the wide split.
  page.images[0] = image(box(240, 0, 480, 405));
  assert.equal(plan(page).content.imageWidth, 'wide');
});

test('a small picture in a top corner is the corner layout', () => {
  const page = textPage([para('A short line', box(40, 100, 300, 30))], {
    images: [image(box(560, 20, 140, 120))],
  });
  const slide = plan(page);
  assert.equal(slide.content.layout, 'corner');
  assert.equal(slide.content.imageSide, 'right');
  // The same picture lower down the page is a split.
  page.images[0] = image(box(560, 180, 140, 120));
  assert.equal(plan(page).content.layout, 'split');
});

// ---------------------------------------------------------------------------
// Two columns
// ---------------------------------------------------------------------------

test('two columns of blocks make a two-column text slide, stacked blocks one column', () => {
  const left = [
    para('Left top', box(40, 100, 300, 40)),
    para('Left bottom', box(40, 150, 300, 40)),
  ];
  const right = [
    para('Right top', box(380, 100, 300, 40)),
    para('Right bottom', box(380, 150, 300, 40)),
  ];
  const slide = plan(textPage([...left, ...right]));
  assert.equal(slide.type, 'content-slide');
  assert.equal(slide.content.layout, 'two-column');
  // The literal order stays: the left column, then the right one.
  assert.ok(
    slide.content.body.indexOf('Left bottom') <
      slide.content.body.indexOf('Right top'),
  );

  const stacked = [...left, para('Below', box(40, 200, 640, 40))];
  assert.equal(plan(textPage(stacked)).content.layout, 'one-column');
});

test('no two columns without a column order, or with more than two columns', () => {
  const l = para('Label', box(60, 120, 80, 20));
  const r = para('Value', box(200, 120, 400, 60));
  const page = textPage([r, l]);
  // The right block reads first: the slide's columns would swap them.
  assert.equal(inTwoColumns(page, page.blocks), false);
  assert.equal(inTwoColumns(page, [l, r]), true);
  // Three blocks in a row are no two columns (CIIIC p7, p10).
  const row = [
    para('One', box(40, 200, 180, 40)),
    para('Two', box(270, 200, 180, 40)),
    para('Three', box(500, 200, 180, 40)),
  ];
  assert.equal(inTwoColumns(page, row), false);
  // A model without boxes is one column.
  assert.equal(inTwoColumns(page, [{ kind: 'para' }, { kind: 'para' }]), false);
});

test('a list in two columns is a two-column list slide', () => {
  const list = (texts, b) => ({
    kind: 'list',
    y: b.y,
    variant: 'bullets',
    items: texts.map((text) => ({ text, parts: [text] })),
    box: b,
  });
  const slide = plan(
    textPage([
      list(['Alpha', 'Beta'], box(40, 100, 300, 80)),
      list(['Gamma', 'Delta'], box(380, 100, 300, 80)),
    ]),
  );
  assert.equal(slide.type, 'list-slide');
  assert.equal(slide.content.layout, 'two-column');
});

// ---------------------------------------------------------------------------
// The heading
// ---------------------------------------------------------------------------

test('a section title sits where the page set it, centred when the page centred it', () => {
  const chapter = (line) => plan(model({ heading: 'Part two', lines: [line] }));
  const atTop = chapter(headingLine('Part two', { y: 70 }));
  assert.equal(atTop.type, 'chapter-title-slide');
  assert.equal(atTop.content.layout, 'top');
  assert.equal(atTop.content.titleBlockAlign, 'left');
  // Philips p16 and p22: the heading at half height.
  assert.equal(
    chapter(headingLine('Part two', { y: 225 })).content.layout,
    'center',
  );
  assert.equal(
    chapter(headingLine('Part two', { y: 370 })).content.layout,
    'bottom',
  );
  const centred = chapter(
    headingLine('Part two', { x: 260, y: 225, width: 200 }),
  );
  assert.equal(centred.content.titleBlockAlign, 'center');
});

test('a centred heading centres the list slide header', () => {
  const items = ['Alpha', 'Beta', 'Gamma'].map((text) => ({
    text,
    parts: [text],
  }));
  const page = model({
    heading: 'Points',
    lines: [headingLine('Points', { x: 300, width: 120 })],
    blocks: [
      {
        kind: 'list',
        y: 120,
        variant: 'bullets',
        items,
        box: box(40, 100, 640, 100),
      },
    ],
  });
  assert.equal(plan(page).content.headerAlign, 'center');
  page.lines = [headingLine('Points', { x: 40, width: 120 })];
  assert.equal(plan(page).content.headerAlign, 'left');
});

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

const textOn = (color, over = {}) =>
  textPage(
    [
      para('Some text', box(40, 100, 300, 40)),
      para('More text', box(40, 150, 300, 40)),
    ],
    {
      background: { color },
      ...over,
    },
  );

test('a dark page takes the theme variant with light text, a theme without one the default', () => {
  const brand = theme('brand');
  const dark = brand.slideBackgrounds.find((v) => v.textColor === '#ffffff');
  assert.ok(dark, 'brand ships a dark variant');
  // Philips' blue pages.
  const slide = plan(textOn('#0b5ed7'), { theme: brand });
  assert.equal(slide.content.background, dark.id);
  assert.equal(backgroundOf(textOn('#06090b'), theme('amethyst')), 'calm');
  // corporate and midnight ship no variant: the default (midnight's is dark).
  for (const slug of ['corporate', 'midnight']) {
    assert.equal(backgroundOf(textOn('#0b5ed7'), theme(slug)), null, slug);
    assert.equal(
      plan(textOn('#0b5ed7'), { theme: theme(slug) }).content.background,
      'lime',
    );
  }
});

test('a tinted light page is mist, a white page the default', () => {
  // CIIIC's lime.
  assert.equal(
    plan(textOn('#e2fe52'), { theme: theme('brand') }).content.background,
    'mist',
  );
  assert.equal(backgroundOf(textOn('#ffffff'), theme('brand')), null);
  assert.equal(backgroundOf(textOn('#fbfbfb'), theme('brand')), null);
  assert.equal(backgroundOf(textOn(null)), null);
  assert.equal(backgroundOf(model({ background: null })), null);
});

test('a page whose colour a picture covers keeps the default (reviewnote B827)', () => {
  // A full-bleed photo over the white the extractor reports, and over a dark fill.
  const photo = { images: [image(box(0, 0, 720, 405))] };
  assert.equal(backgroundOf(textOn('#ffffff', photo), theme('brand')), null);
  assert.equal(backgroundOf(textOn('#0b5ed7', photo), theme('brand')), null);
});

test('a type without a background field gets none', () => {
  const slide = plan(
    model({
      heading: 'Part two',
      lines: [headingLine('Part two', { y: 225 })],
      background: { color: '#0b5ed7' },
    }),
    { theme: theme('brand') },
  );
  assert.equal(slide.type, 'chapter-title-slide');
  assert.equal('background' in slide.content, false);
});
