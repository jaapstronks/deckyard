/**
 * Spacing scale guard.
 *
 * `client/styles/shared/ui-tokens.css` defines a spacing scale, and until now
 * **nothing** checked whether the app used it. That is how it emptied out the
 * first time: a census on 2026-08-02 found 683 loose px values sitting beside
 * the tokens, in 27 of 57 substantial sheets at ≥60% off-scale. Adding the fine
 * band without a gate would buy a quarter, no more.
 *
 * What this asserts is narrow on purpose:
 *
 *   **A spacing length that exactly equals a token must be written as that
 *   token.**
 *
 * Not "every value must be on the scale". A value the scale does not carry —
 * 13px, 22px, 30px — is a *design* signal and stays literal; forcing it onto
 * the scale by eye is a redesign, not a conversion, and that was rejected. This
 * gate only catches the case where the conversion is value-identical by
 * construction, so a reviewer can verify it by reading the diff.
 *
 * The existing violations live in `css-spacing-suppressions.json` as per-file
 * counts, mirroring `eslint-suppressions.json`. A count can only ever go down:
 * a file that already has a budget still fails if it grows a new one, and a
 * file that converts some of its values fails until the number is lowered. That
 * friction is the point — the list must shrink monotonically.
 *
 * Regenerate after a conversion batch:
 *
 *     UPDATE_CSS_SPACING_SUPPRESSIONS=1 node --test tests/css-spacing-tokens.test.js
 *
 * Scale, conversion rule and scope: docs/reference/css-tokens.md.
 * Decision: docs/plans/briefs/css-tokens-beyond-color.md § as (a).
 *
 * Run with: node --test tests/css-spacing-tokens.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stylesDir = path.join(repoRoot, 'client', 'styles');
const tokensFile = path.join(stylesDir, 'shared', 'ui-tokens.css');
const suppressionsFile = path.join(repoRoot, 'css-spacing-suppressions.json');

const updating = /^(1|true|yes)$/i.test(
  String(process.env.UPDATE_CSS_SPACING_SUPPRESSIONS || '').trim()
);

/**
 * Declarations whose lengths are spacing.
 *
 * Deliberately not `width`/`height`/`inset`/`border-*`: those are sizing and
 * geometry, and a 16px border-radius is not the same concept as a 16px gap even
 * when the number matches. Widening this list is a separate decision.
 */
const SPACING_PROPERTIES = [
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'margin-block',
  'margin-block-start',
  'margin-block-end',
  'margin-inline',
  'margin-inline-start',
  'margin-inline-end',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'padding-block',
  'padding-block-start',
  'padding-block-end',
  'padding-inline',
  'padding-inline-start',
  'padding-inline-end',
  'gap',
  'row-gap',
  'column-gap',
];

/**
 * Stylesheets outside the gate, each for a reason that is not "too much work".
 *
 * - `slides/**` cannot use `--ps-*` at all: `server/mcp/preview.js` bundles
 *   `slides.css` without `ui-tokens.css`, so the token would resolve to nothing
 *   there with no error. The trap is documented in docs/reference/css-tokens.md.
 * - `cookie-consent.css` is parked — not in any load path, with its own revive
 *   checklist. Converting a sheet nothing loads is churn.
 */
