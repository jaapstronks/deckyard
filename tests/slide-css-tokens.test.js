/**
 * Slide design-token guard — fase 0 of the role-vocabulary track (A7.9 + A7.2).
 *
 * `client/styles/slides/00-tokens.css` defines a complete typography, leading
 * and spacing scale for slide CSS, and until now **nothing** checked whether
 * slide stylesheets used it. The 2026-08-03 census found 603 literal
 * declarations on the axes the scale covers, at 16-23% token adoption —
 * 74 unique font sizes where the scale has 10 steps. This gate is the same
 * medicine as `tests/css-spacing-tokens.test.js` (the app-chrome spacing
 * gate), pointed at the slide layer.
 *
 * What it asserts is narrow on purpose:
 *
 *   **A value that exactly equals a slide token must be written as that
 *   token.**
 *
 * Not "every value must be on the scale". An off-scale value (26px, 1.25) is a
 * design signal for the role-vocabulary sweep, not a conversion, and is not
 * counted. Only the value-identical case is caught, so a violation is always
 * fixable by reading the diff. `border-radius` is deliberately absent: its
 * tokens are theme-following (`var(--t-radius, 18px)`), so converting a
 * literal changes behaviour under a theme — that belongs to the sweep, not to
 * this gate.
 *
 * "Written as that token" is spelling-agnostic and position-agnostic: `1rem`
 * is the same 16px as `16px`, and a raw length beside a token in one
 * declaration (`padding: 4px var(--slide-space-4)`) counts too.
 *
 * Existing violations live in `slide-css-suppressions.json` as per-file,
 * per-category counts. A count can only ever go down: a file with a budget
 * still fails if it grows a new violation, and a file that converts some of
 * its values fails until the number is lowered. Regenerate after a batch:
 *
 *     UPDATE_SLIDE_CSS_SUPPRESSIONS=1 node --test tests/slide-css-tokens.test.js
 *
 * Plan and phasing: docs/plans/briefs/css-role-vocabulary.md (private sibling).
 *
 * Run with: node --test tests/slide-css-tokens.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slidesDir = path.join(repoRoot, 'client', 'styles', 'slides');
const tokensFile = path.join(slidesDir, '00-tokens.css');
const suppressionsFile = path.join(repoRoot, 'slide-css-suppressions.json');

const updating = /^(1|true|yes)$/i.test(
  String(process.env.UPDATE_SLIDE_CSS_SUPPRESSIONS || '').trim()
);

/**
 * The three checked categories and the properties they cover.
 *
 * Spacing deliberately includes the margin family: a slide margin and a slide
 * padding draw from the same scale. `border-radius` is excluded (see header),
 * and so are `width`/`height`/`inset` — sizing is not spacing.
 */
const CATEGORIES = {
  'font-size': ['font-size'],
  'line-height': ['line-height'],
  spacing: [
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
  ],
};

/**
 * Sheets in the slide bundle that are not slide rendering, each with a reason
 * that is not "too much work".
 *
 * The presenter surfaces are app chrome that happens to live in the slide
 * bundle (they style the present window around the deck, use `--app-*` tokens,
 * and never render in an export or the MCP preview). They are outside the
 * slide token vocabulary on purpose.
 */
