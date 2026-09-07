/**
 * The three chart SVG renderers, pinned by shape rather than by snapshot.
 *
 * Nothing tested these before B196, which is how bar drew its bars on one
 * scale and its gridlines on another for as long as it did. The assertions
 * here are the invariants a reader of the picture relies on: a mark sits where
 * its own axis label says it does, and everything drawn stays inside the plot.
 *
 * Run with: node --test tests/chart-renderers.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

const { makeAxis } =
  await import('../shared/slide-types/types/chart-slide/ticks.js');
const { renderBarSvg } =
  await import('../shared/slide-types/types/chart-slide/render-bar.js');
const { renderLineSvg } =
  await import('../shared/slide-types/types/chart-slide/render-line.js');
const { renderPieSvg } =
  await import('../shared/slide-types/types/chart-slide/render-pie.js');
const { parseChartData } =
  await import('../shared/slide-types/types/chart-slide/parse.js');

/** Every `<rect class="chart-bar …">` as `{ y, height }`. */
function barRects(svg) {
  return [
    ...svg.matchAll(
      /<rect class="chart-bar[^"]*"[^>]*\sy="(-?[\d.]+)"[^>]*\sheight="(-?[\d.]+)"/g,
    ),
  ].map((m) => ({ y: Number(m[1]), height: Number(m[2]) }));
}

/** The `y` of every gridline, in draw order (top tick last). */
function gridYs(svg) {
  return [
    ...svg.matchAll(/<line [^>]*\sy1="(-?[\d.]+)"[^>]*class="chart-grid"/g),
  ].map((m) => Number(m[1]));
}

/**
 * Every *value*-axis tick label as `{ y, text }`. The category labels under the
 * plot share the class, so the end-anchor is what separates the two.
 */
function tickLabels(svg) {
  return [
    ...svg.matchAll(
      /<text x="-?[\d.]+" y="(-?[\d.]+)" text-anchor="end" class="chart-axis-label"[^>]*>([^<]*)<\/text>/g,
    ),
  ].map((m) => ({ y: Number(m[1]), text: m[2] }));
}

describe('makeAxis', () => {
  it('maps the tick ladder onto the plot rectangle, ends included', () => {
    const axis = makeAxis({
      min: 0,
      max: 7,
      top: 40,
      height: 500,
      forceMinZero: true,
    });
    assert.deepEqual(axis.ticks, [0, 2, 4, 6, 8]);
    assert.equal(axis.toY(8), 40, 'top tick sits at the plot top');
    assert.equal(axis.toY(0), 540, 'zero sits at the plot bottom');
    assert.equal(axis.toY(4), 290, 'the middle tick sits halfway');
  });

  it('extends the ladder below zero when a value is negative', () => {
    const axis = makeAxis({ min: -5, max: 15, top: 0, height: 100 });
    assert.equal(axis.domainMin, -5);
    assert.equal(axis.domainMax, 15);
    assert.ok(axis.ticks.includes(0), 'zero stays a tick');
  });

  it('survives a degenerate range without dividing by zero', () => {
    const axis = makeAxis({ min: 0, max: 0, top: 0, height: 100 });
    assert.ok(Number.isFinite(axis.toY(0)));
    assert.ok(axis.domainMax > axis.domainMin);
  });
});

