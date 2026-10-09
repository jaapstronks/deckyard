/**
 * The analytics timeline draws on the slide chart's axis (B236).
 *
 * It used to label its five gridlines `Math.round(i / 5 * max)` while placing
 * them at `i / 5` of the height: over a 0–7 range the second gridline read "1"
 * at a height of 1.4, and a maximum of 1 read 0, 0, 0, 1, 1, 1. That is the
 * #1110 defect in another file — the labels and the marks on two domains. Now
 * gridlines, labels and bars all come from one `makeAxis`, in whole steps.
 *
 * Run with: node --test tests/analytics-timeline-axis.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.SVGElement = dom.window.SVGElement;

const { createTimelineChart } =
  await import('../client/views/analytics/timeline-chart.js');
const { makeAxis } =
  await import('../shared/slide-types/types/chart-slide/ticks.js');

function render(views) {
  const data = views.map((v, i) => ({
    date: `2026-10-0${i + 1}`,
    views: v,
  }));
  return createTimelineChart({ data }).el;
}

/** Gridline y → its label text, read off the drawn SVG. */
function ladder(el) {
  const lines = [...el.querySelectorAll('line.analytics-chart-grid')];
  const labels = [...el.querySelectorAll('text.analytics-chart-label-y')];
  return lines.map((line, i) => ({
    y: Number(line.getAttribute('y1')),
    label: Number(labels[i].textContent),
  }));
}

describe('analytics timeline axis', () => {
  it('labels every gridline with the value at its height', () => {
    const el = render([7, 3, 0]);
    const rungs = ladder(el);
    const top = rungs.at(-1);
    const foot = rungs[0];
    assert.equal(foot.label, 0);
    for (const { y, label } of rungs) {
      const expected =
        foot.label +
        ((foot.y - y) / (foot.y - top.y)) * (top.label - foot.label);
      assert.ok(
        Math.abs(expected - label) < 1e-9,
        `gridline at ${y} reads ${label}`,
      );
    }
    assert.ok(top.label >= 7, 'the ladder covers the maximum');
  });

  it('draws a bar to the gridline that names its value', () => {
    const el = render([4, 2]);
    const rungs = ladder(el);
    const bar = el.querySelector('rect[data-views="4"]');
    const four = rungs.find((r) => r.label === 4);
    assert.ok(four, 'a 0–4 range has a gridline at 4');
    assert.equal(Number(bar.getAttribute('y')), four.y);
    assert.equal(
      Number(bar.getAttribute('y')) + Number(bar.getAttribute('height')),
      rungs[0].y,
      'the bar stands on the zero line',
    );
  });

  it('counts in whole steps, without duplicate labels', () => {
    for (const views of [[1], [0, 0], [2, 1], [13, 5]]) {
      const labels = ladder(render(views)).map((r) => r.label);
      assert.ok(labels.every(Number.isInteger), `${labels} are whole`);
      assert.equal(new Set(labels).size, labels.length, `${labels} unique`);
    }
  });
});

describe('makeAxis minStep', () => {
  it('keeps the nice step when it is already larger', () => {
    const axis = makeAxis({
      min: 0,
      max: 100,
      top: 0,
      height: 100,
      minStep: 1,
    });
    assert.deepEqual(axis.ticks, [0, 20, 40, 60, 80, 100]);
  });

  it('raises a fractional step to the floor', () => {
    const axis = makeAxis({
      min: 0,
      max: 1,
      top: 0,
      height: 100,
      forceMinZero: true,
      minStep: 1,
    });
    assert.deepEqual(axis.ticks, [0, 1]);
  });
});
