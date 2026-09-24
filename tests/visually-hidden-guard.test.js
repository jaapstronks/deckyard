/**
 * One visually-hidden utility (B361).
 *
 * Hiding something from the eye while keeping it in the accessibility tree
 * had four spellings in `client/styles/`: `.sr-only`, `.visually-hidden` and
 * two inline copies of the block inside topbar media queries, with two clip
 * idioms between them. The form now is one class, `.sr-only` in
 * `slides/03-components/60-accessibility.css` (slides.css loads in the app
 * shell and in every export), with one idiom, `clip-path: inset(50%)`. A
 * label that hides only at some widths uses `display: none` and gives its
 * control a name of its own instead of copying the block into a query.
 *
 * This test pins that:
 *
 * 1. The clip idiom that makes the block (`clip-path: inset(50%)`, or the
 *    older `clip: rect(...)`) appears exactly once in `client/styles/`, in
 *    the `.sr-only` rule. A second copy of the block needs it, so this is the
 *    check that catches one.
 * 2. No other class name for the same idea is declared in `client/styles/`
 *    or set from `client/` / `shared/` code.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const STYLES_ROOT = 'client/styles';
const UTILITY_FILE = 'client/styles/slides/03-components/60-accessibility.css';
const CODE_ROOTS = ['client', 'shared'];
const SKIP_DIRS = new Set(['vendor', 'node_modules']);

/** Spellings of the same utility that must not come back. */
const RETIRED_NAMES = [
  'visually-hidden',
  'visuallyhidden',
  'screen-reader-only',
  'screenreader-only',
  'sr-only-focusable',
];

const CLIP_IDIOM = /\bclip-path\s*:\s*inset\(\s*50%\s*\)|\bclip\s*:\s*rect\(/g;

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some((ext) => name.endsWith(ext))) out.push(full);
  }
  return out;
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
/** Comments may name the idea; only code that declares or sets it counts. */
const stripJsComments = (js) =>
  stripComments(js).replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

test('the visually-hidden block exists once, as .sr-only', () => {
  const hits = [];
  for (const file of walk(STYLES_ROOT, ['.css'])) {
    const css = stripComments(readFileSync(file, 'utf8'));
    for (const m of css.matchAll(CLIP_IDIOM)) hits.push(`${file}: ${m[0]}`);
  }
  assert.deepEqual(
    hits,
    [`${UTILITY_FILE}: clip-path: inset(50%)`],
    'visually hiding something is `.sr-only` on the element; a label that ' +
      'hides at some widths uses `display: none` and names its control',
  );

  const css = stripComments(readFileSync(UTILITY_FILE, 'utf8'));
  const rule = css.match(/(^|\})\s*\.sr-only\s*\{([^}]*)\}/);
  assert.ok(rule, '.sr-only is declared on its own in the utility sheet');
  assert.match(rule[2], /clip-path\s*:\s*inset\(50%\)/);
});

test('no second class name for visually-hidden', () => {
  const hits = [];
  const files = [
    ...walk(STYLES_ROOT, ['.css']),
    ...CODE_ROOTS.flatMap((root) => walk(root, ['.js', '.html'])),
  ];
  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const text = file.endsWith('.css')
      ? stripComments(raw)
      : stripJsComments(raw);
    for (const name of RETIRED_NAMES) {
      if (new RegExp(`\\b${name}\\b`).test(text)) hits.push(`${file}: ${name}`);
    }
  }
  assert.deepEqual(hits, [], 'use `.sr-only`, the one spelling');
});