describe('renderBarSvg', () => {
  it('draws a bar against its own gridline, not against the data maximum', () => {
    // 0–8 ladder over a maximum of 7: before B196 the tallest bar was scaled
    // on maxV and filled the plot, so a 7 was drawn at the "8" gridline.
    const svg = renderBarSvg({ labels: ['A', 'B', 'C'], values: [3, 5, 7] });
    const rects = barRects(svg);
    const grids = gridYs(svg);
    const labels = tickLabels(svg);

    assert.equal(rects.length, 3);
    const top = labels.find((l) => l.text === '8');
    const six = labels.find((l) => l.text === '6');
    assert.ok(top && six, 'the ladder is labelled 0…8');
    assert.ok(
      rects[2].y > top.y,
      'the tallest bar stops below the top gridline',
    );
    assert.ok(
      rects[2].y < six.y,
      'and above the gridline one step under its value',
    );
    // 7 of 8 is exactly seven eighths of the way up from the baseline.
    const baseline = Math.max(...grids);
    const plotHeight = baseline - Math.min(...grids);
    assert.ok(
      Math.abs(rects[2].height - (7 / 8) * plotHeight) < 0.001,
      'the bar is 7/8 of the plot, the fraction its ladder claims',
    );
  });

  it('scales every bar on the same axis', () => {
    const svg = renderBarSvg({ labels: ['A', 'B'], values: [10, 20] });
    const rects = barRects(svg);
    assert.ok(
      Math.abs(rects[1].height - rects[0].height * 2) < 0.001,
      'twice the value is twice the bar',
    );
  });

  it('draws a negative value downwards, never as a negative height', () => {
    // The old scale produced height="-168" for this dataset: an invalid rect
    // the browser drops, so the bar vanished.
    const svg = renderBarSvg({ labels: ['A', 'B', 'C'], values: [10, -5, 15] });
    const rects = barRects(svg);
    for (const r of rects) assert.ok(r.height >= 0, 'no negative heights');
    // Ladder -5…15, so the zero gridline is the second one drawn.
    const zeroY = gridYs(svg)[1];
    assert.equal(tickLabels(svg)[1].text, '0', 'zero is the second tick');
    assert.ok(
      Math.abs(rects[1].y - zeroY) < 0.001,
      'the negative bar starts at the baseline',
    );
    assert.ok(rects[1].height > 0, 'and hangs below it');
  });

  it('keeps every gridline inside the plot', () => {
    const svg = renderBarSvg({ labels: ['A', 'B'], values: [1.1, 0.4] });
    for (const y of gridYs(svg)) {
      assert.ok(y >= 0 && y <= 620, `gridline at ${y} is outside the viewBox`);
    }
  });

  it('labels values only when asked, escaped through svgText', () => {
    const plain = renderBarSvg({ labels: ['A'], values: [3] });
    assert.ok(!plain.includes('chart-value'));
    const shown = renderBarSvg(
      { labels: ['A'], values: [3] },
      { showValues: true },
    );
    assert.ok(shown.includes('class="chart-value"'));
  });

  it('names its axes only when given titles', () => {
    const bare = renderBarSvg({ labels: ['A'], values: [1] });
    assert.ok(!bare.includes('chart-axis-title'));
    const titled = renderBarSvg(
      { labels: ['A'], values: [1] },
      { xAxisLabel: 'Quarter', yAxisLabel: 'Revenue' },
    );
    assert.ok(titled.includes('>Quarter</text>'));
    assert.ok(titled.includes('>Revenue</text>'));
  });
});

