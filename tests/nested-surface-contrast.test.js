/**
 * Text on a nested surface reads against THAT surface.
 *
 * The defect this guards: a slide picks one text colour from its own
 * background, and an element that paints its own background inherits it
 * anyway. On the "calm" variant that produced white funnel-bar labels on a
 * light lime bar, and it had already produced #fafafa on the #ebebeb poll
 * results panel (~1.1:1).
 *
 * What is checkable here is the DERIVATION — every shipped theme's lime and
 * mist surfaces get a text colour that actually passes — plus the wiring: the
 * token exists, the contract is stated once, and every element that paints one
 * of these surfaces declares which one it is.
 *
 * Run with: node --test tests/nested-surface-contrast.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalizeTheme } from '../shared/theme-normalize.js';
import { getContrastRatio } from '../shared/color-utils.js';
import { WCAG_THRESHOLDS } from '../shared/contrast.js';
import { slideBackgroundsCssText } from '../shared/theme-slide-backgrounds.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const THEMES_DIR = join(repoRoot, 'themes');

const SHIPPED = readdirSync(THEMES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({
    id: f.replace(/\.json$/, ''),
    theme: normalizeTheme(JSON.parse(readFileSync(join(THEMES_DIR, f), 'utf8'))),
  }));

test('there are shipped themes to check', () => {
  assert.ok(SHIPPED.length >= 5, `expected the shipped themes, got ${SHIPPED.length}`);
});

// --- The derivation actually passes -----------------------------------------

test('every theme derives readable text for its lime and mist surfaces', () => {
  // AA for body text. The funnel value and the cycle hub label are large
  // enough to qualify for the `large` bucket, but the poll results body and a
  // pyramid description are not, so the stricter number is the one that has to
  // hold.
  const want = WCAG_THRESHOLDS.body.aa;
  const failures = [];
  for (const { id, theme } of SHIPPED) {
    for (const surface of ['lime', 'mist']) {
      const bg = theme.cssVars?.[`--t-slide-bg-${surface}`];
      const fg = theme.cssVars?.[`--t-slide-bg-${surface}-text`];
      assert.ok(fg, `${id}: --t-slide-bg-${surface}-text was not derived`);
      const ratio = getContrastRatio(fg, bg);
      if (ratio < want) {
        failures.push(`${id}/${surface}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(failures, [], `nested surfaces below ${want}:1:\n${failures.join('\n')}`);
});

test('a dark lime is not assumed away', () => {
  // `midnight` ships lime as a near-black. If the derivation ever collapses to
  // "lime is light", this is the theme that catches it — and it is the exact
  // case a hardcoded dark text colour would have got backwards.
  const midnight = SHIPPED.find((t) => t.id === 'midnight');
  assert.ok(midnight, 'the midnight theme should exist');
  const bg = midnight.theme.cssVars['--t-slide-bg-lime'];
  const fg = midnight.theme.cssVars['--t-slide-bg-lime-text'];
  assert.ok(
    getContrastRatio(fg, bg) >= WCAG_THRESHOLDS.body.aa,
    `midnight lime ${fg} on ${bg} = ${getContrastRatio(fg, bg).toFixed(2)}:1`
  );
});

test('accent contrast still holds, since accent is a surface too', () => {
  // Judged at the `large` bucket, not `body`: --t-color-accent-contrast is worn
  // by big glyphs — a letter in a 44px poll disc, a step number, an icon — not
  // by paragraph text. Measured today, the tightest shipped pair is `playful`
  // at 4.40:1, comfortably over `large` and just under `body`. That number is a
  // property of the shipped palette, not of this mechanism.
  const want = WCAG_THRESHOLDS.large.aa;
  const failures = [];
  for (const { id, theme } of SHIPPED) {
    const bg = theme.cssVars?.['--t-color-accent'];
    const fg = theme.cssVars?.['--t-color-accent-contrast'];
    const ratio = getContrastRatio(fg, bg);
    if (ratio < want) {
      failures.push(`${id}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('an author-declared variant text colour is left alone', () => {
  // The derivation only fills a gap; it must never overrule a theme that said
  // what its surface text should be.
  const theme = normalizeTheme({
    id: 'x',
    cssVars: {
      '--t-slide-bg-lime': '#ffffff',
      '--t-slide-bg-lime-text': '#003366',
    },
  });
  assert.equal(theme.cssVars['--t-slide-bg-lime-text'], '#003366');
});

// --- The contract is stated once, and the wiring exists ----------------------

const BASE_CSS = readFileSync(
  join(repoRoot, 'client/styles/slides/01-layout-and-title/00-base.css'),
  'utf8'
);

const SURFACES = ['light', 'dark', 'accent', 'lime', 'mist'];

test('every surface class is defined, in one place', () => {
  for (const s of SURFACES) {
    const re = new RegExp(`\\.slide \\.on-surface-${s} \\{`);
    assert.match(BASE_CSS, re, `.on-surface-${s} should be defined in 00-base.css`);
    // One definition, not two: the whole point is a single owner.
    const count = (BASE_CSS.match(new RegExp(`\\.slide \\.on-surface-${s} \\{`, 'g')) || [])
      .length;
    assert.equal(count, 1, `.on-surface-${s} defined ${count} times`);
  }
});

test('the redirect covers every surface class', () => {
  // A pole class that is not in the redirect group sets --surface-text and
  // nothing reads it — a silent no-op, which is worse than no class at all.
  const group = BASE_CSS.match(/\.slide :is\(([^)]*)\)\s*\{\s*--color-text: var\(--surface-text\)/);
  assert.ok(group, 'expected the shared redirect block');
  for (const s of SURFACES) {
    assert.ok(
      group[1].includes(`.on-surface-${s}`),
      `.on-surface-${s} is missing from the redirect group`
    );
  }
});

test('a graphic marker has its own token, and variants flip it', () => {
  assert.match(BASE_CSS, /--slide-marker-color: var\(--color-accent\)/);
  assert.match(BASE_CSS, /has-slide-bg-light-text[\s\S]{0,120}--slide-marker-color: color-mix/);

  // …and a theme-declared variant that flips its text colour flips it too.
  const css = slideBackgroundsCssText([
    { id: 'calm', label: 'Calm', value: '#140a26', textColor: '#ffffff' },
  ]);
  assert.match(css, /--slide-marker-color: color-mix\(in srgb, var\(--color-accent\) 35%, var\(--slide-bg-text\)\)/);

  // A variant with no text colour has not moved the ground, so it must not
  // move the marker either.
  const plain = slideBackgroundsCssText([{ id: 'sand', label: 'Sand', value: '#eee' }]);
  assert.ok(!plain.includes('--slide-marker-color'));
});

test('every element that paints a known surface declares which one', () => {
  // The sweep that found the defect, kept as a gate: a rule that paints one of
  // the theme's surface tokens has to be paired with a surface declaration —
  // either an `on-surface-*` class in the markup, or a `--surface-text`
  // override on the rule that swaps the background.
  const PAINTS = /background(-color)?:\s*var\(--(interaction-surface|slide-bg-lime|slide-bg-mist)\b/;
  const stylesDir = join(repoRoot, 'client/styles/slides');
  const typeSrc = readdirSync(join(repoRoot, 'shared/slide-types/types'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(repoRoot, 'shared/slide-types/types', f), 'utf8'))
    .join('\n');

  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(join(dir, e.name))
        : e.name.endsWith('.css')
          ? [join(dir, e.name)]
          : []
    );

  const unpaired = [];
  for (const file of walk(stylesDir)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim().replace(/\s+/g, ' ');
      const body = m[2];
      if (selector.startsWith('@') || !PAINTS.test(body)) continue;
      // A slide ROOT painting a surface token is just the slide's background,
      // which the slide-level contrast logic already answers for.
      if (/(^|[\s,>])\.slide(-[\w-]+)?(\.[\w-]+)*$/.test(selector)) continue;
      // Paired in the rule itself (a CSS-side surface swap)?
      if (/--surface-text\s*:/.test(body) || /--color-text\s*:/.test(body)) continue;
      // Paired in the markup? Take the rule's last class and look for it next
      // to an on-surface-* class in the type sources.
      const leaf = [...selector.matchAll(/\.([a-z][\w-]*)/g)].pop()?.[1];
      const declared =
        leaf &&
        new RegExp(`class="[^"]*\\b${leaf}\\b[^"]*\\bon-surface-`).test(typeSrc);
      if (!declared) {
        unpaired.push(`${file.replace(`${repoRoot}/`, '')}: ${selector}`);
      }
    }
  }

  // One known, deliberate exception: a bare progress rail with no text on it,
  // so it has no text colour to get wrong.
  const ALLOWED = ['.slide-poll .poll-bar-track'];
  const real = unpaired.filter((u) => !ALLOWED.some((a) => u.endsWith(a)));
  assert.deepEqual(
    real,
    [],
    `these paint a theme surface but never say which:\n${real.join('\n')}`
  );
});
