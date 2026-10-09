/**
 * Chart-slide styling guards (B639).
 *
 *  1. The error card and the legend chips paint no literal colour: they read
 *     the ground's text colour and tint from it, so they read on a dark ground.
 *  2. The series-palette fallbacks have one source: `CHART_FALLBACK_PALETTE`
 *     in palette.js, mirrored by the `--slide-chart-*` fallbacks in
 *     00-tokens.css (CSS cannot import it).
 *
 * Run with: node --test tests/chart-slide-styles.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CHART_FALLBACK_ACCENT,
  CHART_FALLBACK_PALETTE,
  themeChartPalette,
} from '../shared/slide-types/types/chart-slide/palette.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const slidesDir = path.join(repoRoot, 'client', 'styles', 'slides');
const chartCss = fs.readFileSync(
  path.join(slidesDir, '03-components', '20-chart.css'),
  'utf8',
);
const tokensCss = fs.readFileSync(
  path.join(slidesDir, '00-tokens.css'),
  'utf8',
);

/** The declaration bodies of every rule whose selector names `cls`. */
function rulesFor(css, cls) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(re)) {
    if (m[1].includes(cls)) out.push(m[2]);
  }
  return out;
}

const LITERAL_COLOUR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;

for (const cls of [
  '.chart-error',
  '.chart-legend-item',
  '.chart-legend-swatch',
]) {
  test(`chart: ${cls} carries no literal colour`, () => {
    const bodies = rulesFor(chartCss, cls);
    assert.ok(bodies.length, `${cls} has rules`);
    for (const body of bodies) {
      assert.doesNotMatch(body, LITERAL_COLOUR, `${cls}: ${body.trim()}`);
      assert.doesNotMatch(body, /--slide-on-light\b/, `${cls}: fixed pole`);
    }
  });
}

test('chart: the CSS series fallbacks mirror CHART_FALLBACK_PALETTE', () => {
  const css = {};
  for (const m of tokensCss.matchAll(
    /--slide-chart-(\d):\s*var\(--t-chart-\1,\s*([^;]+)\);/g,
  )) {
    css[Number(m[1])] = m[2].trim();
  }
  assert.equal(Object.keys(css).length, 8, 'eight --slide-chart-* slots');
  assert.equal(css[0], 'var(--slide-accent)', 'slot 0 is the accent');
  for (let i = 1; i < 8; i += 1) {
    assert.equal(css[i], CHART_FALLBACK_PALETTE[i], `slot ${i}`);
  }
  assert.match(
    tokensCss,
    new RegExp(
      `--slide-accent: var\\(--t-color-accent, ${CHART_FALLBACK_ACCENT}\\);`,
    ),
    'the JS accent fallback is the --slide-accent default',
  );
});

test('chart: a theme without a chart palette falls back to its accent', () => {
  assert.deepEqual(themeChartPalette(null), [...CHART_FALLBACK_PALETTE]);
  const pal = themeChartPalette({ cssVars: { '--t-color-accent': '#123456' } });
  assert.equal(pal[0], '#123456');
  assert.deepEqual(pal.slice(1), CHART_FALLBACK_PALETTE.slice(1));
});
