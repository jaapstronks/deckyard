/**
 * Colour and boxes in the page model (B827): `extractPdfPages()` gives every
 * page its background colour, every line its colour, every block its box,
 * and the drawing the paths a tagged table owns and its own box. Pinned on
 * the two committed fixtures (`slide-deck-tagged.pdf`, four pages printed
 * by Chrome without a CSS background; `chart-slide-tagged.pdf`, one lime
 * chart slide from Deckyard's own export) and on synthetic operator lists,
 * so no test starts a browser.
 *
 * Run with: node --test tests/pdf-extract-colour-boxes.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  extractPdfPages,
  detectGeometry,
  assembleLines,
} from '../server/utils/pdf-extract/index.js';
import {
  colorFromArgs,
  readPageGraphics,
  PAGE_WHITE,
} from '../server/utils/pdf-extract/images.js';
import { readTextRuns } from '../server/utils/pdf-extract/text-runs.js';
import { OPS } from '../server/utils/pdf-extract/pdfjs.js';
import {
  lineBox,
  overlapArea,
  unionBoxes,
  liesWithin,
} from '../server/utils/pdf-extract/boxes.js';

const deck = await extractPdfPages(
  await fs.readFile(
    new URL('./fixtures/slide-deck-tagged.pdf', import.meta.url),
  ),
);
const chart = (
  await extractPdfPages(
    await fs.readFile(
      new URL('./fixtures/chart-slide-tagged.pdf', import.meta.url),
    ),
  )
).pages[0];

const insidePage = (box, page) =>
  box.x >= 0 &&
  box.y >= 0 &&
  box.x + box.width <= page.width + 0.5 &&
  box.y + box.height <= page.height + 0.5;

test('fixture: every page has a background colour, white where nothing covers the page', () => {
  for (const p of deck.pages)
    assert.deepEqual(p.background, { color: '#ffffff' });
  assert.equal(PAGE_WHITE, '#ffffff');
});

test('fixture: every block carries a box inside the page that holds its lines', () => {
  for (const p of deck.pages) {
    assert.ok(p.blocks.length > 0, `page ${p.page} has blocks`);
    for (const block of p.blocks) {
      assert.ok(block.box, `${block.kind} on page ${p.page} has a box`);
      assert.ok(insidePage(block.box, p), `box inside page ${p.page}`);
      assert.ok(block.box.width > 0 && block.box.height > 0);
    }
  }
  const [list] = deck.pages[1].blocks;
  const items = deck.pages[1].lines.filter((l) => l.role === 'list-item');
  assert.equal(items.length, 4);
  for (const line of items) {
    assert.ok(
      liesWithin(lineBox(line), list.box, 0.99),
      `${line.text} in the list box`,
    );
  }
  // Blocks under each other do not overlap.
  const [subtitle, date] = deck.pages[0].blocks;
  assert.equal(overlapArea(subtitle.box, date.box), 0);
  assert.ok(date.box.y > subtitle.box.y);
});

test('fixture: every line carries its colour; the date on the title page is grey', () => {
  for (const p of deck.pages) {
    for (const line of p.lines) assert.match(line.color, /^#[0-9a-f]{6}$/);
  }
  const [heading, subtitle, date] = deck.pages[0].lines;
  assert.equal(heading.color, '#111111');
  assert.equal(subtitle.color, '#111111');
  assert.equal(date.color, '#555555');
});

test('fixture: the table page owns its paths, so it has no drawing', () => {
  const p = deck.pages[3];
  assert.ok(p.drawing.paths > 0);
  assert.ok(p.drawing.tablePaths > 0);
  assert.ok(p.drawing.tablePaths <= p.drawing.paths);
  assert.equal(p.drawing.box, null);
  for (const other of deck.pages.filter((q) => q.page !== 4)) {
    assert.equal(other.drawing.tablePaths, 0);
  }
});

test('fixture: a page without free paths has no drawing box; bullets drawn as paths give one beside the list', () => {
  assert.equal(deck.pages[0].drawing.box, null);
  assert.equal(deck.pages[2].drawing.box, null);
  const bullets = deck.pages[1].drawing.box;
  const [list] = deck.pages[1].blocks;
  assert.ok(bullets);
  assert.ok(bullets.x + bullets.width <= list.box.x);
  assert.equal(overlapArea(bullets, list.box), 0);
});

test('chart fixture: the slide colour is the last fill covering the page', () => {
  assert.deepEqual(chart.background, { color: '#e2fe52' });
});

test('chart fixture: the drawing box lies outside the heading and holds every label', () => {
  const box = chart.drawing.box;
  assert.ok(box);
  assert.ok(insidePage(box, chart));
  const heading = chart.lines.find((l) => l.role === 'heading');
  assert.equal(overlapArea(lineBox(heading), box), 0);
  assert.ok(box.y > heading.y);
  for (const label of chart.lines.filter((l) => l.role === 'label')) {
    assert.ok(
      liesWithin(lineBox(label), box, 0.99),
      `${label.text} in the box`,
    );
  }
  assert.equal(chart.drawing.tablePaths, 0);
  assert.ok(chart.drawing.paths > 0);
});

test('colorFromArgs reads hex strings, byte arrays and fractions; a pattern has no colour', () => {
  assert.equal(colorFromArgs(['#0B5ED7']), '#0b5ed7');
  assert.equal(
    colorFromArgs([new Uint8ClampedArray([255, 0, 128])]),
    '#ff0080',
  );
  assert.equal(colorFromArgs([1, 1, 1]), '#010101');
  assert.equal(colorFromArgs([0.5, 1, 0]), '#80ff00');
  assert.equal(colorFromArgs([{ name: 'Pattern' }]), null);
  assert.equal(colorFromArgs(['Pattern']), null);
  assert.equal(colorFromArgs(undefined), null);
});

/** A fake pdf.js page and viewport: identity coordinates, no images. */
const viewport = (width, height) => ({
  width,
  height,
  convertToViewportPoint: (x, y) => [x, height - y],
});
const fakePage = {
  objs: { has: () => false },
  commonObjs: { has: () => false },
};
const rect = (op, x0, y0, x1, y1) => [op, [], [x0, y0, x1, y1]];
const glyphs = (text) => [[...text].map((unicode) => ({ unicode }))];

