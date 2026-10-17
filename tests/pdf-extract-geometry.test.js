/**
 * Line assembly and both detectors of `server/utils/pdf-extract/` on
 * synthetic text runs (B751): no PDF, no browser. Untagged producers such as
 * Keynote give only runs and positions, so these pin what geometry alone must
 * find: words split across runs and ligature runs joined, list markers
 * stripped into a variant, the heading, aligned columns as a table. The last
 * tests feed a synthetic structure tree to the struct detector.
 *
 * Run with: node --test tests/pdf-extract-geometry.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assembleLines,
  detectGeometry,
  detectStruct,
  findDrawingLabels,
  isBoldFont,
  normalizeText,
  splitListMarker,
} from '../server/utils/pdf-extract/index.js';

const PAGE = { width: 720, height: 405 };

/** A run of `str` at (x, baseline y); width defaults to 0.5 em per char. */
function run(str, x, y, { size = 20, width, bold = false, mcid = null } = {}) {
  return {
    str,
    x,
    y,
    width: width ?? str.length * size * 0.5,
    size,
    bold,
    font: bold ? 'Sans-Bold' : 'Sans',
    mcid,
    artifact: false,
  };
}

/** Runs laid out one after another with no gap, as producers split words. */
function contiguous(parts, x, y, opts) {
  const runs = [];
  let at = x;
  for (const str of parts) {
    const r = run(str, at, y, opts);
    runs.push(r);
    at += r.width;
  }
  return runs;
}

test('words split across runs come out whole, spaces only at real gaps', () => {
  const lines = assembleLines([
    ...contiguous(['Fourth', ' quarter', ' results', ', 202', '5'], 40, 100),
  ]);
  assert.deepEqual(
    lines.map((l) => l.text),
    ['Fourth quarter results, 2025'],
  );
});

test('a ligature run is kept inside its word, whatever the run order', () => {
  const [a, b, c] = contiguous(['begr', 'ĳ', 'pen'], 40, 100);
  const lines = assembleLines([c, a, b]);
  assert.deepEqual(
    lines.map((l) => l.text),
    ['begrĳpen'],
  );
});

