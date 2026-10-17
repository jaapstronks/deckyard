/**
 * Breakpoint ladder guard.
 *
 * Deckyard has one shared breakpoint ladder (docs/reference/css-breakpoints.md).
 * Custom properties are not allowed in media conditions and there is no build
 * step to compile `@custom-media`, so the ladder cannot be a variable — it is
 * enforced here instead.
 *
 * Four checks:
 *  1. every width condition in client/styles/** is on the ladder (or allowlisted)
 *  2. width conditions are expressed in px
 *  3. width conditions use the `min-width:`/`max-width:` colon form, so the
 *     Media Queries 4 range syntax cannot silently bypass check 1
 *  4. the allowlist has no stale entries, so migrations shrink it monotonically
 *
 * Run with: node --test tests/css-breakpoints.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const stylesDir = path.join(repoRoot, 'client', 'styles');

/** The ladder. Keep in sync with docs/reference/css-breakpoints.md. */
const LADDER = {
  max: [480, 640, 768, 1023, 1280],
  /** Rung counterparts are one pixel up, plus the ultra-wide scale. */
  min: [481, 641, 769, 1024, 1281, 1400, 1600, 1800],
};

/**
 * Width conditions that predate the ladder and have not been migrated yet.
 *
 * The migration is complete: every width `@media` in client/styles/** is on
 * the ladder, so this list is empty and the guard now enforces the ladder with
 * no exceptions. It may only ever shrink — never add an entry to work around a
 * layout that wants an off-ladder width; change the layout instead.
 * See docs/reference/css-breakpoints.md for the ladder and its rationale.
 */
const ALLOWLIST = [];

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
 * Blank out `/* … *\/` comments, keeping newlines so line numbers stay right.
 * Without this a commented-out query counts as live, which both breaks CI on a
 * harmless edit and keeps a finished migration's allowlist entry looking used.
 *
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    block.replace(/[^\n]/g, ' '),
  );
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
 * @typedef {object} Prelude
 * @property {WidthCondition[]} conditions parsed `min-width:`/`max-width:` pairs
 * @property {string} text                 the raw prelude, for the syntax check
 * @property {string} where                `"path/to.css:12"`
 */

/**
 * Pull every `@media` prelude, and the width conditions in it, out of one
 * stylesheet. At-rule names are case-insensitive in CSS, hence the `i` flag.
 *
 * @param {string} source
 * @param {string} label relative path, used in failure messages
 * @returns {Prelude[]}
 */
