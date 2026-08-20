/**
 * The two ends of the SVG line, guarded from both sides.
 *
 * timeline-chart.js *draws* — axes, bars, gridlines, a <desc> — so it stays on
 * h(), whose SVG_TAGS path routes svg/g/line/rect/text/desc/path/circle through
 * createElementNS. This guards that its output is still real SVG (in the SVG
 * namespace), keeps its attributes/classes, and that the bar's hover handler is
 * wired — the things a blind createElementNS→h() swap could break.
 *
 * slide-visibility-menu.js *shows a glyph*, so it went the other way: its
 * hand-rolled eye/eye-off pair is now icon('eye' | 'eye-off'), a masked span.
 * The tests below assert the state still reaches the DOM — which vendored SVG
 * is masked, and the restricted class — now that no <svg> is there to inspect.
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
const { createTimelineChart } =
  await import('../client/views/analytics/timeline-chart.js');
const { createVisibilityToggle } =
  await import('../client/views/editor/slide-visibility-menu.js');
const { applyVisibilityPreset } = await import('../shared/slide-visibility.js');

test('visibility toggle masks the eye icon for a visible slide', () => {
  const visibleSlide = {};
  const button = createVisibilityToggle({
    h,
    slide: visibleSlide,
    onToggle: () => {},
  });

  const glyph = button.querySelector('span.icon');
  assert.ok(glyph, 'toggle contains an icon() span');
  assert.equal(glyph.style.getPropertyValue('--icon-size'), '14px');
  assert.match(glyph.style.getPropertyValue('--icon-url'), /\/eye\.svg"\)$/);
  assert.equal(
    button.querySelector('svg'),
    null,
    'no hand-rolled SVG left in the toggle',
  );
  assert.ok(
    !button.classList.contains('is-visibility-restricted'),
    'visible slide is not flagged restricted',
  );
});

test('visibility toggle swaps to the eye-off glyph when hidden', () => {
  const hiddenSlide = {};
  applyVisibilityPreset(hiddenSlide, 'hidden');
  const button = createVisibilityToggle({
    h,
    slide: hiddenSlide,
    onToggle: () => {},
  });

  const glyph = button.querySelector('span.icon');
  assert.match(
    glyph.style.getPropertyValue('--icon-url'),
    /\/eye-off\.svg"\)$/,
    'hidden state masks the struck-through eye',
  );
  assert.ok(
    button.classList.contains('is-visibility-restricted'),
    'button flags the restricted state',
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
  assert.equal(
    tooltip.style.display,
    'block',
    'mouseenter (onmouseenter) shows the tooltip',
  );

  bar.dispatchEvent(new MouseEvent('mouseleave'));
  assert.equal(tooltip.style.display, 'none', 'mouseleave hides it again');
});

test('timeline chart shows the empty state (no SVG) for no data', () => {
  const { el } = createTimelineChart({ h, data: [] });
  assert.equal(el.querySelector('svg'), null, 'no chart drawn');
  assert.ok(el.querySelector('.empty-state'), 'empty state shown instead');
});
