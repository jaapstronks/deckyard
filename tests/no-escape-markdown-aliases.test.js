/**
 * Guard: one canonical name per concept for the two HTML/markdown helpers
 * (A7.21 PR A, decision D30).
 *
 *   - `escapeHtml` (shared/slide-types/helpers.js) — the HTML escaper. The
 *     former second spelling `esc` is gone; nothing may re-introduce it, as a
 *     bare export, an `as esc` alias, or an `import { esc }` from the helpers.
 *   - `markdownToSafeHtml` (shared/markdown.js) — the markdown renderer. The
 *     former `renderMarkdown` alias is gone under the same rule.
 *   - `escapeXml` (shared/xml.js) — the XML escaper, for the two sinks that
 *     need `&apos;` instead of `&#039;`.
 *
 * The first two checks measure *imports*, which is how four hand-written
 * copies (`escAttr`, `escHtml`, two `escapeXml`s) lived under three names
 * without tripping this guard: a locally redefined escaper imports nothing.
 * The third check therefore measures *bodies* — any `.replace(/&/g, '&amp;')`
 * chain outside the three canonical modules (B101).
 *
 * A second accepted spelling for one meaning is tolerance-creep (CLAUDE.md
 * § beta doctrine); this keeps the surface at one name.
 *
 * Run with: node --test tests/no-escape-markdown-aliases.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

const SKIP_DIRS = new Set(['vendor', 'node_modules']);
const SOURCE_TREES = ['client', 'server', 'shared', 'custom'];

// A local `const esc` unrelated to the helper lives here; it imports nothing
// from the helpers, so the import-based checks never see it. Named for clarity.
const LOCAL_ESC_FILE = 'client/views/presenter/interactions.js';

/** The only modules allowed to spell out an entity-escaping chain. */
const CANONICAL_ESCAPER_FILES = new Set([
  'shared/slide-types/helpers.js',
  'shared/sanitize.js',
  'shared/xml.js',
]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const sourceFiles = SOURCE_TREES.flatMap((t) => walk(path.join(repoRoot, t)));

/** Destructured tokens of every `import { … } from '<path><name>.js'`. */
function importTokensFrom(src, moduleBasename) {
  const re = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*['"][^'"]*${moduleBasename}['"]`,
    'g',
  );
  const tokens = [];
  for (const m of src.matchAll(re)) {
    for (const raw of m[1].split(',')) {
      const tok = raw.trim();
      if (tok) tokens.push(tok);
    }
  }
  return tokens;
}

test('the escape helper is only ever named escapeHtml', () => {
  const violations = [];
  for (const file of sourceFiles) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');

    // No one imports the removed `esc` name from the slide-type helpers.
    for (const tok of importTokensFrom(src, 'helpers.js')) {
      if (tok === 'esc' || /\bas\s+esc$/.test(tok)) {
        violations.push(
          `${rel}: imports '${tok}' from a helpers module — use escapeHtml`,
        );
      }
    }
    // No re-aliasing back to `esc` anywhere.
    if (/\bas\s+esc\b/.test(src)) {
      violations.push(
        `${rel}: re-aliases something 'as esc' — escapeHtml is the only name`,
      );
    }
    // The helper module itself exports escapeHtml, never a bare `esc`.
    if (rel === 'shared/slide-types/helpers.js') {
      assert.match(
        src,
        /export function escapeHtml\b/,
        'helpers.js must export escapeHtml',
      );
      assert.doesNotMatch(
        src,
        /export\s+function\s+esc\b/,
        'helpers.js must not export esc',
      );
      assert.doesNotMatch(
        src,
        /export\s*\{[^}]*\besc\b/,
        'helpers.js must not re-export esc',
      );
    }
  }
  assert.equal(
    violations.length,
    0,
    `esc alias re-introduced:\n  ${violations.join('\n  ')}`,
  );
});

test('the markdown renderer is only ever named markdownToSafeHtml', () => {
  const violations = [];
  for (const file of sourceFiles) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');

    for (const tok of importTokensFrom(src, 'markdown.js')) {
      if (tok === 'renderMarkdown' || /\bas\s+renderMarkdown$/.test(tok)) {
        violations.push(
          `${rel}: imports '${tok}' from markdown.js — use markdownToSafeHtml`,
        );
      }
    }
    if (/\bas\s+renderMarkdown\b/.test(src)) {
      violations.push(
        `${rel}: re-aliases something 'as renderMarkdown' — use markdownToSafeHtml`,
      );
    }
    if (rel === 'shared/markdown.js') {
      assert.match(src, /export function markdownToSafeHtml\b/);
      assert.doesNotMatch(
        src,
        /\bas\s+renderMarkdown\b/,
        'markdown.js must not alias renderMarkdown',
      );
    }
  }
  assert.equal(
    violations.length,
    0,
    `renderMarkdown alias re-introduced:\n  ${violations.join('\n  ')}`,
  );
});

test('the local-esc file is documented and still exists (its esc is not the helper)', () => {
  assert.ok(
    fs.existsSync(path.join(repoRoot, LOCAL_ESC_FILE)),
    `${LOCAL_ESC_FILE} named as the local-esc exception no longer exists — update this guard.`,
  );
});

// ------------------------------------------------------------------
// Body check: no fifth hand-written escaper (B101)
// ------------------------------------------------------------------

/** The opening link of every entity-escaping chain in this codebase. */
const ESCAPE_CHAIN_START = /\.replace\(\s*\/&\/g\s*,\s*'&amp;'\s*\)/g;

/**
 * One `.replace(/re/g, 'literal')` link, with comments allowed between links.
 *
 * The comment branch ends on a lookahead at the newline, so it cannot split a
 * run of slashes with the whitespace branch — that ambiguity is exponential
 * backtracking (CodeQL js/redos).
 */
const NEXT_LINK =
  /(?:\s|\/\/[^\n]*(?=\n))*\.replace\(\s*\/(?:[^/\\\n]|\\.)*\/[gimsuy]*\s*,\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*\)/y;

const ENTITY_LITERAL = /^['"]&[#a-zA-Z0-9]+;['"]$/;

/**
 * The replacement literals of the `.replace()` chain that starts at `from`.
 * @param {string} src - File source
 * @param {number} from - Index just past the `&amp;` link
 * @returns {string[]} Replacement literals, in chain order
 */
function chainReplacements(src, from) {
  const out = [];
  NEXT_LINK.lastIndex = from;
  let m;
  while ((m = NEXT_LINK.exec(src))) {
    out.push(m[1]);
    NEXT_LINK.lastIndex = m.index + m[0].length;
  }
  return out;
}

test('no hand-written escaper outside the canonical modules', () => {
  const violations = [];
  for (const file of sourceFiles) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    if (CANONICAL_ESCAPER_FILES.has(rel)) continue;
    const src = fs.readFileSync(file, 'utf8');

    ESCAPE_CHAIN_START.lastIndex = 0;
    let start;
    while ((start = ESCAPE_CHAIN_START.exec(src))) {
      const rest = chainReplacements(src, start.index + start[0].length);
      // A chain that only ever produces entities is an escaper. One that
      // continues into markup (`<span …>`) is a renderer that happens to escape
      // first — legitimate, and not a second spelling of escapeHtml.
      const escapesOnly = rest.every((lit) => ENTITY_LITERAL.test(lit));
      if (escapesOnly) {
        const line = src.slice(0, start.index).split('\n').length;
        violations.push(
          `${rel}:${line}: hand-written escaper — import escapeHtml ` +
            `(shared/slide-types/helpers.js) or escapeXml (shared/xml.js)`,
        );
      }
    }
  }
  assert.equal(
    violations.length,
    0,
    `escaper re-implemented instead of imported:\n  ${violations.join('\n  ')}`,
  );
});

test('the canonical escaper modules still hold the escapers', () => {
  for (const rel of CANONICAL_ESCAPER_FILES) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    assert.match(
      src,
      new RegExp(ESCAPE_CHAIN_START.source),
      `${rel} no longer contains an escaping chain — update the guard's list.`,
    );
  }
});