function mediaPreludes(source, label) {
  const clean = stripComments(source);
  const out = [];
  for (const media of clean.matchAll(/@media([^{]*)\{/gi)) {
    const where = `${label}:${clean.slice(0, media.index).split('\n').length}`;
    const conditions = [
      ...media[1].matchAll(/(min|max)-width\s*:\s*([\d.]+)([a-z%]*)/gi),
    ].map((cond) => {
      const side = /** @type {'min'|'max'} */ (cond[1].toLowerCase());
      const unit = cond[3].toLowerCase();
      return {
        key: `${side}-width: ${cond[2]}${unit}`,
        side,
        value: Number(cond[2]),
        unit,
        where,
      };
    });
    out.push({ conditions, text: media[1], where });
  }
  return out;
}

/**
 * True when a prelude mentions `width` in a form the condition regex did not
 * consume — i.e. the Media Queries 4 range syntax (`(width <= 600px)`,
 * `(400px <= width <= 900px)`), which would otherwise slip past the ladder.
 *
 * @param {Prelude} prelude
 * @returns {boolean}
 */
function hasUnparsedWidth(prelude) {
  const rest = prelude.text.replace(
    /(min|max)-width\s*:\s*[\d.]+[a-z%]*/gi,
    '',
  );
  return /\bwidth\b/i.test(rest);
}

const files = await cssFiles(stylesDir);
const preludes = (
  await Promise.all(
    files.map(async (file) =>
      mediaPreludes(
        await fs.readFile(file, 'utf8'),
        path.relative(repoRoot, file),
      ),
    ),
  )
).flat();
const found = preludes.flatMap((p) => p.conditions);

const allowed = new Set(ALLOWLIST);
const onLadder = (c) => c.unit === 'px' && LADDER[c.side].includes(c.value);

describe('css breakpoints', () => {
  it('finds media queries to check', () => {
    assert.ok(
      found.length > 0,
      `no @media width conditions found under ${stylesDir}`,
    );
  });

  it('expresses every width condition in px', () => {
    const wrong = found.filter((c) => c.unit !== 'px');
    assert.deepStrictEqual(
      wrong.map((c) => `${c.where}  ${c.key}`).sort(),
      [],
      'Media query widths must use px (see docs/reference/css-breakpoints.md).',
    );
  });

  it('uses the min-width:/max-width: colon form only', () => {
    const ranged = preludes.filter(hasUnparsedWidth);
    assert.deepStrictEqual(
      ranged.map((p) => `${p.where}  @media${p.text.trim()}`).sort(),
      [],
      'Media Queries 4 range syntax such as (width <= 600px) is not checkable\n' +
        'against the ladder. Use (max-width: 600px) / (min-width: 601px).',
    );
  });

  it('keeps every width condition on the ladder', () => {
    const off = found.filter((c) => !onLadder(c) && !allowed.has(c.key));
    assert.deepStrictEqual(
      off.map((c) => `${c.where}  ${c.key}`).sort(),
      [],
      `${off.length} width condition(s) off the breakpoint ladder.\n` +
        `Use 480/640/768/1023/1280 (or min-width 481/641/769/1024/1281, or the\n` +
        `ultra-wide 1400/1600/1800). See docs/reference/css-breakpoints.md.\n` +
        `Do not extend the ALLOWLIST in this file — it may only shrink.`,
    );
  });

  it('has no stale allowlist entries', () => {
    const live = new Set(found.map((c) => c.key));
    const stale = ALLOWLIST.filter((key) => !live.has(key));
    assert.deepStrictEqual(
      stale.sort(),
      [],
      `${stale.length} allowlisted value(s) no longer appear in client/styles/**.\n` +
        `Delete them from ALLOWLIST in this file — the migration is that much done.`,
    );
  });
});

/**
 * The editor's JS half of the ladder (D339). JS cannot read a CSS rung either,
 * so the editor names its widths in one module, as media queries on the
 * ladder, and nothing else in the editor measures the viewport itself: the 820
 * a drawer once used in JS beside a 768 in CSS is the drift this pins.
 */
describe('editor JS breakpoints', () => {
  const editorDir = path.join(repoRoot, 'client', 'views', 'editor');
  const queriesFile = path.join(editorDir, 'responsive-drawers.js');
  // A breakpoint, not a measurement: the viewport width tested against a
  // threshold (a literal or a constant), or a width media query. Clamping a
  // menu to `innerWidth` is fine.
  const WIDTH_BREAKPOINT =
    /innerWidth\s*[<>]|\d\s*[<>]=?\s*(window\.)?innerWidth|matchMedia\??\.?\(\s*['"`]\((max|min)-width/;

  /** @param {string} dir @returns {Promise<string[]>} */
  async function jsFiles(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await jsFiles(full)));
      else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out.sort();
  }

  it('names its widths only in responsive-drawers.js, on the ladder', async () => {
    const source = await fs.readFile(queriesFile, 'utf8');
    const queries = [
      ...source.matchAll(/_QUERY = '\((max|min)-width: (\d+)px\)'/g),
    ];
    assert.ok(queries.length >= 2, 'the drawer queries are declared');
    for (const [, side, px] of queries) {
      assert.ok(
        LADDER[side].includes(Number(px)),
        `${side}-width: ${px}px is not a rung of the ladder`,
      );
    }
  });

  // D351: an iPad in landscape is exactly 1024px wide and gets the full
  // three-column editor; the inspector becomes a drawer one pixel below.
  // Evaluated on both sides, in JS and in the stylesheet that draws it.
  it('keeps 1024 on the desktop side and 1023 compact', async () => {
    const { COMPACT_EDITOR_QUERY } =
      await import('../client/views/editor/responsive-drawers.js');
    /** @param {string} query @param {number} width */
    const matches = (query, width) =>
      [...query.matchAll(/\((max|min)-width: (\d+)px\)/g)].every(
        ([, side, px]) =>
          side === 'max' ? width <= Number(px) : width >= Number(px),
      );
    assert.strictEqual(matches(COMPACT_EDITOR_QUERY, 1024), false);
    assert.strictEqual(matches(COMPACT_EDITOR_QUERY, 1023), true);

    const layout = await fs.readFile(
      path.join(stylesDir, 'app', 'editor', '20-editor-layout.css'),
      'utf8',
    );
    const queries = [...layout.matchAll(/@media ([^{]*width[^{]*)\{/g)].map(
      ([, q]) => q.trim(),
    );
    assert.ok(
      queries.includes(COMPACT_EDITOR_QUERY),
      `20-editor-layout.css has a ${COMPACT_EDITOR_QUERY} block`,
    );
    // Every block bounded at the lg rung agrees with the JS: the compact
    // side stops at 1023, the desktop side starts at 1024.
    for (const q of queries.filter((q) => /max-width: 102\dpx/.test(q))) {
      assert.strictEqual(matches(q, 1024), false, `${q} reaches 1024`);
    }
    for (const q of queries.filter((q) => /min-width: 102\dpx/.test(q))) {
      assert.deepStrictEqual(
        [matches(q, 1023), matches(q, 1024)],
        [false, true],
        `${q} starts at 1024`,
      );
    }
  });

  it('sets no width breakpoint outside that module', async () => {
    const offenders = [];
    for (const file of await jsFiles(editorDir)) {
      if (file === queriesFile) continue;
      const source = await fs.readFile(file, 'utf8');
      if (WIDTH_BREAKPOINT.test(source))
        offenders.push(path.relative(repoRoot, file));
    }
    assert.deepStrictEqual(
      offenders,
      [],
      'Use COMPACT_EDITOR_QUERY / SLIDES_DRAWER_QUERY from responsive-drawers.js.',
    );
  });
});