function graphicsOf(ops) {
  return readPageGraphics(
    fakePage,
    { fnArray: ops.map((o) => o[0]), argsArray: ops.map((o) => o[1]) },
    viewport(100, 100),
  );
}

test('readPageGraphics: the background is the last solid fill covering the page', async () => {
  const g = await graphicsOf([
    [OPS.setFillRGBColor, ['#ffffff']],
    [OPS.constructPath, rect(OPS.fill, 0, 0, 100, 100)],
    [OPS.setFillRGBColor, ['#e2fe52']],
    [OPS.constructPath, rect(OPS.fill, 0, 0, 100, 100)],
    [OPS.setFillRGBColor, ['#ff0000']],
    [OPS.constructPath, rect(OPS.fill, 0, 0, 50, 50)],
    [OPS.setStrokeRGBColor, ['#00ff00']],
    [OPS.constructPath, rect(OPS.stroke, 0, 0, 100, 100)],
  ]);
  assert.deepEqual(g.background, { color: '#e2fe52' });
  assert.deepEqual(
    g.paths.map((p) => [p.color, p.filled]),
    [
      ['#ffffff', true],
      ['#e2fe52', true],
      ['#ff0000', true],
      ['#00ff00', false],
    ],
  );
});

test('readPageGraphics: no covering fill is white, only a pattern is null, a pattern over a colour keeps it, a clip has no colour', async () => {
  const white = await graphicsOf([
    [OPS.setFillRGBColor, ['#123456']],
    [OPS.constructPath, rect(OPS.fill, 0, 0, 80, 80)],
  ]);
  assert.deepEqual(white.background, { color: '#ffffff' });
  const pattern = await graphicsOf([
    [OPS.setFillColorN, [{ name: 'Pattern' }]],
    [OPS.constructPath, rect(OPS.fill, 0, 0, 100, 100)],
    [OPS.constructPath, rect(OPS.endPath, 0, 0, 100, 100)],
  ]);
  assert.equal(pattern.background, null);
  assert.deepEqual(
    pattern.paths.map((p) => p.color),
    [null, null],
  );
  // Deckyard's dark slide: a solid colour, then a texture over it.
  const textured = await graphicsOf([
    [OPS.setFillRGBColor, ['#06090b']],
    [OPS.constructPath, rect(OPS.fill, 0, 0, 100, 100)],
    [OPS.setFillColorN, [{ name: 'Pattern' }]],
    [OPS.constructPath, rect(OPS.fill, 0, 0, 100, 100)],
  ]);
  assert.deepEqual(textured.background, { color: '#06090b' });
  // The colour set inside save/restore does not leak out.
  const scoped = await graphicsOf([
    [OPS.setFillRGBColor, ['#111111']],
    [OPS.save, []],
    [OPS.setFillRGBColor, ['#222222']],
    [OPS.restore, []],
    [OPS.constructPath, rect(OPS.fill, 0, 0, 100, 100)],
  ]);
  assert.deepEqual(scoped.background, { color: '#111111' });
});

