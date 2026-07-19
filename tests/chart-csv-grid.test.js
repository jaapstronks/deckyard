/**
 * CSV grid helpers used by the chart data editor (client/views/editor/fields/
 * csv-grid.js): serialise a matrix back to CSV, the lossless grid parse, and the
 * header-detection heuristic must all agree so the grid round-trips through the
 * string the chart parser eats.
 *
 * Run with: node --test tests/chart-csv-grid.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

const {
  serializeCsv,
  parseCsvToGrid,
  detectHeaderRow,
  parseChartData,
} = await import('../shared/slide-types/chart/parse.js');

describe('serializeCsv', () => {
  it('joins rows with commas and newlines', () => {
    assert.equal(
      serializeCsv([
        ['Label', 'Value'],
        ['A', '10'],
      ]),
      'Label,Value\nA,10'
    );
  });

  it('quotes cells containing comma, quote or newline (RFC 4180)', () => {
    assert.equal(
      serializeCsv([['a,b', 'c"d', 'e\nf']]),
      '"a,b","c""d","e\nf"'
    );
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

describe('detectHeaderRow', () => {
  it('treats a non-numeric first row as a header for bar/pie', () => {
    assert.equal(
      detectHeaderRow('bar', [
        ['Label', 'Value'],
        ['A', '10'],
      ]),
      true
    );
  });

  it('treats a numeric first row as data (no header) for bar/pie', () => {
    assert.equal(
      detectHeaderRow('pie', [
        ['A', '10'],
        ['B', '25'],
      ]),
      false
    );
  });

  it('detects a header for line charts across both series columns', () => {
    assert.equal(
      detectHeaderRow('line', [
        ['X', 'Revenue', 'Cost'],
        ['Jan', '12', '8'],
      ]),
      true
    );
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

  it('a synthesised header (no header in source) still parses correctly', () => {
    // Grid synthesises "Label,Value" for headerless data; the parser must then
    // detect it as a header and not treat it as a data point.
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
