/**
 * Tests that a theme's `surfaces` config actually reaches the stylesheet.
 *
 * `config.surfaces` emits `--t-radius*` and `--t-shadow-scale`, but those only
 * do anything if the slide design system reads them. The shadow half was
 * comment-only for a long time ("Theme-adjustable via --t-shadow-opacity" with
 * no code behind it), so these assertions guard the wiring itself rather than
 * the emitted values, which `theme-builder-config.test.js` already covers.
 *
 * Run with: node --test tests/theme-surface-tokens.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RADIUS_SCALES, SHADOW_SCALES } from '../shared/theme-config-schema.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokensCss = readFileSync(
  join(repoRoot, 'client/styles/slides/00-tokens.css'),
  'utf8'
);

test('the radius scale is read by the slide radius tokens', () => {
  assert.match(tokensCss, /--slide-radius-sm:\s*var\(--t-radius-sm,/);
  assert.match(tokensCss, /--slide-radius-md:\s*var\(--t-radius,/);
  assert.match(tokensCss, /--slide-radius-lg:\s*var\(--t-radius-lg,/);
});

test('every shadow token is scaled by --t-shadow-scale', () => {
  // Unset must behave as 1, so a theme that says nothing renders as before.
  assert.match(tokensCss, /--slide-shadow-scale:\s*var\(--t-shadow-scale,\s*1\)/);

  for (const name of ['sm', 'md', 'lg', 'card', 'elevated']) {
    const decl = tokensCss.match(
      new RegExp(`--slide-shadow-${name}:[^;]+;`)
    )?.[0];
    assert.ok(decl, `--slide-shadow-${name} is missing`);
    assert.ok(
      decl.includes('calc(') && decl.includes('var(--slide-shadow-scale)'),
      `--slide-shadow-${name} does not scale with the theme: ${decl}`
    );
  }
});

test('print still drops every shadow regardless of the theme', () => {
  // Chromium's print rasterizer paints blurred shadows as solid grey boxes.
  const printBlock = tokensCss.slice(tokensCss.indexOf('@media print'));
  for (const name of ['sm', 'md', 'lg', 'card', 'elevated']) {
    assert.match(printBlock, new RegExp(`--slide-shadow-${name}:\\s*none`));
  }
});

test('every scale the schema can emit is a value CSS can use', () => {
  for (const [name, value] of Object.entries(SHADOW_SCALES)) {
    assert.ok(Number.isFinite(Number(value)), `${name} is not numeric: ${value}`);
    assert.ok(Number(value) >= 0, `${name} is negative`);
  }
  for (const [name, vars] of Object.entries(RADIUS_SCALES)) {
    for (const [token, value] of Object.entries(vars)) {
      assert.match(value, /^\d+px$/, `${name}.${token} is not a px length`);
    }
  }
});
