/**
 * Inline-SVG view builders render through h() (client/lib/dom.js).
 *
 * timeline-chart.js and slide-visibility-menu.js used to hand-roll their SVG
 * with document.createElementNS + setAttribute. They now go through h(), whose
 * SVG_TAGS path routes svg/g/line/rect/text/desc/path/circle through
 * createElementNS. This guards that the migrated output is still real SVG (in
 * the SVG namespace), keeps its attributes/classes, and that the bar's hover
 * handler is wired — the things a blind createElementNS→h() swap could break.
 *
 * Run with: node --test tests/inline-svg-h-builders.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
// h() sets class via setAttribute only when SVGElement is defined and the node
// is an instance of it; without this global it would assign to the read-only
// SVGAnimatedString className and throw. Mirrors the real browser runtime.
globalThis.SVGElement = dom.window.SVGElement;
globalThis.MouseEvent = dom.window.MouseEvent;

const SVG_NS = 'http://www.w3.org/2000/svg';

const { h } = await import('../client/lib/dom.js');
const { createTimelineChart } = await import('../client/views/analytics/timeline-chart.js');
const { createVisibilityToggle } = await import('../client/views/editor/slide-visibility-menu.js');
const { applyVisibilityPreset } = await import('../shared/slide-visibility.js');

test('visibility toggle renders an SVG eye icon in the SVG namespace', () => {
  const visibleSlide = {};
  const button = createVisibilityToggle({ h, slide: visibleSlide, onToggle: () => {} });

  const svg = button.querySelector('svg');
  assert.ok(svg, 'toggle contains an <svg>');
  assert.equal(svg.namespaceURI, SVG_NS, '<svg> is in the SVG namespace');
  assert.equal(svg.getAttribute('viewBox'), '0 0 24 24');
  assert.equal(svg.getAttribute('stroke'), 'currentColor');
  // Visible preset → eye icon = path + circle
  assert.ok(svg.querySelector('path'), 'has a path');
  const circle = svg.querySelector('circle');
  assert.ok(circle, 'visible state draws the eye circle');
  assert.equal(circle.namespaceURI, SVG_NS);
  assert.equal(svg.querySelector('line'), null, 'no eye-off strike when visible');
});

test('visibility toggle swaps to the eye-off (line) icon when hidden', () => {
  const hiddenSlide = {};
  applyVisibilityPreset(hiddenSlide, 'hidden');
  const button = createVisibilityToggle({ h, slide: hiddenSlide, onToggle: () => {} });

  const svg = button.querySelector('svg');
  assert.ok(svg.querySelector('line'), 'hidden state draws the eye-off strike');
  assert.equal(svg.querySelector('circle'), null, 'no eye circle when hidden');
  assert.ok(
    button.classList.contains('is-visibility-restricted'),
    'button flags the restricted state'
  );
});

test('timeline chart renders bars as SVG rects with data attributes', () => {
  const data = [
    { date: '2026-07-01', views: 3 },
    { date: '2026-07-02', views: 7 },
  ];
  const { el } = createTimelineChart({ h, data });

  const svg = el.querySelector('svg.analytics-chart-svg');
  assert.ok(svg, 'chart has an <svg>');
  assert.equal(svg.namespaceURI, SVG_NS);
  assert.equal(svg.getAttribute('role'), 'img');

  // Description carries the interpolated totals (3 + 7 = 10).
  const desc = svg.querySelector('desc');
  assert.ok(desc, 'svg has a <desc> for screen readers');
  assert.match(desc.textContent, /10.* total views/);

  const bars = svg.querySelectorAll('rect.analytics-chart-bar');
  assert.equal(bars.length, 2, 'one bar per datum');
  assert.equal(bars[0].getAttribute('data-views'), '3');
  assert.equal(bars[1].getAttribute('data-date'), '2026-07-02');
  assert.equal(bars[0].namespaceURI, SVG_NS);

  // Y-axis labels are SVG <text> (6 gridline ticks: 0..5).
  assert.equal(svg.querySelectorAll('text.analytics-chart-label-y').length, 6);
});

test('timeline chart bar hover wires the tooltip handler through h()', () => {
  const { el } = createTimelineChart({
    h,
    data: [{ date: '2026-07-01', views: 5 }],
  });
  const tooltip = el.querySelector('.analytics-chart-tooltip');
  assert.equal(tooltip.style.display, 'none', 'tooltip starts hidden');

  const bar = el.querySelector('rect.analytics-chart-bar');
  bar.dispatchEvent(new MouseEvent('mouseenter'));
  assert.equal(tooltip.style.display, 'block', 'mouseenter (onmouseenter) shows the tooltip');

  bar.dispatchEvent(new MouseEvent('mouseleave'));
  assert.equal(tooltip.style.display, 'none', 'mouseleave hides it again');
});

test('timeline chart shows the empty state (no SVG) for no data', () => {
  const { el } = createTimelineChart({ h, data: [] });
  assert.equal(el.querySelector('svg'), null, 'no chart drawn');
  assert.ok(el.querySelector('.analytics-empty-state'), 'empty state shown instead');
});
