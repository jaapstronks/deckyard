/**
 * The KPI tile's fill is chosen on contrast, on every built-in ground (D123).
 *
 * The defect (B218, measured at B212): the tile was 45% white everywhere. On a
 * light ground that is a lifted card under dark text, which is what it was
 * designed for. On a dark ground the text is light, and 45% white lifts the
 * tile to mid grey under it: the label measured 3.1:1 on calm and 4.3:1 on
 * midnight, the note under 3:1. The label is small text, so it is body text
 * and owes AA-body; there is no "large label" exception.
 *
 * The fix reads the tile's alpha off its own text colour (80-kpi-metrics-
 * slide.css § Tile surface tokens): light text means a dark ground and the
 * dark-ground glass, dark text the light-ground glass. This test resolves both
 * alphas from the stylesheet, composites them over the built-in grounds the
 * decision names (calm, every midnight surface) plus the light grounds the old
 * value was made for, and requires AA for the label, the figure and the muted
 * note. The photo branch (`--slide-scrim-card`) is slide-photo-scrim.test.js.
 *
 * Run with: node --test tests/kpi-tile-contrast.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  hexToRgb,
  getRelativeLuminance,
  contrastRatioFromLuminance,
} from '../shared/color-utils.js';
import { WCAG_THRESHOLDS } from '../shared/contrast.js';
import { seedThemeConfig } from './helpers/theme-seed.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const stylesDir = join(repoRoot, 'client', 'styles', 'slides');

const read = (rel) => readFileSync(join(stylesDir, rel), 'utf8');
const kpiCss = read('01-layout-and-title/80-kpi-metrics-slide.css');
const tokens = read('00-tokens.css');

const WHITE = { r: 255, g: 255, b: 255 };

/** Source-over compositing of an `alpha`-transparent `fg` onto an opaque `bg`. */
function over(fg, alpha, bg) {
  return {
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
  };
}

const ratio = (a, b) =>
  contrastRatioFromLuminance(getRelativeLuminance(a), getRelativeLuminance(b));

/** `#fafafa` or `rgba(250, 250, 250, 0.64)` → `{ rgb, alpha }`. */
function parseColor(value) {
  const rgba =
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(
      value.trim(),
    );
  if (rgba) {
    const [, r, g, b, a] = rgba;
    return { rgb: { r: +r, g: +g, b: +b }, alpha: a === undefined ? 1 : +a };
  }
  const rgb = hexToRgb(value.trim());
  assert.ok(rgb, `cannot parse colour: ${value}`);
  return { rgb, alpha: 1 };
}

/** Pull `--name: <value>;` out of a stylesheet. */
function tokenValue(css, name) {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  assert.ok(m, `--${name} is not defined`);
  return m[1].replace(/\s+/g, ' ').trim();
}

/** A tile alpha: a number, or one `var(--slide-opacity-*)` hop into the tokens. */
function tileAlpha(name) {
  const raw = tokenValue(kpiCss, name);
  const ref = /^var\(--([a-z0-9-]+)\)$/.exec(raw);
  const alpha = Number(ref ? tokenValue(tokens, ref[1]) : raw);
  assert.ok(
    Number.isFinite(alpha) && alpha > 0 && alpha <= 1,
    `could not resolve --${name} from: ${raw}`,
  );
  return alpha;
}

/**
 * Every opaque colour a layered background can put behind the tile: the base
 * colour and each radial's centre (its strongest stop) composited onto it.
 * Conservative on purpose: a tile can sit anywhere on the slide. The centres
 * are not stacked: calm puts them in opposite corners, and where they would
 * meet the bare ground already leaves the theme's muted text at the AA edge
 * (4.52:1), so any glass at all would tip it. That is a question about the
 * theme's muted colour, not about the tile.
 */
function groundPixels(value) {
  const centres = [
    ...value.matchAll(/radial-gradient\(.*?(rgba\([^)]*\))/g),
  ].map((m) => parseColor(m[1]));
  assert.ok(centres.length > 0, `no radial centres found in: ${value}`);
  const base = parseColor(value.split(',').at(-1)).rgb;
  return [base, ...centres.map((s) => over(s.rgb, s.alpha, base))];
}

const brand = await seedThemeConfig('brand');
const midnight = await seedThemeConfig('midnight');

