/**
 * The markdown importer's chart route, and the one thing an author has to know
 * about it: a fenced `csv`/`tsv` block is taken verbatim, so its **first row
 * names the columns** (D83). The importer does not guess whether a header is
 * there - the parser stopped guessing, and a guess re-added at this boundary
 * would be the same defect one seam further out.
 *
 * Run with: node --test tests/markdown-import-chart-slide.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { parseMarkdownDeck } from '../server/utils/markdown-import/parse.js';
import { mapParsedDeckToSlides } from '../server/utils/markdown-import/map.js';
import { parseChartData } from '../shared/slide-types/types/chart-slide/parse.js';

const mapped = (md) => mapParsedDeckToSlides(parseMarkdownDeck(md)).slides;

describe('markdown import: a fenced csv block becomes a chart', () => {
  it('emits chart-slide and hands the block through unchanged', () => {
    const slides = mapped(
      [
        '# Revenue by product',
        '',
        '```csv',
        'Product,Revenue',
        'Electronics,450',
        'Software,380',
        '```',
      ].join('\n'),
    );

    assert.equal(slides.length, 1);
    assert.equal(slides[0].type, 'chart-slide');
    assert.equal(
      slides[0].content.data.trimEnd(),
      'Product,Revenue\nElectronics,450\nSoftware,380',
    );
  });

  it('the imported block parses with its header row as column names', () => {
    const slide = mapped(
      ['# Q', '', '```tsv', 'Quarter\t2023\t2024', 'Q1\t12\t14', 'Q2\t13\t16', '```', '', '---', ''].join('\n'),
    )[0];

    const parsed = parseChartData({
      chartType: 'line',
      data: slide.content.data,
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.dataset.series1Label, '2023');
    assert.deepEqual(parsed.dataset.x, ['Q1', 'Q2']);
  });
});
