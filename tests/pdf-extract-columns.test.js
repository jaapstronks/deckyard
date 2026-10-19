/**
 * Text columns on an untagged page are read column by column (B777), on
 * synthetic text runs: no PDF, no browser. A report set in two columns used
 * to come out line by line across both, and a shared baseline glued a line
 * of each column into one (on Philips's report a body line plus a section
 * heading, which then read as one heading). Tables and definition lists
 * keep their rows. The Philips report itself is pinned in
 * `pdf-document.test.js`.
 *
 * Run with: node --test tests/pdf-extract-columns.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assembleLines,
  detectGeometry,
} from '../server/utils/pdf-extract/index.js';
import { assembleColumnLines } from '../server/utils/pdf-extract/columns.js';

const PAGE = { width: 595, height: 842 };
const SIZE = 8;

/** A run of `str` at (x, baseline y); 0.5 em per char. */
function run(str, x, y, { size = SIZE, bold = false } = {}) {
  return {
    str,
    x,
    y,
    width: str.length * size * 0.5,
    size,
    bold,
    font: bold ? 'Sans-Bold' : 'Sans',
    mcid: null,
    artifact: false,
  };
}

/** One run per line of `lines`, starting at `y` with `step` leading. */
function column(lines, x, y, step = 11) {
  return lines.map((text, i) => run(text, x, y + i * step));
}

const LEFT = [
  'This document and the related oral presentation',
  'contain certain forward-looking statements with',
  'respect to the financial condition and results of',
  'operations and business of Philips and of its plans.',
];
const RIGHT = [
  'In presenting and discussing the financial position',
  'management uses certain non-IFRS financial measures',
  'which should not be viewed in isolation as an',
  'alternative to the equivalent IFRS measure itself.',
];

const texts = (lines) => lines.map((l) => l.text);

test('two columns on their own baselines read one column, then the next', () => {
  const runs = [
    run('Forward-looking statements and other information', 38, 55, {
      size: 22,
      bold: true,
    }),
    ...column(LEFT, 38, 110),
    ...column(RIGHT, 315, 114),
  ];
  assert.deepEqual(texts(assembleColumnLines(runs)), [
    'Forward-looking statements and other information',
    ...LEFT,
    ...RIGHT,
  ]);
  // Rows, as the slide import reads them, interleave the two.
  assert.equal(assembleLines(runs)[2].text, RIGHT[0]);
});

test('a shared baseline splits: a column heading is not glued to body text', () => {
  const runs = [
    ...column(LEFT, 38, 110),
    ...column(RIGHT, 315, 110),
    run('Use of non-IFRS information', 315, 154, { size: 11, bold: true }),
    run('and certain of the plans and objectives of Philips', 38, 154),
    ...column(['with respect to these items. Examples of forward-'], 38, 165),
    ...column(['management uses certain other measures as well'], 315, 165),
    ...column(['looking statements include statements made about'], 38, 176),
    ...column(['that do not have a standard meaning under IFRS'], 315, 176),
  ];
  const lines = assembleColumnLines(runs);
  assert.ok(
    lines.some((l) => l.text === 'Use of non-IFRS information' && l.bold),
  );
  assert.ok(!lines.some((l) => l.text.includes('Philips Use of non-IFRS')));
  const { blocks } = detectGeometry(lines, PAGE, { heading: false });
  assert.equal(blocks[0].text.split(' ')[0], 'This');
  assert.ok(blocks[0].text.endsWith('statements made about'));
  assert.ok(blocks.some((b) => b.text === 'Use of non-IFRS information'));
});

test('a paragraph does not run on from the foot of one column into the next', () => {
  const lines = assembleColumnLines([
    ...column(LEFT, 38, 110),
    ...column(RIGHT, 315, 114),
  ]);
  const { blocks } = detectGeometry(lines, PAGE, { heading: false });
  assert.deepEqual(
    blocks.map((b) => b.text),
    [LEFT.join(' '), RIGHT.join(' ')],
  );
});

test('a table keeps its rows: a value beside a label is no column', () => {
  const rows = [
    ['Sales', '5,062', '5,044'],
    ['Nominal sales growth', '(7%)', '0%'],
    ['Comparable sales growth', '(1%)', '1%'],
    ['Income from operations', '24', '199'],
  ];
  const runs = rows.flatMap(([label, a, b], i) => [
    run(label, 41, 117 + i * 11),
    run(a, 209, 117 + i * 11),
    run(b, 250, 117 + i * 11),
  ]);
  assert.deepEqual(assembleColumnLines(runs), assembleLines(runs));
});

test('a definition list keeps its rows: the term side has no line of its own', () => {
  const runs = [
    run('Adjusted EBITA', 38, 110),
    ...column(
      [
        'Income from operations excluding amortization and',
        'impairment of acquired intangible assets, and the',
        'restructuring and acquisition-related charges.',
      ],
      200,
      110,
    ),
    run('Free cash flow', 38, 146),
    ...column(
      [
        'Net cash from operating activities minus the net',
        'capital expenditures of the period, as reported.',
      ],
      200,
      146,
    ),
  ];
  assert.deepEqual(assembleColumnLines(runs), assembleLines(runs));
});

test('a page in one column comes back as the same lines', () => {
  const runs = column([...LEFT, ...RIGHT], 38, 110);
  assert.deepEqual(assembleColumnLines(runs), assembleLines(runs));
});
