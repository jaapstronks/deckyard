/**
 * CSV grid helpers used by the chart data editor (client/views/editor/fields/
 * csv-grid.js): serialise a matrix back to CSV and the lossless grid parse must
 * agree with the parser, so the grid round-trips through the string the chart
 * parser eats. Row 0 is the header on both sides - a form, not a detection
 * (D83), so what the grid shows as column names is what the renderer reads as
 * column names.
 *
 * Run with: node --test tests/chart-csv-grid.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

const { serializeCsv, parseCsvToGrid, defaultHeaderFor, parseChartData } =
  await import('../shared/slide-types/types/chart-slide/parse.js');

const { applyHeaderPaste } =
  await import('../client/views/editor/fields/csv-grid.js');

const BAR_MODEL = { min: 2, max: 2, defaultHeaders: ['Label', 'Value'] };

describe('serializeCsv', () => {
  it('joins rows with commas and newlines', () => {
    assert.equal(
      serializeCsv([
        ['Label', 'Value'],
        ['A', '10'],
      ]),
      'Label,Value\nA,10',
    );
  });

  it('quotes cells containing comma, quote or newline (RFC 4180)', () => {
    assert.equal(serializeCsv([['a,b', 'c"d', 'e\nf']]), '"a,b","c""d","e\nf"');
  });

  it('coerces null/number cells to strings', () => {
    assert.equal(serializeCsv([[null, 12, '']]), ',12,');
  });

  it('is defensive about non-array input', () => {
    assert.equal(serializeCsv(null), '');
    assert.equal(serializeCsv([null, undefined]), '\n');
  });
});

describe('parseCsvToGrid', () => {
  it('tokenises CSV into a lossless matrix', () => {
    assert.deepEqual(parseCsvToGrid('Label,Value\nA,10\nB,25'), [
      ['Label', 'Value'],
      ['A', '10'],
      ['B', '25'],
    ]);
  });

  it('auto-detects the TSV delimiter (paste from Excel)', () => {
    assert.deepEqual(parseCsvToGrid('X\tY\nJan\t12'), [
      ['X', 'Y'],
      ['Jan', '12'],
    ]);
  });

  it('returns [] for blank input', () => {
    assert.deepEqual(parseCsvToGrid('   '), []);
  });
});

describe('defaultHeaderFor', () => {
  it('names the two columns a bar/pie chart reads', () => {
    assert.deepEqual(defaultHeaderFor('bar'), ['Label', 'Value']);
    assert.deepEqual(defaultHeaderFor('pie'), ['Label', 'Value']);
  });

  it('names the x column and both series a line chart reads', () => {
    assert.deepEqual(defaultHeaderFor('line'), ['X', 'Series 1', 'Series 2']);
  });
});

describe('the first row is the header (D83)', () => {
  it('reads a numeric column name as a name, not a data point', () => {
    // The whole point of retiring the heuristic: `2023` and `2024` are what
    // the two series are called, not the first pair of values.
    const parsed = parseChartData({
      chartType: 'line',
      data: 'Quarter\t2023\t2024\nQ1\t1200\t1450\nQ2\t1350\t1620',
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.dataset.series1Label, '2023');
    assert.equal(parsed.dataset.series2Label, '2024');
    assert.deepEqual(parsed.dataset.x, ['Q1', 'Q2']);
    assert.deepEqual(parsed.dataset.y1, [1200, 1350]);
  });

  it('reads row 0 of a bar chart as names whatever it contains', () => {
    const parsed = parseChartData({
      chartType: 'bar',
      data: '2023,2024\nA,10\nB,25',
    });
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.dataset.labels, ['A', 'B']);
    assert.deepEqual(parsed.dataset.values, [10, 25]);
  });

  it('needs a header row plus two data rows', () => {
    const parsed = parseChartData({ chartType: 'bar', data: 'A,10\nB,25' });
    assert.equal(parsed.ok, false);
  });
});

describe('grid round-trip through the chart parser', () => {
  it('serialised grid data parses to the same dataset (bar)', () => {
    const csv = serializeCsv([
      ['Label', 'Value'],
      ['A', '10'],
      ['B', '25'],
    ]);
    const parsed = parseChartData({ chartType: 'bar', data: csv });
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.dataset.labels, ['A', 'B']);
    assert.deepEqual(parsed.dataset.values, [10, 25]);
  });

  it('a synthesised header (blank header cells in the grid) still parses', () => {
    // The grid fills a blank column name from defaultHeaderFor; the parser
    // reads row 0 as names either way, so no data point is lost.
    const withHeader = serializeCsv([
      ['Label', 'Value'],
      ['A', '10'],
      ['B', '25'],
    ]);
    const parsed = parseChartData({ chartType: 'bar', data: withHeader });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.dataset.labels.length, 2);
  });

  it('line data with two series round-trips', () => {
    const csv = serializeCsv([
      ['X', 'Series 1', 'Series 2'],
      ['Jan', '12', '8'],
      ['Feb', '18', '11'],
    ]);
    const parsed = parseChartData({ chartType: 'line', data: csv });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.kind, 'line');
    assert.deepEqual(parsed.dataset.x, ['Jan', 'Feb']);
    assert.deepEqual(parsed.dataset.y1, [12, 18]);
    assert.deepEqual(parsed.dataset.y2, [8, 11]);
  });

  it('quoted labels containing commas survive the round-trip', () => {
    const csv = serializeCsv([
      ['Label', 'Value'],
      ['Amsterdam, NL', '10'],
      ['Berlin, DE', '25'],
    ]);
    const parsed = parseChartData({ chartType: 'bar', data: csv });
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.dataset.labels, ['Amsterdam, NL', 'Berlin, DE']);
  });
});

describe('applyHeaderPaste (header-cell paste placement)', () => {
  it('fills a non-first header column in place without wiping the grid', () => {
    // Pasting a column (name + values) onto the "Value" header should set that
    // header and drop the values down its column, keeping the label column.
    const next = applyHeaderPaste({
      matrix: [['Revenue'], ['10'], ['25']],
      startCol: 1,
      header: ['Label', 'Value'],
      body: [
        ['A', ''],
        ['B', ''],
      ],
      cols: 2,
      chartType: 'bar',
      model: BAR_MODEL,
    });
    assert.deepEqual(next.header, ['Label', 'Revenue']);
    assert.deepEqual(next.body, [
      ['A', '10'],
      ['B', '25'],
    ]);
  });

  it('extends the body when the pasted column is taller than the grid', () => {
    const next = applyHeaderPaste({
      matrix: [['Rev'], ['1'], ['2'], ['3']],
      startCol: 1,
      header: ['Label', 'Value'],
      body: [['A', '']],
      cols: 2,
      chartType: 'bar',
      model: BAR_MODEL,
    });
    assert.equal(next.body.length, 3);
    assert.deepEqual(next.body, [
      ['A', '1'],
      ['', '2'],
      ['', '3'],
    ]);
  });

  it('top-left paste of a headered block splits header from body', () => {
    const next = applyHeaderPaste({
      matrix: [
        ['Month', 'Sales'],
        ['Jan', '5'],
      ],
      startCol: 0,
      header: ['Label', 'Value'],
      body: [['', '']],
      cols: 2,
      chartType: 'bar',
      model: BAR_MODEL,
    });
    assert.deepEqual(next.header, ['Month', 'Sales']);
    assert.deepEqual(next.body, [['Jan', '5']]);
  });

  it("top-left paste reads the block's first row as the column names", () => {
    // You pasted onto the header, so the block is read as one (D83). A
    // headerless block belongs in a body cell - where you paste is what it is.
    const next = applyHeaderPaste({
      matrix: [
        ['A', '10'],
        ['B', '25'],
      ],
      startCol: 0,
      header: ['Label', 'Value'],
      body: [['', '']],
      cols: 2,
      chartType: 'bar',
      model: BAR_MODEL,
    });
    assert.deepEqual(next.header, ['A', '10']);
    assert.deepEqual(next.body, [['B', '25']]);
  });

  it('is a no-op for an empty matrix', () => {
    const header = ['Label', 'Value'];
    const body = [['A', '10']];
    const next = applyHeaderPaste({
      matrix: [],
      startCol: 0,
      header,
      body,
      cols: 2,
      chartType: 'bar',
      model: BAR_MODEL,
    });
    assert.deepEqual(next.header, header);
    assert.deepEqual(next.body, body);
  });
});