const EXCLUDED = [
  /\/00-tokens\.css$/, // defines the scale; checking it against itself is circular
  /\/60-accessibility\.css$/, // page chrome (.sr-only, .skip-link) outside the .slide token scope
  /\/50-presenter-layout\.css$/,
  /\/51-presenter-console\.css$/,
  /\/53-present-window\.css$/,
  /\/80-presenter-progress\.css$/,
  /\/82-auto-advance\.css$/,
  /\/85-presenter-start\.css$/,
  /\/90-presenter-edge-hint\.css$/,
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
 * Blank out comments, keeping newlines so line numbers stay right. Without this
 * a commented-out declaration counts as live.
 *
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

/** The root element sets no `font-size`, so `1rem` is exactly 16px. */
const REM_IN_PX = 16;

/**
 * Normalise a numeric amount to a stable map key, so a `rem`→px conversion
 * that lands a hair off an integer in floating point cannot silently miss a
 * token.
 *
 * @param {number} n
 * @returns {number}
 */
function numKey(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Read the slide scales out of `00-tokens.css`, so the gate cannot drift from
 * the tokens it enforces. Only tokens whose value is a bare `px` length (the
 * text and space scales) or a bare number (the leading scale) participate —
 * theme-following tokens like `--slide-radius-md: var(--t-radius, 18px)` are
 * skipped by construction, which is exactly the border-radius exclusion above.
 *
 * The `px` axis is split into a **per-category** map, `text` and `space`, each
 * keyed on value within its own scale. This matters where the two scales share
 * a value (16/20/24/64px sit on both): a single value-keyed map would let the
 * first-parsed token win, so a spacing declaration of `16px` would resolve to
 * `--slide-text-sm`, and `findViolations`' category guard would then skip it as
 * "not a space token" — the violation would be invisible. Keyed per category,
 * a spacing `16px` always resolves to `--slide-space-4`.
 *
 * @param {string} source
 * @returns {{text: Map<number, string>, space: Map<number, string>, leading: Map<number, string>}}
 */
function readScales(source) {
  const text = new Map();
  const space = new Map();
  const leading = new Map();
  for (const m of stripComments(source).matchAll(
    /(--slide-(text|space)-[\w-]+)\s*:\s*([\d.]+)px\s*;/g
  )) {
    const map = m[2] === 'text' ? text : space;
    const key = numKey(Number(m[3]));
    if (!map.has(key)) map.set(key, m[1]);
  }
  for (const m of stripComments(source).matchAll(
    /(--slide-leading-[\w-]+)\s*:\s*([\d.]+)\s*;/g
  )) {
    leading.set(numKey(Number(m[2])), m[1]);
  }
  return { text, space, leading };
}

/**
 * Remove every `var(…)` expression from a declaration value, parens balanced
 * so `var(--x, calc(1px + 2px))` goes in one piece. What remains is exactly
 * the *raw* part of the value: a half-converted
 * `padding: 4px var(--slide-space-4)` is the case worth catching, not the case
 * worth excusing.
 *
 * @param {string} value
 * @returns {string}
 */
function stripVarExpressions(value) {
  let out = '';
  for (let i = 0; i < value.length; ) {
    if (value.startsWith('var(', i)) {
      let depth = 0;
      let j = i + 3; // at the '('
      for (; j < value.length; j += 1) {
        if (value[j] === '(') depth += 1;
        else if (value[j] === ')') {
          depth -= 1;
          if (depth === 0) {
            j += 1;
            break;
          }
        }
      }
      i = j; // unterminated var( swallows the rest, which is fine: it is broken CSS
      continue;
    }
    out += value[i];
    i += 1;
  }
  return out;
}

/**
 * @typedef {object} Violation
 * @property {string} file  repo-relative path
 * @property {number} line  1-indexed
 * @property {string} category
 * @property {string} prop
 * @property {string} value the whole declaration value
 * @property {string} token the token this value should be written as
 */

/**
 * Any absolute length in either spelling. `rem` counts: `gap: 0.25rem` is the
 * same rendered value as `gap: 4px` and the same conversion.
 */
const LENGTH_RE = /(-?)(\d*\.?\d+)(px|rem)\b/g;

/** A bare unitless number, for the leading scale. */
const NUMBER_RE = /^-?\d*\.?\d+$/;

/**
 * Find values that exactly equal a slide token but are written literally.
 *
 * The exclusions keep every reported violation fixable by reading:
 *
 *  - `!important` declarations stay literal (cascade patches, tracked in
 *    docs/reference/css-important.md);
 *  - a declaration carrying a **negative** length stays literal as a whole
 *    (a negative margin usually pairs with a positive padding; tokenising
 *    only the positive half puts the pair out of step);
 *  - `0` stays literal; the scales have no zero member;
 *  - `em`/`%`/unitless lengths are relative and never value-identical to a
 *    px token, so they are invisible here (design signals for the sweep);
 *  - `calc(…)` and other function expressions are skipped — a length inside
 *    an expression is not the same declaration shape as a bare token.
 *
 * @param {string} source
 * @param {string} label repo-relative path
 * @param {{text: Map<number, string>, space: Map<number, string>, leading: Map<number, string>}} scales
 * @returns {Violation[]}
 */
function findViolations(source, label, scales) {
  const clean = stripComments(source);
  const out = [];

  for (const [category, props] of Object.entries(CATEGORIES)) {
    const declRe = new RegExp(`(^|[;{])\\s*(${props.join('|')})\\s*:([^;{}]*)`, 'gi');

    for (const decl of clean.matchAll(declRe)) {
      const prop = decl[2].toLowerCase();
      const value = decl[3];
      if (/!important/i.test(value)) continue;

      const raw = stripVarExpressions(value);
      if (/(?:calc|min|max|clamp)\(/i.test(raw)) continue;
      if ([...raw.matchAll(LENGTH_RE)].some((len) => len[1] === '-')) continue;

      // `decl.index` sits on the `;`/`{` *before* the declaration, so measure
      // to the property name itself or every report is one line early.
      const propOffset = decl.index + decl[0].toLowerCase().indexOf(prop);
      const line = clean.slice(0, propOffset).split('\n').length;

      if (category === 'line-height') {
        const trimmed = raw.trim();
        if (!NUMBER_RE.test(trimmed)) continue; // px/em leading: sweep material
        const token = scales.leading.get(numKey(Number(trimmed)));
        if (!token) continue;
        out.push({ file: label, line, category, prop, value: value.trim(), token });
        continue;
      }

      // Each category resolves against its own scale, so a value that lives on
      // both scales (16/20/24/64px) is measured against the right one.
      const scale = category === 'font-size' ? scales.text : scales.space;
      for (const len of raw.matchAll(LENGTH_RE)) {
        const px = numKey(Number(len[2]) * (len[3] === 'rem' ? REM_IN_PX : 1));
        if (px === 0) continue; // 0 stays literal
        const token = scale.get(px);
        if (!token) continue; // off-scale for this category: a design signal, not a conversion
        out.push({ file: label, line, category, prop, value: value.trim(), token });
      }
    }
  }

  return out;
}

const tokensSource = await fs.readFile(tokensFile, 'utf8');
const scales = readScales(tokensSource);

const allSheets = (await cssFiles(slidesDir)).map((f) => path.relative(repoRoot, f));

const files = allSheets.filter((rel) => !EXCLUDED.some((re) => re.test(rel)));

const violations = (
  await Promise.all(
    files.map(async (rel) =>
      findViolations(await fs.readFile(path.join(repoRoot, rel), 'utf8'), rel, scales)
    )
  )
).flat();

/** file → category → count, as the suppressions file records them. */
const counts = new Map();
for (const v of violations) {
  const perFile = counts.get(v.file) || new Map();
  perFile.set(v.category, (perFile.get(v.category) || 0) + 1);
  counts.set(v.file, perFile);
}

if (updating) {
  const next = Object.fromEntries(
    [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, perFile]) => [
        file,
        Object.fromEntries(
          [...perFile.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([category, count]) => [category, { count }])
        ),
      ])
  );
  await fs.writeFile(suppressionsFile, `${JSON.stringify(next, null, 2)}\n`);
}

const suppressions = JSON.parse(await fs.readFile(suppressionsFile, 'utf8'));
const budgetFor = (file, category) => suppressions[file]?.[category]?.count ?? 0;

describe('slide css tokens', () => {
  it('reads the scales out of 00-tokens.css', () => {
    // If this ever comes back empty the gate would pass vacuously, which is
    // the one failure mode a guard must not have.
    assert.ok(
      scales.text.size >= 10,
      `expected the text scale, parsed ${scales.text.size} text tokens`
    );
    assert.ok(
      scales.space.size >= 10,
      `expected the space scale, parsed ${scales.space.size} space tokens`
    );
    for (const px of [14, 20, 44, 80]) {
      assert.ok(scales.text.has(px), `the text scale should carry ${px}px`);
    }
    for (const px of [4, 8, 16, 24, 64]) {
      assert.ok(scales.space.has(px), `the space scale should carry ${px}px`);
    }
    // The shared values must resolve per category, not to whichever scale
    // parsed first — this is the collision the split map fixes.
    assert.strictEqual(scales.text.get(16), '--slide-text-sm');
    assert.strictEqual(scales.space.get(16), '--slide-space-4');
    assert.ok(scales.leading.size >= 4, 'expected the leading scale');
    for (const n of [1.1, 1.2, 1.35, 1.5]) {
      assert.ok(scales.leading.has(n), `the leading scale should carry ${n}`);
    }
  });

  it('finds slide stylesheets to check', () => {
    assert.ok(files.length > 0, `no stylesheets found under ${slidesDir}`);
  });

  it('adds no tokenisable value beyond each file’s burndown budget', () => {
    const over = [];
    for (const [file, perFile] of [...counts.entries()].sort()) {
      for (const [category, count] of [...perFile.entries()].sort()) {
        const budget = budgetFor(file, category);
        if (count <= budget) continue;
        const examples = violations
          .filter((v) => v.file === file && v.category === category)
          .slice(0, 4)
          .map((v) => `      ${v.file}:${v.line}  ${v.prop}: ${v.value}  → ${v.token}`);
        over.push(
          `${file} [${category}]: ${count} tokenisable value(s), budget ${budget}\n${examples.join('\n')}`
        );
      }
    }

    assert.deepStrictEqual(
      over,
      [],
      `${over.length} file/category pair(s) exceed their burndown budget.\n\n` +
        'A value that exactly equals a --slide-text-*, --slide-space-* or\n' +
        '--slide-leading-* token must be written as that token, in either\n' +
        'spelling (16px and 1rem are the same violation). Off-scale values are\n' +
        'fine and are not counted — they are input for the role-vocabulary\n' +
        'sweep, not violations.\n\n' +
        'Do NOT raise a budget in slide-css-suppressions.json to make this\n' +
        'pass. The list may only shrink.'
    );
  });

  it('has no stale burndown entries', () => {
    const stale = [];
    for (const [file, entry] of Object.entries(suppressions)) {
      for (const [category, meta] of Object.entries(entry)) {
        const budget = meta?.count ?? 0;
        const actual = counts.get(file)?.get(category) || 0;
        if (actual < budget) {
          stale.push(`${file} [${category}]: budget ${budget}, actual ${actual}`);
        }
      }
    }
    assert.deepStrictEqual(
      stale.sort(),
      [],
      `${stale.length} burndown budget(s) are now too generous.\n` +
        'Lower them (or delete the entry) — the conversion is that much done:\n' +
        '  UPDATE_SLIDE_CSS_SUPPRESSIONS=1 node --test tests/slide-css-tokens.test.js'
    );
  });

  it('reads no --t-* token outside 00-tokens.css', async () => {
    // The end-state contract check (phase 3 step 6 of the role-vocabulary
    // brief): **no `var(--t-…)` anywhere in the slide bundle outside
    // `00-tokens.css`**. Radius arrived first (batch 2.2a); colour and the
    // per-type families followed in phase 3 steps 2-3; the legacy aliases were
    // the last reads. Every theme lever now enters slide CSS through a
    // `--slide-*` role minted in `00-tokens.css` (or, for the background
    // surfaces and typography locals, `client/styles/theme.css` — outside the
    // bundle and covered by the contract snapshot below).
    //
    // Scope is every sheet in the bundle, presenter chrome included: chrome
    // draws its styling from `--app-*`/`--ps-*`, so a `--t-*` read there is
    // just as wrong as one in slide CSS.
    const reads = [];
    for (const rel of allSheets) {
      if (/\/00-tokens\.css$/.test(rel)) continue;
      const clean = stripComments(await fs.readFile(path.join(repoRoot, rel), 'utf8'));
      for (const m of clean.matchAll(/var\(\s*(--t-[\w-]*)/g)) {
        const line = clean.slice(0, m.index).split('\n').length;
        reads.push(`${rel}:${line}  ${m[1]}`);
      }
    }
    assert.deepStrictEqual(
      reads.sort(),
      [],
      `${reads.length} direct theme-token read(s) in the slide bundle.\n` +
        'Theme influence reaches slide CSS through the --slide-* roles; only\n' +
        '00-tokens.css binds those to the theme contract. Add a role there if\n' +
        'the existing ones do not cover the case — do not read --t-* directly.'
    );
  });

  it('the theme contract matches the committed seam snapshot', async () => {
    // The seam table as a machine check (phase 3 step 6): the theme contract
    // IS the set of `--t-*` tokens the two contract files read —
    // `00-tokens.css` (the roles) and `client/styles/theme.css` (background
    // surfaces, typography locals, logo). A new theme dependency therefore
    // shows up as a diff of `tests/fixtures/theme-contract.json` and has to be
    // a deliberate decision, never a side effect of styling one slide type.
    //
    // Not in the static snapshot, by design: the per-variant
    // `--t-slide-bg-<id>[-text|-text-muted|-link]` tokens generated from a
    // theme's own `slideBackgrounds` (shared/theme-slide-backgrounds.js), and
    // the `--t-ui-*` namespace, which never reaches slide CSS.
    const contractFiles = [
      path.join(slidesDir, '00-tokens.css'),
      path.join(repoRoot, 'client', 'styles', 'theme.css'),
    ];
    const found = new Set();
    for (const file of contractFiles) {
      const clean = stripComments(await fs.readFile(file, 'utf8'));
      for (const m of clean.matchAll(/var\(\s*(--t-[\w-]*)/g)) found.add(m[1]);
    }
    const snapshotFile = path.join(repoRoot, 'tests', 'fixtures', 'theme-contract.json');
    const actual = [...found].sort();
    if (updating) {
      await fs.writeFile(snapshotFile, JSON.stringify(actual, null, 2) + '\n');
      return;
    }
    const expected = JSON.parse(await fs.readFile(snapshotFile, 'utf8'));
    assert.deepStrictEqual(
      actual,
      expected,
      'The set of --t-* tokens the contract files read changed. If the new\n' +
        'contract is intended, regenerate the snapshot:\n' +
        '  UPDATE_SLIDE_CSS_SUPPRESSIONS=1 node --test tests/slide-css-tokens.test.js\n' +
        'and account for it in docs/reference/slide-roles.md § The theme seam.'
    );
  });

  it('lists no file that is out of scope', () => {
    // A suppressions entry for an excluded or deleted sheet would be dead
    // weight the gate never re-checks.
    const outOfScope = Object.keys(suppressions).filter((file) => !files.includes(file));
    assert.deepStrictEqual(
      outOfScope.sort(),
      [],
      'burndown entries for files the gate does not scan; delete them'
    );
  });
});
