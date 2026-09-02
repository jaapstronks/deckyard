/**
 * A surface that carries text over a background IMAGE is chosen on contrast.
 *
 * The defect (B212, seen on slides.ciiic.nl): `has-slide-bg-light-text` answers
 * "how dark is the ground" and nothing else, so three slide types gave their
 * card/tile/header a translucent fill sized for a FLAT dark colour. On a photo
 * there is nothing predictable behind the fill, and the numbers collapse — the
 * timeline card's description line went to 1.0:1 over a white part of the image,
 * the KPI tile the same, because a 45%-white tile under white text IS
 * white-on-white once the ground stops being dark.
 *
 * Textures are the second question, and `.has-slide-bg` is where it is asked
 * (00-base.css § background images). The three rules that pair the two classes
 * all resolve to one token, `--slide-scrim-card`, and what makes that token the
 * right value is a number, not a preference. This test is that number: composite
 * the scrim over the worst ground a photo can offer — a white pixel — and the
 * muted body text on top of it, and require AA.
 *
 * Weakening the alpha, or dropping one of the three rules back to a tint, fails
 * here. Note that the scrim must hold on its own: `backdrop-filter` is
 * deliberately absent, because Chrome's print path does not render it and
 * 86-timeline-slide.css already carries one @media print exception for exactly
 * that class of difference.
 *
 * Run with: node --test tests/slide-photo-scrim.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  getRelativeLuminance,
  contrastRatioFromLuminance,
} from '../shared/color-utils.js';
import { WCAG_THRESHOLDS } from '../shared/contrast.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const stylesDir = join(repoRoot, 'client', 'styles', 'slides');

const read = (rel) => readFileSync(join(stylesDir, rel), 'utf8');

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

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

/** Pull `--name: <value>;` out of a stylesheet. */
function tokenValue(css, name) {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  assert.ok(m, `--${name} is not defined`);
  return m[1].replace(/\s+/g, ' ').trim();
}

/** `rgba(0, 0, 0, var(--slide-opacity-strong))` → 0.65, resolving one hop. */
function scrimAlpha(css) {
  const value = tokenValue(css, 'slide-scrim-card');
  const m = /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*(.+?)\s*\)$/.exec(value);
  assert.ok(m, `--slide-scrim-card must be an rgba black, got: ${value}`);
  const raw = m[1];
  const ref = /^var\(--([a-z0-9-]+)\)$/.exec(raw);
  const alpha = Number(ref ? tokenValue(css, ref[1]) : raw);
  assert.ok(
    Number.isFinite(alpha) && alpha > 0 && alpha <= 1,
    `could not resolve the scrim alpha from: ${value}`,
  );
  return alpha;
}

const tokens = read('00-tokens.css');

test('the card scrim keeps muted body text at AA over a white photo pixel', () => {
  const alpha = scrimAlpha(tokens);
  // Muted body text is the light text colour at --slide-opacity-visible
  // (the timeline's --timeline-text-muted derivation). The title is full
  // strength and therefore never the binding case; the description line is.
  const textAlpha = Number(tokenValue(tokens, 'slide-opacity-visible'));

  const card = over(BLACK, alpha, WHITE); // worst case: the image is blown out
  const body = over(WHITE, textAlpha, card);
  const got = ratio(body, card);

  assert.ok(
    got >= WCAG_THRESHOLDS.body.aa,
    `--slide-scrim-card at alpha ${alpha} gives ${got.toFixed(2)}:1 for muted ` +
      `body text over a white ground; AA body is ${WCAG_THRESHOLDS.body.aa}:1. ` +
      'Raise the alpha rather than the text opacity — the text colour is the ' +
      "ground's answer, the scrim is ours.",
  );
});

test('full-strength text on the scrim clears AA over any photo pixel', () => {
  const alpha = scrimAlpha(tokens);
  for (const [name, ground] of [
    ['white', WHITE],
    ['mid grey', { r: 128, g: 128, b: 128 }],
    ['black', BLACK],
  ]) {
    const surface = over(BLACK, alpha, ground);
    const got = ratio(WHITE, surface);
    assert.ok(
      got >= WCAG_THRESHOLDS.body.aa,
      `${name} ground: ${got.toFixed(2)}:1`,
    );
  }
});

test('every photo-ground surface resolves to the one scrim token', () => {
  // Named explicitly so removing a rule, or re-spelling one as its own rgba(),
  // fails here. These are the three treatments that pair the texture question
  // with the luminance question; a fourth belongs in this list.
  const expected = [
    [
      '01-layout-and-title/86-timeline-slide.css',
      '.slide-timeline.has-slide-bg.has-slide-bg-light-text',
      '--timeline-card-surface',
    ],
    [
      '01-layout-and-title/35-table-slide.css',
      '.has-slide-bg.has-slide-bg-light-text .md-table--plain',
      '--table-bg',
    ],
    [
      '01-layout-and-title/80-kpi-metrics-slide.css',
      '.has-slide-bg.has-slide-bg-light-text.slide-kpi-metrics .kpi-metric',
      '--kpi-tile-bg',
    ],
  ];

  for (const [rel, selector, prop] of expected) {
    const css = read(rel);
    const at = css.indexOf(selector);
    assert.ok(at >= 0, `${rel} must carry the rule \`${selector}\``);
    const block = css.slice(at, css.indexOf('}', at));
    assert.match(
      block,
      new RegExp(`${prop}:\\s*var\\(--slide-scrim-card\\)`),
      `${rel}: ${prop} must be var(--slide-scrim-card), not a local value — ` +
        'one scrim, one place to argue about the number.',
    );
  }
});

test('the scrim carries itself, without backdrop-filter', () => {
  // Point 2 of the briefing: a blur may decorate, never carry. Chrome's print
  // path drops it, and these rules are the readability of the slide.
  for (const rel of [
    '01-layout-and-title/86-timeline-slide.css',
    '01-layout-and-title/35-table-slide.css',
    '01-layout-and-title/80-kpi-metrics-slide.css',
  ]) {
    const css = read(rel).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(
      !css.includes('backdrop-filter'),
      `${rel} introduces backdrop-filter; the scrim must hold on its own so ` +
        'the PDF export reads the same as the screen.',
    );
  }
});