const EXCLUDED = [/^client\/styles\/slides\//, /(^|\/)cookie-consent\.css$/];

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
 * Blank out comments, keeping newlines so line numbers stay right. Without this
 * a commented-out declaration counts as live.
 *
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

/**
 * Read the spacing scale out of `ui-tokens.css`, so the gate cannot drift from
 * the tokens it enforces. Values are `rem` against a 16px root (the root sets
 * no `font-size`, which docs/reference/css-tokens.md states as the reason each
 * token equals the pixel value in its name).
 *
 * @param {string} source
 * @returns {Map<number, string>} px value → token name
 */
function readSpacingScale(source) {
  const scale = new Map();
  for (const m of stripComments(source).matchAll(
    /(--ps-space-[\w-]+)\s*:\s*([\d.]+)rem\s*;/g
  )) {
    scale.set(Number(m[2]) * 16, m[1]);
  }
  return scale;
}

/**
 * @typedef {object} Violation
 * @property {string} file  repo-relative path
 * @property {number} line  1-indexed
 * @property {string} prop
 * @property {string} value the whole declaration value
 * @property {string} token the token this length should be written as
 * @property {number} px
 */

/**
 * Find spacing lengths that exactly equal a token but are written as raw px.
 *
 * Two exclusions come straight from the conversion rule in
 * docs/reference/css-tokens.md, and both are about keeping the change
 * verifiable by reading:
 *
 *  - `!important` declarations stay literal (they are cascade patches, tracked
 *    separately in docs/reference/css-important.md).
 *  - negative values and `0` stay literal: the scale has no negative members,
 *    and a negative margin usually pairs with a positive padding that would
 *    then be tokenised out of step with it.
 *
 * @param {string} source
 * @param {string} label repo-relative path
 * @param {Map<number, string>} scale
 * @returns {Violation[]}
 */
function findViolations(source, label, scale) {
  const clean = stripComments(source);
  const out = [];

  const propAlternation = SPACING_PROPERTIES.join('|');
  const declRe = new RegExp(`(^|[;{])\\s*(${propAlternation})\\s*:([^;{}]*)`, 'gi');

  for (const decl of clean.matchAll(declRe)) {
    const prop = decl[2].toLowerCase();
    const value = decl[3];
    if (/!important/i.test(value)) continue;
    // A declaration that already reaches for a token is mid-conversion at worst;
    // the "never mix a raw px and a token" rule is what keeps that from
    // happening, and it is enforced by review, not here.
    if (/var\(/.test(value)) continue;

    const line = clean.slice(0, decl.index).split('\n').length;

    for (const len of value.matchAll(/(-?)(\d+(?:\.\d+)?)px/g)) {
      if (len[1] === '-') continue; // negatives stay literal
      const px = Number(len[2]);
      if (px === 0) continue; // 0 stays literal
      const token = scale.get(px);
      if (!token) continue; // off-scale: a design signal, not a conversion
      out.push({ file: label, line, prop, value: value.trim(), token, px });
    }
  }

  return out;
}

const tokensSource = await fs.readFile(tokensFile, 'utf8');
const scale = readSpacingScale(tokensSource);

const files = (await cssFiles(stylesDir))
  .map((f) => path.relative(repoRoot, f))
  .filter((rel) => !EXCLUDED.some((re) => re.test(rel)));

const violations = (
  await Promise.all(
    files.map(async (rel) =>
      findViolations(await fs.readFile(path.join(repoRoot, rel), 'utf8'), rel, scale)
    )
  )
).flat();

/** Violations per file, as the suppressions file records them. */
const counts = new Map();
for (const v of violations) counts.set(v.file, (counts.get(v.file) || 0) + 1);

if (updating) {
  const next = Object.fromEntries(
    [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, count]) => [file, { 'tokenisable-spacing': { count } }])
  );
  await fs.writeFile(suppressionsFile, `${JSON.stringify(next, null, 2)}\n`);
}

const suppressions = JSON.parse(await fs.readFile(suppressionsFile, 'utf8'));
const budgetFor = (file) => suppressions[file]?.['tokenisable-spacing']?.count ?? 0;

describe('css spacing tokens', () => {
  it('reads the scale out of ui-tokens.css', () => {
    // If this ever comes back empty the gate would pass vacuously, which is the
    // one failure mode a guard must not have.
    assert.ok(scale.size >= 15, `expected the full spacing scale, parsed ${scale.size} tokens`);
    for (const px of [2, 6, 10, 14, 18]) {
      assert.ok(scale.has(px), `the fine band should carry ${px}px`);
    }
    for (const px of [28, 36, 44, 56, 60, 64]) {
      assert.ok(scale.has(px), `the upper scale should carry ${px}px`);
    }
  });

  it('finds spacing declarations to check', () => {
    assert.ok(files.length > 0, `no stylesheets found under ${stylesDir}`);
  });

  it('adds no tokenisable spacing beyond each file’s burndown budget', () => {
    const over = [];
    for (const [file, count] of [...counts.entries()].sort()) {
      const budget = budgetFor(file);
      if (count <= budget) continue;
      const examples = violations
        .filter((v) => v.file === file)
        .slice(0, 4)
        .map((v) => `      ${v.file}:${v.line}  ${v.prop}: ${v.value}  → ${v.token}`);
      over.push(
        `${file}: ${count} tokenisable px value(s), budget ${budget}\n${examples.join('\n')}`
      );
    }

    assert.deepStrictEqual(
      over,
      [],
      `${over.length} file(s) exceed their spacing burndown budget.\n\n` +
        'A px length that exactly equals a --ps-space-* token must be written as\n' +
        'that token. Off-scale values (13px, 22px, 30px…) are fine and are not\n' +
        'counted — see docs/reference/css-tokens.md.\n\n' +
        'Do NOT raise a budget in css-spacing-suppressions.json to make this pass.\n' +
        'The list may only shrink.'
    );
  });

  it('has no stale burndown entries', () => {
    const stale = [];
    for (const [file, entry] of Object.entries(suppressions)) {
      const budget = entry?.['tokenisable-spacing']?.count ?? 0;
      const actual = counts.get(file) || 0;
      if (actual < budget) stale.push(`${file}: budget ${budget}, actual ${actual}`);
    }
    assert.deepStrictEqual(
      stale.sort(),
      [],
      `${stale.length} burndown budget(s) are now too generous.\n` +
        'Lower them (or delete the entry) — the conversion is that much done:\n' +
        '  UPDATE_CSS_SPACING_SUPPRESSIONS=1 node --test tests/css-spacing-tokens.test.js'
    );
  });

  it('lists no file that is out of scope', () => {
    // A suppressions entry for slides/** or a parked sheet would be dead weight
    // the gate never re-checks.
    const outOfScope = Object.keys(suppressions).filter(
      (file) => !files.includes(file)
    );
    assert.deepStrictEqual(
      outOfScope.sort(),
      [],
      'burndown entries for files the gate does not scan; delete them'
    );
  });
});
