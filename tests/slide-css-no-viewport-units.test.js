/**
 * Slide CSS sizes against the slide box, never the viewport.
 *
 * A slide renders at 1600x900 and is scaled as a whole
 * (00-tokens.css § THE FLUID BASIS). A `vw`/`vh` inside it follows the
 * browser window instead, so the same slide lays out differently in the
 * editor, the presenter, a thumbnail and an export. The logo wall did exactly
 * that: its cells sat on their clamp minimum in the editor and grew in
 * fullscreen. Reference pixels (`calc(N * var(--slide-canvas-unit))`) or
 * container units are the one form.
 *
 * Presenter chrome (console, present window, edge hint) sizes the browser
 * window itself; it is the viewer layer (`client/styles/viewer/`, D267) and
 * lives outside this directory. There is no allowance for slide CSS.
 *
 * Run with: node --test tests/slide-css-no-viewport-units.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const slidesDir = path.join(repoRoot, 'client', 'styles', 'slides');

const VIEWPORT_UNIT = /(?<![\w-])-?\d*\.?\d+(?:vw|vh|vmin|vmax|dvh|svh|lvh)\b/;

/** @param {string} dir @returns {Promise<string[]>} repo-relative .css paths */
async function cssFiles(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await cssFiles(full)));
    else if (entry.name.endsWith('.css'))
      out.push(path.relative(repoRoot, full).split(path.sep).join('/'));
  }
  return out;
}

describe('slide css has no viewport units', () => {
  it('sizes slide content against the slide box', async () => {
    const offenders = [];
    for (const rel of await cssFiles(slidesDir)) {
      const css = (await fs.readFile(path.join(repoRoot, rel), 'utf8')).replace(
        /\/\*[\s\S]*?\*\//g,
        '',
      );
      if (VIEWPORT_UNIT.test(css)) offenders.push(rel);
    }
    assert.deepEqual(
      offenders,
      [],
      'Viewport units in slide CSS: use calc(N * var(--slide-canvas-unit)) instead.',
    );
  });
});
