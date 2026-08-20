/**
 * Guard: one source for UI-chrome icons (A7.16 cluster 5).
 *
 * Chrome glyphs come from `icon()` in `client/lib/dom/icons.js`, which masks a
 * vendored Lucide SVG with `currentColor`. Everything else — an inline `<svg>`
 * string, an `h('svg', …)` tree, a hand-rolled `createElementNS` — is a second
 * copy of a glyph we already ship, free to drift from the vendored set.
 *
 * Two assertions:
 *  1. No inline SVG construction in `client/**` outside `lib/dom/icons.js`,
 *     except the PERMANENT allowlist below — a real drawing, or the DOM
 *     primitive itself. The PR I2 burndown that stood beside it is empty:
 *     every hand-drawn chrome glyph is an `icon()` call now, so the list can
 *     only grow again by an argued addition, never by drift.
 *  2. Every name passed to `icon()` is vendored, so a typo fails here instead
 *     of rendering an invisible span.
 *
 * Run with: node --test tests/inline-svg-single-source.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UI_ICON_NAMES } from '../shared/icon-names.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const CLIENT_DIR = path.join(repoRoot, 'client');
const ICONS_MODULE = 'client/lib/dom/icons.js';

// Real drawings and the DOM primitive: these construct SVG geometry, not a
// glyph from the icon set, so they never become an icon() call.
const PERMANENT = {
  'client/lib/dom.js':
    'the h() primitive itself — it routes SVG tag names through createElementNS',
  'client/lib/slide-runtime/likert.js':
    'draws the likert scale (axis, ticks, markers), not an icon',
  'client/lib/slide-authoring/slide-schematic.js':
    'draws the abstract slide-layout schematic, not an icon',
  'client/views/analytics/timeline-chart.js':
    'draws chart geometry (axes, bars, gridlines), not an icon',
};

const ALLOWED = new Set(Object.keys(PERMANENT));

// `'<svg …'` in a string literal; `h('svg', …)` / `svgEl('svg', …)`, which
// may wrap the tag name onto its own line; a hand-rolled namespaced element.
const PATTERNS = [
  [/['"`]\s*<svg/, 'inline <svg> string literal'],
  [/\(\s*[\r\n\s]*['"]svg['"]\s*,/, "h('svg', …) element tree"],
  [/\.createElementNS\(/, 'createElementNS'],
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'vendor') continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

function scan() {
  const hits = new Map();
  for (const file of walk(CLIENT_DIR)) {
    const rel = path.relative(repoRoot, file);
    if (rel === ICONS_MODULE) continue;
    const src = fs.readFileSync(file, 'utf8');
    const found = PATTERNS.filter(([re]) => re.test(src)).map(([, why]) => why);
    if (found.length) hits.set(rel, found);
  }
  return hits;
}

test('inline SVG lives only in lib/dom/icons.js, drawings aside', () => {
  const offenders = [...scan().entries()]
    .filter(([rel]) => !ALLOWED.has(rel))
    .map(([rel, why]) => `${rel}: ${why.join(', ')}`);
  assert.deepEqual(
    offenders,
    [],
    `Hand-built SVG outside client/lib/dom/icons.js:\n  ${offenders.join('\n  ')}\n` +
      "Use icon('lucide-name') from client/lib/dom/icons.js for UI chrome, or " +
      'iconUrl() in an <img> for data-driven icons. Only genuine drawings ' +
      'belong on the allowlist, each with a reason.',
  );
});

test('allowlist entries still construct SVG (stale entries must be removed)', () => {
  const hits = scan();
  const stale = [...ALLOWED].filter((rel) => !hits.has(rel));
  assert.deepEqual(
    stale,
    [],
    `Stale allowlist entr(y/ies) — migrated files must drop off the list:\n  ${stale.join('\n  ')}`,
  );
});

test('every icon() name is vendored', () => {
  const declared = new Set(UI_ICON_NAMES);
  const unknown = [];
  const unvendored = [];
  for (const file of walk(CLIENT_DIR)) {
    const rel = path.relative(repoRoot, file);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bicon\(\s*['"]([a-z0-9-]+)['"]/g)) {
      const name = m[1];
      if (!declared.has(name)) unknown.push(`${rel}: ${name}`);
      const svg = path.join(
        repoRoot,
        'client/vendor/lucide-icons',
        `${name}.svg`,
      );
      if (!fs.existsSync(svg)) unvendored.push(`${rel}: ${name}`);
    }
  }
  assert.deepEqual(
    unknown,
    [],
    `icon() called with a name that is not in UI_ICON_NAMES (shared/icon-names.js):\n  ${unknown.join('\n  ')}`,
  );
  assert.deepEqual(
    unvendored,
    [],
    `icon() name has no vendored SVG — run \`npm run vendor:lucide\`:\n  ${unvendored.join('\n  ')}`,
  );
});

test('every UI_ICON_NAMES entry is vendored', () => {
  const missing = UI_ICON_NAMES.filter(
    (n) =>
      !fs.existsSync(
        path.join(repoRoot, 'client/vendor/lucide-icons', `${n}.svg`),
      ),
  );
  assert.deepEqual(
    missing,
    [],
    `Declared UI icon(s) with no vendored SVG — run \`npm run vendor:lucide\`:\n  ${missing.join('\n  ')}`,
  );
});