describe('renderLineSvg', () => {
  it('keeps every gridline inside the plot', () => {
    // Ladder 0–1.5 over a maximum of 1.1: the top gridline used to be drawn
    // on the data extent, which put it at y=-135, off the canvas.
    const svg = renderLineSvg({ x: ['a', 'b', 'c'], y1: [1.1, 0.4, 0.9] });
    const grids = gridYs(svg);
    assert.ok(grids.length >= 2);
    for (const y of grids) {
      assert.ok(y >= 0 && y <= 620, `gridline at ${y} is outside the viewBox`);
    }
  });

  it('puts a point on the gridline its tick labels describe', () => {
    // Ladder 0…10, so the first gridline is zero and the last is the maximum.
    const svg = renderLineSvg({ x: ['a', 'b'], y1: [0, 10] });
    const grids = gridYs(svg);
    const labels = tickLabels(svg).map((l) => l.text);
    assert.equal(labels[0], '0');
    assert.equal(labels[labels.length - 1], '10');
    const points = [
      ...svg.matchAll(
        /<circle class="chart-point chart-point-1"[^>]*cy="(-?[\d.]+)"/g,
      ),
    ].map((m) => Number(m[1]));
    assert.equal(points.length, 2);
    assert.ok(Math.abs(points[0] - grids[0]) < 0.001, 'zero on the baseline');
    assert.ok(
      Math.abs(points[1] - grids[grids.length - 1]) < 0.001,
      'the maximum on the top gridline',
    );
  });

  it('draws a second series only when there is one', () => {
    const one = renderLineSvg({ x: ['a', 'b'], y1: [1, 2] });
    assert.ok(!one.includes('chart-point-2'));
    const two = renderLineSvg({ x: ['a', 'b'], y1: [1, 2], y2: [3, 4] });
    assert.ok(two.includes('chart-point-2'));
  });

  it('bridges a gap instead of breaking the line', () => {
    const svg = renderLineSvg({ x: ['a', 'b', 'c'], y1: [1, null, 3] });
    const segments = [...svg.matchAll(/class="chart-line chart-line-1"/g)];
    assert.equal(segments.length, 1, 'one segment spans the missing point');
  });

  it('gives each point its own fragment so stepping can reveal them', () => {
    const svg = renderLineSvg({ x: ['a', 'b', 'c'], y1: [1, 2, 3] });
    assert.equal([...svg.matchAll(/class="chart-frag"/g)].length, 3);
  });
});

describe('renderPieSvg', () => {
  it('draws one slice per non-zero entry', () => {
    const svg = renderPieSvg({
      labels: ['A', 'B', 'C', 'D'],
      values: [50, 30, 20, 0],
    });
    assert.equal(
      [...svg.matchAll(/class="chart-slice chart-slice-/g)].length,
      3,
    );
  });

  it('closes the circle: the last slice ends where the first began', () => {
    const svg = renderPieSvg({ labels: ['A', 'B'], values: [1, 3] });
    const paths = [
      ...svg.matchAll(/<path class="chart-slice[^"]*" d="([^"]+)"/g),
    ].map((m) => m[1]);
    assert.equal(paths.length, 2);
    // Every arc starts at the centre (800, 310) and returns to it (Z).
    for (const d of paths) {
      assert.ok(d.startsWith('M 800 310 L'), d);
      assert.ok(d.trim().endsWith('Z'), d);
    }
  });

  it('honours the label mode', () => {
    const ds = { labels: ['A', 'B'], values: [3, 1] };
    assert.ok(renderPieSvg(ds, { pieLabelMode: '%' }).includes('>75%<'));
    assert.ok(renderPieSvg(ds, { pieLabelMode: 'value' }).includes('>3<'));
    assert.ok(renderPieSvg(ds, { pieLabelMode: 'both' }).includes('>3 (75%)<'));
    assert.ok(
      !renderPieSvg(ds, { pieLabelMode: 'none' }).includes('chart-pie-label'),
    );
  });
});

describe('the bar/pie parser reads one series', () => {
  it('takes column 2 and ignores anything after it', () => {
    // The AI examples used to show a three-column bar; the parser never read
    // the third column, so the agent got a chart it did not ask for.
    const parsed = parseChartData({
      chartType: 'bar',
      data: 'Quarter\tFY 2023\tFY 2024\nQ1\t1200\t1450\nQ2\t1350\t1620',
    });
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.dataset, {
      labels: ['Q1', 'Q2'],
      values: [1200, 1350],
    });
  });

  it('reads column 3 as a second series for line, and only for line', () => {
    const parsed = parseChartData({
      chartType: 'line',
      data: 'Quarter\tFY 2023\tFY 2024\nQ1\t1200\t1450\nQ2\t1350\t1620',
    });
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.dataset.y2, [1450, 1620]);
  });
});
