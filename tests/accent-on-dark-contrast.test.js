/**
 * The accent on the dark surface reads against that surface.
 *
 * `--t-color-accent-on-dark` colours the quote byline on `--t-slide-bg-dark`.
 * Three shipped themes set it to their (dark) brand accent, so the byline sat
 * at ~2:1 on a near-black slide, and the theme builder copied the primary
 * straight in, so every custom theme with a navy or burgundy brand colour did
 * the same. Both sources are checked here at body-text AA: the byline is
 * mono at text-lg, not large-scale text.
 *
 * Run with: node --test tests/accent-on-dark-contrast.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalizeTheme } from '../shared/theme-normalize.js';
import { getContrastRatio } from '../shared/color-utils.js';
import { WCAG_THRESHOLDS } from '../shared/contrast.js';
import { deriveThemeTokens } from '../server/utils/theme-builder.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const THEMES_DIR = join(repoRoot, 'themes');
const WANT = WCAG_THRESHOLDS.body.aa;

test('every shipped theme’s accent-on-dark reads on its dark surface', () => {
  const failures = [];
  for (const f of readdirSync(THEMES_DIR).filter((n) => n.endsWith('.json'))) {
    const theme = normalizeTheme(
      JSON.parse(readFileSync(join(THEMES_DIR, f), 'utf8')),
    );
    const fg = theme.cssVars?.['--t-color-accent-on-dark'];
    const bg = theme.cssVars?.['--t-slide-bg-dark'];
    if (!fg || !bg) continue;
    const ratio = getContrastRatio(fg, bg);
    if (!(ratio >= WANT)) failures.push(`${f}: ${fg} on ${bg} = ${ratio}`);
  }
  assert.deepEqual(failures, []);
});

test('the theme builder lifts a dark primary until it reads on the dark surface', () => {
  for (const primary of ['#1e3a8a', '#9f1239', '#254d38', '#000000']) {
    const vars = deriveThemeTokens({ colors: { primary } }).cssVars;
    const ratio = getContrastRatio(
      vars['--t-color-accent-on-dark'],
      vars['--t-slide-bg-dark'],
    );
    assert.ok(ratio >= WANT, `${primary}: ${ratio}`);
  }
});

test('the theme builder keeps a primary that already reads', () => {
  const vars = deriveThemeTokens({ colors: { primary: '#7dd3fc' } }).cssVars;
  assert.equal(vars['--t-color-accent-on-dark'], '#7dd3fc');
});
