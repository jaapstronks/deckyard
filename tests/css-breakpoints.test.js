/**
 * Breakpoint ladder guard.
 *
 * Deckyard has one shared breakpoint ladder (docs/reference/css-breakpoints.md).
 * Custom properties are not allowed in media conditions and there is no build
 * step to compile `@custom-media`, so the ladder cannot be a variable — it is
 * enforced here instead.
 *
 * Three checks:
 *  1. every width condition in client/styles/** is on the ladder (or allowlisted)
 *  2. width conditions are expressed in px
 *  3. the allowlist has no stale entries, so migrations shrink it monotonically
 *
 * Run with: node --test tests/css-breakpoints.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stylesDir = path.join(repoRoot, 'client', 'styles');

/** The ladder. Keep in sync with docs/reference/css-breakpoints.md. */
const LADDER = {
  max: [480, 640, 768, 1024, 1280],
  /** Rung counterparts are one pixel up, plus the ultra-wide scale. */
  min: [481, 641, 769, 1025, 1281, 1400, 1600, 1800],
};

/**
 * Width conditions that predate the ladder and have not been migrated yet.
 *
 * This list may only ever shrink. New CSS must use the ladder; if a layout
 * needs a width that is not a rung, change the layout, not this list.
 * See docs/plans/breakpoint-scale.md for the migration order.
 */
const ALLOWLIST = [
  // Step 2 — trivial remap (<= 60px shift, cosmetic rules only).
  'max-width: 420px',
  'max-width: 500px',
  'max-width: 600px',
  'max-width: 680px',
  'max-width: 720px',
  'max-width: 800px',
  'max-width: 960px',
  'max-width: 980px',
  // Step 3 — needs a visual check (> 60px shift or shared chrome).
  'max-width: 375px',
  'max-width: 520px',
  'max-width: 700px',
  'max-width: 860px',
  'max-width: 900px',
  'max-width: 1150px',
  // Step 4 — the load-bearing editor ladder (820/1024/1100 and counterparts).
  'max-width: 820px',
  'max-width: 1100px',
  'min-width: 821px',
  'min-width: 1101px',
  // Overlapping min-width counterparts (rule 3 in the reference doc).
  'min-width: 480px',
  'min-width: 600px',
  'min-width: 768px',
];

/** @param {string} dir @returns {Promise<string[]>} absolute paths of .css files, recursively */
async function cssFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await cssFiles(full)));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out.sort();
}

/**
 * @typedef {object} WidthCondition
 * @property {string} key       normalized `"max-width: 600px"`
 * @property {'min'|'max'} side
 * @property {number} value
 * @property {string} unit
 * @property {string} where     `"path/to.css:12"`
 */

/**
 * Pull every width condition out of the `@media` preludes in one stylesheet.
 *
 * @param {string} source
 * @param {string} label relative path, used in failure messages
 * @returns {WidthCondition[]}
 */
function widthConditions(source, label) {
  const out = [];
  for (const media of source.matchAll(/@media([^{]*)\{/g)) {
    const line = source.slice(0, media.index).split('\n').length;
    for (const cond of media[1].matchAll(/(min|max)-width\s*:\s*([\d.]+)([a-z%]*)/gi)) {
      const side = /** @type {'min'|'max'} */ (cond[1].toLowerCase());
      const value = Number(cond[2]);
      const unit = cond[3].toLowerCase();
      out.push({ key: `${side}-width: ${cond[2]}${unit}`, side, value, unit, where: `${label}:${line}` });
    }
  }
  return out;
}

const files = await cssFiles(stylesDir);
const found = (
  await Promise.all(
    files.map(async (file) =>
      widthConditions(await fs.readFile(file, 'utf8'), path.relative(repoRoot, file))
    )
  )
).flat();

const allowed = new Set(ALLOWLIST);
const onLadder = (c) => c.unit === 'px' && LADDER[c.side].includes(c.value);

describe('css breakpoints', () => {
  it('finds media queries to check', () => {
    assert.ok(found.length > 0, `no @media width conditions found under ${stylesDir}`);
  });

  it('expresses every width condition in px', () => {
    const wrong = found.filter((c) => c.unit !== 'px');
    assert.deepStrictEqual(
      wrong.map((c) => `${c.where}  ${c.key}`).sort(),
      [],
      'Media query widths must use px (see docs/reference/css-breakpoints.md).'
    );
  });

  it('keeps every width condition on the ladder', () => {
    const off = found.filter((c) => !onLadder(c) && !allowed.has(c.key));
    assert.deepStrictEqual(
      off.map((c) => `${c.where}  ${c.key}`).sort(),
      [],
      `${off.length} width condition(s) off the breakpoint ladder.\n` +
        `Use 480/640/768/1024/1280 (or min-width 481/641/769/1025/1281, or the\n` +
        `ultra-wide 1400/1600/1800). See docs/reference/css-breakpoints.md.\n` +
        `Do not extend the ALLOWLIST in this file — it may only shrink.`
    );
  });

  it('has no stale allowlist entries', () => {
    const live = new Set(found.map((c) => c.key));
    const stale = ALLOWLIST.filter((key) => !live.has(key));
    assert.deepStrictEqual(
      stale.sort(),
      [],
      `${stale.length} allowlisted value(s) no longer appear in client/styles/**.\n` +
        `Delete them from ALLOWLIST in this file — the migration is that much done.`
    );
  });
});
