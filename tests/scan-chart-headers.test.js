/**
 * The chart header scan (scripts/scan-chart-headers.js): which stored charts
 * had their first row plotted by the retired heuristic.
 *
 * The scan is a listing an admin acts on per deck (D86), so what has to be
 * right is *which* charts it names. That is the retired heuristic exactly:
 * row 0 was data when column 2 (bar/pie) or columns 2 and 3 (line) parsed as a
 * number. These cases pin that reading, including the one that looks wrong to a
 * human and is not.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  scanChartHeaders,
  scanDirectory,
  scanLibraryRow,
} from '../scripts/scan-chart-headers.js';

/** A chart slide as it is stored. */
const chartSlide = (id, chartType, data) => ({
  id,
  type: 'chart-slide',
  content: { title: 'Cijfers', chartType, data },
});

describe('scanChartHeaders', () => {
  it('flags a headerless bar chart', () => {
    const { charts, hits } = scanChartHeaders([
      chartSlide('s1', 'bar', 'A,10\nB,25'),
    ]);
    assert.strictEqual(charts, 1);
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].slideId, 's1');
    assert.strictEqual(hits[0].chartType, 'bar');
    assert.strictEqual(hits[0].data, 'A,10\nB,25');
  });

  it('flags a headerless three-column line chart', () => {
    const { hits } = scanChartHeaders([
      chartSlide('s1', 'line', 'Jan\t12\t8\nFeb\t13\t9'),
    ]);
    assert.strictEqual(hits.length, 1);
  });

  it('flags a two-column line chart (column 3 is missing, not numeric)', () => {
    const { hits } = scanChartHeaders([
      chartSlide('s1', 'line', 'Jan\t12\nFeb\t13'),
    ]);
    assert.strictEqual(hits.length, 1);
  });

  it('flags a year header, because the old parser plotted it', () => {
    // `Quarter,2023,2024` reads as a header to a human, but columns 2 and 3
    // parse as numbers, so the retired heuristic called the whole row data and
    // plotted "Quarter" as a point. That misreading is the D83 bug, and it is
    // exactly what an admin needs to see — so this IS a hit, and the right
    // action on it is usually "nothing, the chart is correct now".
    const { hits } = scanChartHeaders([
      chartSlide('s1', 'line', 'Quarter,2023,2024\nQ1,1,2'),
    ]);
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].data, 'Quarter,2023,2024\nQ1,1,2');
  });

  it('does not flag a prose header', () => {
    const { charts, hits } = scanChartHeaders([
      chartSlide('s1', 'bar', 'Product,Revenue\nA,10\nB,25'),
    ]);
    assert.strictEqual(charts, 1);
    assert.deepStrictEqual(hits, []);
  });

  it('ignores slides on another type', () => {
    const { charts, hits } = scanChartHeaders([
      { id: 's1', type: 'text', content: { body: 'A,10\nB,25' } },
    ]);
    assert.strictEqual(charts, 0);
    assert.deepStrictEqual(hits, []);
  });

  it('finds a chart inside a language version', () => {
    const deck = {
      id: 'd1',
      slides: [chartSlide('s1', 'bar', 'Product,Revenue\nA,10')],
      i18n: {
        dominant: 'nl',
        versions: {
          nl: { slides: [chartSlide('s1', 'bar', 'Product,Revenue\nA,10')] },
          'en-GB': { slides: [chartSlide('s1', 'bar', 'A,10\nB,25')] },
        },
      },
    };
    const { charts, hits } = scanChartHeaders(deck);
    assert.strictEqual(charts, 3);
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].data, 'A,10\nB,25');
  });
});

describe('scanLibraryRow', () => {
  it('scans the top-level content and every language version', () => {
    const row = {
      content: { chartType: 'bar', data: 'Product,Revenue\nA,10\nB,25' },
      i18n: {
        versions: {
          // No chartType of its own: the row's dominant content supplies it,
          // because the translation of a chart is the same chart.
          'en-GB': { content: { data: 'A,10\nB,25' } },
        },
      },
    };
    const { charts, hits } = scanLibraryRow(row);
    assert.strictEqual(charts, 2);
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].lang, 'en-GB');
    assert.strictEqual(hits[0].chartType, 'bar');
  });

  it('reports nothing for a library row with a header', () => {
    const { charts, hits } = scanLibraryRow({
      content: { chartType: 'bar', data: 'Product,Revenue\nA,10\nB,25' },
    });
    assert.strictEqual(charts, 1);
    assert.deepStrictEqual(hits, []);
  });
});

describe('scanDirectory', () => {
  it('counts the charts in deck JSON at rest', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'chart-headers-'));
    await writeFile(
      path.join(dir, 'deck.json'),
      JSON.stringify({
        id: 'd1',
        title: 'Cijferdeck',
        slides: [
          chartSlide('s1', 'bar', 'A,10\nB,25'),
          chartSlide('s2', 'bar', 'Product,Revenue\nA,10\nB,25'),
        ],
      }),
      'utf8',
    );
    await writeFile(path.join(dir, 'not-json.txt'), 'nope', 'utf8');

    const result = await scanDirectory(dir);
    assert.strictEqual(result.charts, 2);
    assert.strictEqual(result.hits, 1);
  });
});