test('readPageGraphics: every showText is recorded with its fill colour and marked content', async () => {
  const g = await graphicsOf([
    [OPS.setFillRGBColor, ['#0b5ed7']],
    [OPS.beginMarkedContentProps, ['P', 3]],
    [OPS.showText, glyphs('Hea')],
    [OPS.showText, [[{ unicode: 'd' }, -250, { unicode: 'ing' }]]],
    [OPS.endMarkedContent, []],
    [OPS.setFillRGBColor, ['#000000']],
    [OPS.showText, glyphs('Body')],
  ]);
  assert.deepEqual(g.textPaints, [
    { text: 'Hea', color: '#0b5ed7', mcid: 3 },
    { text: 'ding', color: '#0b5ed7', mcid: 3 },
    { text: 'Body', color: '#000000', mcid: null },
  ]);
});

const item = (str, x, y, extra = {}) => ({
  str,
  transform: [12, 0, 0, 12, x, y],
  width: str.length * 6,
  fontName: 'f1',
  ...extra,
});
const mc = (id) => ({ type: 'beginMarkedContentProps', tag: 'P', id });
const end = () => ({ type: 'endMarkedContent' });

test('readTextRuns: runs take the colour of the paints their characters came from, split or merged', () => {
  const textContent = {
    items: [
      mc('p1R_mc0'),
      item('Growth across', 10, 90),
      item(' ', 50, 90),
      item('every region', 60, 90),
      end(),
      mc('p1R_mc1'),
      item('Up 10%', 10, 60),
      end(),
      item('loose', 10, 30),
    ],
  };
  const runs = readTextRuns(textContent, {
    viewport: viewport(100, 100),
    textPaints: [
      { text: 'Gr', color: '#111111', mcid: 0 },
      { text: 'owth acr', color: '#111111', mcid: 0 },
      { text: 'oss every r', color: '#111111', mcid: 0 },
      { text: 'egion', color: '#111111', mcid: 0 },
      { text: 'Up ', color: '#555555', mcid: 1 },
      { text: '10%', color: '#ff0000', mcid: 1 },
      { text: 'loose', color: '#00ff00', mcid: null },
    ],
  });
  assert.deepEqual(
    runs.map((r) => [r.str, r.color]),
    [
      ['Growth across', '#111111'],
      [' ', '#111111'],
      ['every region', '#111111'],
      ['Up 10%', '#ff0000'],
      ['loose', '#00ff00'],
    ],
  );
});

test('readTextRuns: a group whose characters do not add up takes the colour most of its paints share; no paints means no colour', () => {
  const textContent = {
    items: [mc('p1R_mc0'), item('Twelve chars', 10, 90), end()],
  };
  const [mismatch] = readTextRuns(textContent, {
    viewport: viewport(100, 100),
    textPaints: [
      { text: 'Twelve', color: '#aaaaaa', mcid: 0 },
      { text: 'c', color: '#bbbbbb', mcid: 0 },
    ],
  });
  assert.equal(mismatch.color, '#aaaaaa');
  const [none] = readTextRuns(textContent, { viewport: viewport(100, 100) });
  assert.equal(none.color, null);
});

test('assembleLines: a line is the colour of its largest run', () => {
  const run = (str, x, size, color) => ({
    str,
    x,
    y: 50,
    width: str.length * size * 0.5,
    size,
    bold: false,
    font: '',
    color,
    mcid: null,
    artifact: false,
  });
  const [line] = assembleLines([
    run('big', 10, 20, '#ff0000'),
    run('small', 60, 10, '#0000ff'),
  ]);
  assert.equal(line.text, 'big small');
  assert.equal(line.color, '#ff0000');
});

test('detectGeometry: a box per block, index-aligned, around the block lines', () => {
  const run = (str, x, y, size = 12) => ({
    str,
    x,
    y,
    width: str.length * size * 0.5,
    size,
    bold: false,
    font: '',
    color: null,
    mcid: null,
    artifact: false,
  });
  const lines = assembleLines([
    run('Title', 40, 50, 36),
    run('• First item', 40, 110),
    run('• Second item', 40, 125),
    run('A paragraph', 40, 200),
  ]);
  const result = detectGeometry(lines, { width: 720, height: 405 });
  assert.equal(result.blocks.length, result.boxes.length);
  assert.deepEqual(
    result.blocks.map((b) => b.kind),
    ['list', 'para'],
  );
  const round = (box) =>
    Object.fromEntries(
      Object.entries(box).map(([k, v]) => [k, Math.round(v * 1000) / 1000]),
    );
  const [list, para] = result.boxes.map(round);
  assert.deepEqual(
    list,
    round(unionBoxes([lineBox(lines[1]), lineBox(lines[2])])),
  );
  assert.deepEqual(para, round(lineBox(lines[3])));
  assert.ok(
    !('box' in result.blocks[0]),
    'the detector block itself stays as 1a pinned it',
  );
});