/** The grounds D123 names, each with the text pair the slide gives it there. */
function darkGrounds() {
  const calm = brand.slideBackgrounds.find((b) => b.id === 'calm');
  assert.ok(calm, 'the brand theme no longer ships the calm background');
  const grounds = groundPixels(calm.value).map((px, i) => ({
    name: `calm #${i}`,
    px,
    text: calm.textColor,
    muted: calm.textColorMuted,
  }));
  for (const surface of ['lime', 'mist', 'dark']) {
    grounds.push({
      name: `midnight/${surface}`,
      px: parseColor(midnight.cssVars[`--t-slide-bg-${surface}`]).rgb,
      text: midnight.cssVars[`--t-slide-bg-${surface}-text`],
      muted: midnight.cssVars['--t-color-text-muted'],
    });
  }
  return grounds;
}

function lightGrounds() {
  return ['lime', 'mist'].map((surface) => ({
    name: `brand/${surface}`,
    px: parseColor(brand.cssVars[`--t-slide-bg-${surface}`]).rgb,
    text: brand.cssVars[`--t-slide-bg-${surface}-text`],
    muted: brand.cssVars['--t-color-text-muted'],
  }));
}

/** Label, figure and note on a tile of `alpha` white over `ground`. */
function tileFailures(ground, alpha) {
  const tile = over(WHITE, alpha, ground.px);
  const failures = [];
  const check = (role, colour, want) => {
    const { rgb, alpha: a } = parseColor(colour);
    const got = ratio(over(rgb, a, tile), tile);
    if (got < want) {
      failures.push(
        `${ground.name} ${role}: ${got.toFixed(2)}:1 (want ${want}:1)`,
      );
    }
  };
  check('label', ground.text, WCAG_THRESHOLDS.body.aa);
  // The figure shares the label's colour and is display-sized, so `large` is
  // its bar; the label already holds the stricter one for the same colour.
  check('figure', ground.text, WCAG_THRESHOLDS.large.aa);
  check('note', ground.muted, WCAG_THRESHOLDS.body.aa);
  return failures;
}

test('the tile fill is read off the tile text colour, not a fixed white', () => {
  const fill = tokenValue(kpiCss, 'kpi-tile-bg');
  assert.match(
    fill,
    /^oklch\( from var\(--kpi-tile-fg\) 1 0 0 \/ clamp\( var\(--kpi-tile-glass-dark-ground\), \(0\.6 - l\) \* 100, var\(--kpi-tile-glass-light-ground\) \) \)$/,
    'the fill must step between the two glass alphas on the lightness of ' +
      '--kpi-tile-fg; a fixed rgba() is the B218 defect',
  );
  assert.ok(
    tileAlpha('kpi-tile-glass-dark-ground') <
      tileAlpha('kpi-tile-glass-light-ground'),
    'a dark ground takes the thinner glass',
  );
});

test('label, figure and note clear AA on calm and every midnight surface', () => {
  const alpha = tileAlpha('kpi-tile-glass-dark-ground');
  const failures = darkGrounds().flatMap((g) => tileFailures(g, alpha));
  assert.deepEqual(
    failures,
    [],
    `--kpi-tile-glass-dark-ground at ${alpha} lifts the tile too far under ` +
      `light text:\n${failures.join('\n')}`,
  );
});

test('the light-ground glass still carries dark text at AA', () => {
  const alpha = tileAlpha('kpi-tile-glass-light-ground');
  const failures = lightGrounds().flatMap((g) => tileFailures(g, alpha));
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('the dark-ground text of these themes sits above the oklch step', () => {
  // The CSS steps at oklch L 0.6. Light text far above it and dark text far
  // below it is what makes the step safe; a theme that ships mid-grey text
  // would land on the wrong glass and belongs in this test.
  const oklchL = (hex) => {
    const lin = (c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const { r, g, b } = parseColor(hex).rgb;
    const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
    const l = Math.cbrt(
      0.4122214708 * lr + 0.5363329296 * lg + 0.0514459929 * lb,
    );
    const m = Math.cbrt(
      0.2119034982 * lr + 0.6806995457 * lg + 0.1073969566 * lb,
    );
    const s = Math.cbrt(
      0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
    );
    return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  };
  for (const g of darkGrounds()) {
    assert.ok(oklchL(g.text) > 0.6, `${g.name}: ${g.text} is not light text`);
  }
  for (const g of lightGrounds()) {
    assert.ok(oklchL(g.text) < 0.6, `${g.name}: ${g.text} is not dark text`);
  }
});
