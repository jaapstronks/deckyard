/**
 * The card ladder gate (B512, D15, D250).
 *
 * Every card pattern sets the two card text roles per density rung, and every
 * rung sits on one shared ladder: the title exactly one step above the body on
 * the `--slide-text-*` scale, with `xs / xs` as the floor
 * (`docs/reference/slide-roles.md` § The card ladder). This test reads every
 * rule in the slide sheets — core `client/styles/slides/**` plus the fork's
 * `custom/styles/**` — that sets `--slide-font-size-card-title` or
 * `--slide-font-size-card-body`, and asserts:
 *
 *   (a) a rule that sets one of the two sets both — a rung is one decision;
 *   (b) both name a scale step (`var(--slide-text-<step>)`), and
 *       `index(title) − index(body) = 1`, or both are `xs`.
 *
 * There is no allowlist. A card that wants a different pair moves to another
 * rung; a pair off the ladder is the defect, not the exception.
 *
 * Run with: node --test tests/slide-card-ladder.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { customDirFor } from '../shared/custom-root.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const SLIDES_DIR = path.join(REPO_ROOT, 'client', 'styles', 'slides');
const FORK_STYLES_DIR = path.join(customDirFor(REPO_ROOT), 'styles');
const TOKENS_FILE = path.join(SLIDES_DIR, '00-tokens.css');

const TITLE = '--slide-font-size-card-title';
const BODY = '--slide-font-size-card-body';

/** @param {string} dir @returns {Promise<string[]>} .css files, recursively; [] when absent */
async function cssFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await cssFiles(full)));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out.sort();
}

/** Blank out comments, keeping newlines so line numbers stay right. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    block.replace(/[^\n]/g, ' '),
  );
}

/**
 * The text scale in order, read from `00-tokens.css` so the gate cannot drift
 * from the scale it enforces: each `--slide-text-<step>` that is a multiple of
 * the reference unit and named as a text step (`xs`, `sm`, `base`, `md`, `lg`,
 * `xl`, `<n>xl`), sorted by that multiple. The display sizes (`kpi-*`) are
 * multiples of the unit too, but they are not rungs: a card pair on them is
 * refused like a raw length.
 *
 * @param {string} source
 * @returns {string[]} step names, smallest first (`xs`, `sm`, `base`, …)
 */
function readTextScale(source) {
  const steps = [
    ...stripComments(source).matchAll(
      /--slide-text-(xs|sm|base|md|lg|\d*xl)\s*:\s*calc\(\s*([\d.]+)\s*\*\s*var\(\s*--slide-text-unit\s*\)\s*\)\s*;/g,
    ),
  ].map((m) => ({ step: m[1], px: Number(m[2]) }));
  return steps.sort((a, b) => a.px - b.px).map((s) => s.step);
}

/**
 * Every rule in a sheet that sets a card text role, with what it sets. A rule
 * is an innermost `{…}` block, so a rung inside `@media` is read like any
 * other.
 *
 * @param {string} source
 * @returns {{ line: number, title?: string, body?: string }[]}
 */
function cardRules(source) {
  const clean = stripComments(source);
  const out = [];
  for (const block of clean.matchAll(/\{([^{}]*)\}/g)) {
    const decls = {};
    let first = -1;
    for (const d of block[1].matchAll(
      /(--slide-font-size-card-(?:title|body))\s*:\s*([^;]*)/g,
    )) {
      decls[d[1]] = d[2].trim();
      if (first < 0) first = block.index + 1 + d.index;
    }
    if (first < 0) continue;
    out.push({
      line: clean.slice(0, first).split('\n').length,
      title: decls[TITLE],
      body: decls[BODY],
    });
  }
  return out;
}

/**
 * Why a card rule is off the ladder, or `null` when it is on it.
 *
 * @param {{ title?: string, body?: string }} rule
 * @param {string[]} scale
 * @returns {string | null}
 */
function ladderViolation(rule, scale) {
  if (rule.title === undefined || rule.body === undefined) {
    return `sets only ${rule.title === undefined ? 'card-body' : 'card-title'}; a rung sets both`;
  }
  const stepOf = (value) => value.match(/^var\(--slide-text-([\w-]+)\)$/)?.[1];
  const title = stepOf(rule.title);
  const body = stepOf(rule.body);
  if (!scale.includes(title) || !scale.includes(body)) {
    return `${rule.title} / ${rule.body} is not a pair of --slide-text-* steps`;
  }
  if (title === 'xs' && body === 'xs') return null;
  if (scale.indexOf(title) - scale.indexOf(body) === 1) return null;
  return `${title} / ${body} is off the ladder: the title sits exactly one step above the body, or both are xs`;
}

const scale = readTextScale(await fs.readFile(TOKENS_FILE, 'utf8'));
const sheets = [
  ...(await cssFiles(SLIDES_DIR)),
  ...(await cssFiles(FORK_STYLES_DIR)),
];

test('the text scale reads in order from 00-tokens.css', () => {
  assert.deepEqual(scale, [
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
  ]);
});

test('every card rung sets both roles, one step apart or xs / xs', async () => {
  const offLadder = [];
  let rungs = 0;
  for (const file of sheets) {
    const rules = cardRules(await fs.readFile(file, 'utf8'));
    rungs += rules.length;
    for (const rule of rules) {
      const why = ladderViolation(rule, scale);
      if (why) {
        offLadder.push(`${path.relative(REPO_ROOT, file)}:${rule.line} ${why}`);
      }
    }
  }
  // A parser that finds nothing passes vacuously; the card patterns alone
  // carry well over twenty rungs.
  assert.ok(rungs > 20, `expected the card rungs to be found, got ${rungs}`);
  assert.deepEqual(offLadder, [], offLadder.join('\n'));
});

test('the gate refuses what the ladder forbids', () => {
  const rungsOf = (css) =>
    cardRules(css).map((r) => ladderViolation(r, scale) === null);
  // On the ladder: one step apart, the floor, and a rung inside @media.
  assert.deepEqual(
    rungsOf(`
      .a { ${TITLE}: var(--slide-text-lg); ${BODY}: var(--slide-text-md); }
      .b { ${TITLE}: var(--slide-text-xs); ${BODY}: var(--slide-text-xs); }
      @media (max-width: 1024px) {
        .c { ${TITLE}: var(--slide-text-md); ${BODY}: var(--slide-text-base); }
      }`),
    [true, true, true],
  );
  // Off it: a two-step gap, a zero gap, one role alone, a raw length, and a
  // pair of display sizes that sit next to each other but are no text steps.
  assert.deepEqual(
    rungsOf(`
      .a { ${TITLE}: var(--slide-text-xl); ${BODY}: var(--slide-text-md); }
      .b { ${TITLE}: var(--slide-text-md); ${BODY}: var(--slide-text-md); }
      .c { ${BODY}: var(--slide-text-sm); }
      .d { ${TITLE}: 28px; ${BODY}: var(--slide-text-md); }
      .e { ${TITLE}: var(--slide-text-kpi-md); ${BODY}: var(--slide-text-kpi-sm); }`),
    [false, false, false, false, false],
  );
});