test('a gap wider than 0.2 em is a space; text is otherwise literal', () => {
  const lines = assembleLines([
    run('Hello', 40, 100, { width: 50 }),
    run('WORLD-wide', 96, 100.4, { width: 100 }),
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'Hello WORLD-wide');
  assert.equal(normalizeText('  a   b\n c  '), 'a b c');
});

test('lines sort top to bottom; a whitespace-only run is a space, not a line', () => {
  const lines = assembleLines([
    run('second', 40, 160),
    run('first', 40, 100, { width: 40 }),
    run(' ', 80, 100, { width: 2 }),
    run('line', 82, 100),
    run('   ', 40, 300),
  ]);
  assert.deepEqual(
    lines.map((l) => l.text),
    ['first line', 'second'],
  );
});

test('a large gap splits a line into segments (cells)', () => {
  const [line] = assembleLines([run('Sales', 40, 100), run('2,498', 300, 100)]);
  assert.equal(line.text, 'Sales 2,498');
  assert.deepEqual(
    line.segments.map((s) => s.text),
    ['Sales', '2,498'],
  );
});

test('bold comes from the font name; medium is not bold', () => {
  assert.equal(isBoldFont('NeueFrutigerWorld-Bold'), true);
  assert.equal(isBoldFont('ABCDEF+Inter-SemiBold'), true);
  assert.equal(isBoldFont('GTAmerica-ExtendedMedium'), false);
  assert.equal(isBoldFont('NeueFrutigerWorld-Book'), false);
});

test('list markers: glyph or number stripped, variant recorded', () => {
  assert.deepEqual(splitListMarker('• Faster onboarding'), {
    variant: 'bullets',
    text: 'Faster onboarding',
  });
  assert.deepEqual(splitListMarker('▸Next step'), {
    variant: 'bullets',
    text: 'Next step',
  });
  assert.deepEqual(splitListMarker('2) Do the work'), {
    variant: 'numbers',
    text: 'Do the work',
  });
  assert.equal(splitListMarker('-5% growth'), null);
  assert.equal(splitListMarker('2024 was good'), null);
});

test('geometry: the largest top line is the heading, bullets become a list', () => {
  const runs = [
    ...contiguous(['What we', ' learned'], 40, 60, { size: 36, bold: true }),
    run('•', 40, 120),
    run('Customers want', 70, 120),
    run('•', 40, 150),
    run('Pricing is ', 70, 150, { width: 100 }),
    run('clear', 170, 150),
    run('•', 40, 180),
    run('Mobile usage', 70, 180),
    run('doubled', 70, 205),
  ];
  const lines = assembleLines(runs);
  const result = detectGeometry(lines, PAGE);
  assert.equal(result.heading, 'What we learned');
  assert.equal(result.blocks.length, 1);
  const [list] = result.blocks;
  assert.equal(list.kind, 'list');
  assert.equal(list.variant, 'bullets');
  assert.deepEqual(
    list.items.map((i) => i.text),
    ['Customers want', 'Pricing is clear', 'Mobile usage doubled'],
  );
  assert.deepEqual(result.roles, [
    'heading',
    'list-item',
    'list-item',
    'list-item',
    'list-item',
  ]);
});

test('geometry: numbered items give variant numbers', () => {
  const lines = assembleLines([
    run('Three steps', 40, 60, { size: 36 }),
    run('1.', 40, 120, { width: 15 }),
    run('Plan', 62, 120),
    run('2.', 40, 150, { width: 15 }),
    run('Do', 62, 150),
    run('3.', 40, 180, { width: 15 }),
    run('Check', 62, 180),
  ]);
  const result = detectGeometry(lines, PAGE);
  assert.equal(result.heading, 'Three steps');
  assert.equal(result.blocks[0].kind, 'list');
  assert.equal(result.blocks[0].variant, 'numbers');
  assert.deepEqual(
    result.blocks[0].items.map((i) => i.text),
    ['Plan', 'Do', 'Check'],
  );
});

test('geometry: no heading when nothing stands out or it sits low on the page', () => {
  const same = assembleLines([
    run('One line', 40, 60),
    run('Another line', 40, 90),
    run('A third line', 40, 120),
  ]);
  assert.equal(detectGeometry(same, PAGE).heading, null);
  const low = assembleLines([
    run('Small', 40, 60),
    run('Big at the bottom', 40, 380, { size: 40 }),
  ]);
  assert.equal(detectGeometry(low, PAGE).heading, null);
});

test('geometry: aligned columns become a table, header row from bold', () => {
  const row = (y, cells, bold = false) =>
    cells.map((text, i) =>
      run(text, 40 + i * 160, y, { bold, width: text.length * 9 }),
    );
  const lines = assembleLines([
    run('Revenue by region', 40, 50, { size: 36 }),
    ...row(110, ['Region', 'Q3', 'Q4'], true),
    ...row(140, ['North', '120', '140']),
    ...row(170, ['South', '95', '110']),
  ]);
  const result = detectGeometry(lines, PAGE);
  assert.equal(result.heading, 'Revenue by region');
  assert.equal(result.blocks.length, 1);
  assert.deepEqual(result.blocks[0], {
    kind: 'table',
    y: 110,
    headerRow: true,
    rows: [
      ['Region', 'Q3', 'Q4'],
      ['North', '120', '140'],
      ['South', '95', '110'],
    ],
  });
});

test('geometry: paragraphs split at a vertical gap, lines joined by a space', () => {
  const lines = assembleLines([
    run('Title here', 40, 50, { size: 36 }),
    run('First paragraph', 40, 110),
    run('continues here.', 40, 135),
    run('Second paragraph.', 40, 220),
  ]);
  const { blocks } = detectGeometry(lines, PAGE);
  assert.deepEqual(
    blocks.map((b) => [b.kind, b.text]),
    [
      ['para', 'First paragraph continues here.'],
      ['para', 'Second paragraph.'],
    ],
  );
});

test('drawing labels: short lines amid many paths, only on drawing-heavy pages', () => {
  const lines = assembleLines([
    run('2024', 100, 200, { size: 10 }),
    run('Body text far away', 40, 380),
  ]);
  const near = Array.from({ length: 5 }, (_, i) => ({
    x: 95 + i * 4,
    y: 185,
    width: 3,
    height: 20,
  }));
  const far = Array.from({ length: 30 }, () => ({
    x: 600,
    y: 20,
    width: 10,
    height: 10,
  }));
  assert.deepEqual(
    [...findDrawingLabels(lines, { paths: 35, boxes: [...near, ...far] })],
    [0],
  );
  assert.deepEqual(
    [...findDrawingLabels(lines, { paths: 5, boxes: near })],
    [],
  );
});

/** A structure-tree node; `ids` become content leaves. */
const node = (role, children = [], extra = {}) => ({
  role,
  children,
  ...extra,
});
const content = (id) => ({ type: 'content', id });

test('struct: list labels stripped, table header, artifact-free roles', () => {
  const tree = node('Root', [
    node('Document', [
      node('H2', [content('m0')]),
      node('L', [
        node('LI', [
          node('Lbl', [content('m1')]),
          node('LBody', [content('m2')]),
        ]),
        node('LI', [
          node('Lbl', [content('m3')]),
          node('LBody', [content('m4')]),
        ]),
      ]),
      node('Table', [
        node('THead', [
          node('TR', [
            node('TH', [content('m5')]),
            node('TH', [content('m6')]),
          ]),
        ]),
        node('TBody', [
          node('TR', [
            node('TD', [content('m7')]),
            node('TD', [content('m8')]),
          ]),
        ]),
      ]),
    ]),
  ]);
  const runs = [
    run('Key takeaways', 40, 50, { size: 30, mcid: 'm0' }),
    run('1.', 40, 100, { mcid: 'm1', width: 15 }),
    run('Grew sales', 70, 100, { mcid: 'm2' }),
    run('2.', 40, 130, { mcid: 'm3', width: 15 }),
    run('Cut costs', 70, 130, { mcid: 'm4' }),
    run('Year', 40, 200, { mcid: 'm5' }),
    run('EUR', 300, 200, { mcid: 'm6' }),
    run('2024', 40, 230, { mcid: 'm7' }),
    run('1.7', 300, 230, { mcid: 'm8' }),
  ];
  const result = detectStruct(tree, runs, PAGE);
  assert.equal(result.heading, 'Key takeaways');
  assert.equal(result.headingSource, 'struct');
  assert.deepEqual(
    result.blocks.map((b) => b.kind),
    ['list', 'table'],
  );
  assert.equal(result.blocks[0].variant, 'numbers');
  assert.deepEqual(
    result.blocks[0].items.map((i) => i.text),
    ['Grew sales', 'Cut costs'],
  );
  assert.equal(result.blocks[1].headerRow, true);
  assert.deepEqual(result.blocks[1].rows, [
    ['Year', 'EUR'],
    ['2024', '1.7'],
  ]);
  assert.deepEqual(
    result.lines.filter((l) => l.role === 'list-label').map((l) => l.text),
    ['1.', '2.'],
  );
});

test('struct: repeated Divs with a heading and text become cards', () => {
  const card = (h, p) =>
    node('Div', [node('H3', [content(h)]), node('P', [content(p)])]);
  const tree = node('Root', [
    node('NonStruct', [
      node('H2', [content('t')]),
      card('a1', 'a2'),
      card('b1', 'b2'),
      card('c1', 'c2'),
    ]),
  ]);
  const runs = [
    run('Three pillars', 40, 50, { size: 30, mcid: 't' }),
    run('Alpha', 40, 120, { mcid: 'a1', bold: true }),
    run('First body', 40, 150, { mcid: 'a2' }),
    run('Beta', 260, 120, { mcid: 'b1', bold: true }),
    run('Second body', 260, 150, { mcid: 'b2' }),
    run('Gamma', 480, 120, { mcid: 'c1', bold: true }),
    run('Third body', 480, 150, { mcid: 'c2' }),
  ];
  const result = detectStruct(tree, runs, PAGE);
  assert.equal(result.heading, 'Three pillars');
  assert.deepEqual(result.blocks, [
    {
      kind: 'cards',
      y: 120,
      cards: [
        { title: 'Alpha', body: 'First body' },
        { title: 'Beta', body: 'Second body' },
        { title: 'Gamma', body: 'Third body' },
      ],
    },
  ]);
});

test('struct: a tree that reaches none of the runs defers to geometry', () => {
  const tree = node('Root', [node('P', [content('elsewhere')])]);
  assert.equal(
    detectStruct(tree, [run('Text', 40, 50, { mcid: 'x' })], PAGE),
    null,
  );
});
