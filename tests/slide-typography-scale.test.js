/**
 * The fluid slide type scale and its theme multiplier (A2 / T9 rest-2a step a).
 *
 * `client/styles/slides/00-tokens.css` derives every `--slide-text-*` step from
 * the slide's own box instead of a literal px value, and lets a theme move the
 * whole scale through `--t-slide-text-scale`. Three things have to stay true
 * for that to keep working, and none of them is visible in a diff:
 *
 *  1. **The slide is the query container.** Without `container-type` on
 *     `.slide` every `cqi` in the scale silently falls back to the viewport,
 *     which is the fixed-canvas bug this replaces, only worse.
 *  2. **A container is queried by its descendants, never by itself.** So a
 *     `--slide-text-*` token consumed on a slide *root* selector resolves
 *     against whatever sits outside the slide. Measured: 20px becomes 17.6px
 *     on a 1280px-wide window. Slide typography must be set on descendants.
 *  3. **An unset multiplier behaves as 1**, so a theme that says nothing
 *     renders exactly as it did before the scale went fluid.
 *
 * Run with: node --test tests/slide-typography-scale.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TEXT_SCALES } from '../shared/theme-config-schema.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const slidesDir = path.join(repoRoot, 'client', 'styles', 'slides');

/** @param {string} css @returns {string} the same CSS with comments blanked out */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** @param {string} dir @returns {Promise<string[]>} repo-relative .css paths, recursively */
async function cssFiles(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await cssFiles(full)));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out.sort();
}

const tokensCss = stripComments(
  await fs.readFile(path.join(slidesDir, '00-tokens.css'), 'utf8'),
);
const sheets = [];
for (const file of await cssFiles(slidesDir)) {
  sheets.push({
    rel: path.relative(repoRoot, file),
    css: stripComments(await fs.readFile(file, 'utf8')),
  });
}

/** The ten core steps plus the three KPI display sizes. */
const TEXT_TOKENS = [
  'xs',
  'sm',
  'base',
  'md',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  'kpi-lg',
  'kpi-md',
  'kpi-sm',
];

describe('the fluid slide type scale', () => {
  it('makes the slide its own size-query container', () => {
    assert.match(
      tokensCss,
      /\.slide\s*\{[\s\S]*?\bcontainer-type:\s*inline-size\s*;/,
      'the `.slide` rule in 00-tokens.css must declare `container-type: inline-size` — ' +
        'without it every cqi in the type scale resolves against the viewport',
    );
  });

  it('reconstructs the border box so type size ignores the slide padding', () => {
    // Container query units resolve against the CONTENT box, so 100cqi is the
    // slide minus its padding. Adding the padding back makes the unit the
    // border box, i.e. independent of --slide-padding.
    assert.match(
      tokensCss,
      /--slide-canvas-unit:\s*calc\(\s*\(?\s*100cqi\s*\+\s*2\s*\*\s*var\(--slide-padding\)\s*\)?\s*\/\s*var\(--slide-canvas-width\)\s*\)/,
    );
    assert.match(tokensCss, /--slide-canvas-width:\s*1600\s*;/);
  });

  it('routes every text step through the reference-pixel unit', () => {
    for (const step of TEXT_TOKENS) {
      const decl = tokensCss.match(
        new RegExp(`--slide-text-${step}:\\s*([^;]+);`),
      )?.[1];
      assert.ok(decl, `--slide-text-${step} is missing`);
      assert.match(
        decl,
        /^calc\(\s*[\d.]+\s*\*\s*var\(--slide-text-unit\)\s*\)$/,
        `--slide-text-${step} is not on the fluid scale: ${decl}`,
      );
    }
  });

  it('treats an unset theme multiplier as 1', () => {
    assert.match(
      tokensCss,
      /--slide-text-scale:\s*var\(--t-slide-text-scale,\s*1\)\s*;/,
    );
    assert.match(
      tokensCss,
      /--slide-text-unit:\s*calc\(\s*var\(--slide-canvas-unit\)\s*\*\s*var\(--slide-text-scale\)\s*\)/,
    );
  });

  it('offers only multipliers CSS can use', () => {
    for (const [name, value] of Object.entries(TEXT_SCALES)) {
      assert.ok(Number.isFinite(Number(value)), `${name} is not numeric`);
      assert.ok(Number(value) > 0, `${name} is not positive`);
    }
    assert.equal(
      TEXT_SCALES.normal,
      '1',
      'the default preset must be identity',
    );
  });

  it('lets no element inside a slide become a query container', () => {
    // A nested container shadows the slide for its subtree: measured, a
    // 400px-wide nested container turned a 20px body step into 6.6px. Only a
    // slide ROOT selector may declare one (`.slide-countdown` needs both axes).
    const offenders = [];
    for (const { rel, css } of sheets) {
      for (const m of css.matchAll(
        /([^{}]+)\{([^{}]*container-type[^{}]*)\}/g,
      )) {
        for (const sel of m[1].split(',')) {
          const trimmed = sel.trim().split('\n').pop().trim();
          if (!trimmed || trimmed.startsWith('@')) continue;
          // A root selector is one compound: `.slide`, `.slide-countdown`,
          // `.slide.slide-bg-dark`. Anything with a combinator has an
          // ancestor inside the slide and would shadow it.
          if (/^\.slide[\w.-]*$/.test(trimmed)) continue;
          offenders.push(`${rel}  ${trimmed}`);
        }
      }
    }
    assert.deepStrictEqual(
      offenders.sort(),
      [],
      'container-type on a non-root selector inside the slide bundle:\n' +
        offenders.join('\n') +
        '\nIts subtree would size its type against that element instead of ' +
        'the slide.',
    );
  });

  it('sets no slide typography on the slide element itself', () => {
    // Point 2 in the header: the container cannot query itself.
    //
    // The test is on the exact `.slide` class, which is the one compound that
    // provably matches the slide root — `.slide-<something>` is ambiguous in
    // this codebase (`.slide-countdown` is a root, `.slide-label` and
    // `.slide-action` are descendant utilities), and guessing wrong would
    // either miss cases or block honest ones. `00-tokens.css` is excluded: it
    // *defines* the scale on `.slide`, which is exactly where it belongs.
    const offenders = [];
    for (const { rel, css } of sheets) {
      if (rel.endsWith('00-tokens.css')) continue;
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/var\(\s*--slide-(text|font-size)-/.test(m[2])) continue;
        for (const sel of m[1].split(',')) {
          const trimmed = sel.trim().split('\n').pop().trim();
          // The subject compound: `.slide`, `.slide.has-slide-bg`, but not
          // `.slide .heading` (a descendant) or `.slide-label`.
          if (!/^\.slide(\.[\w-]+)*$/.test(trimmed)) continue;
          offenders.push(`${rel}  ${trimmed}`);
        }
      }
    }
    assert.deepStrictEqual(
      offenders.sort(),
      [],
      'a --slide-text-*/--slide-font-size-* value is used on the slide root:\n' +
        offenders.join('\n') +
        '\nContainer query units resolve against an ANCESTOR container, so ' +
        'this reads the box around the slide. Move it to a descendant.',
    );
  });
});
