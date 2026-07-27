#!/usr/bin/env node
// Advisory scanner for CSS class selectors that no source file references.
//
// WHY THIS EXISTS
// `lint:deadcode` counts unused JS *exports*; an orphaned CSS selector is
// invisible to it. When a reorganisation removes the markup that used a class
// (e.g. #393 dropping the editor header row), the selector is left behind, green
// in CI, seen by nobody. This is the CSS half of that blind spot.
//
// WHY IT IS ADVISORY, NOT A CI GATE (yet)
// Class names here are not only written as literals — they are *composed*:
// `slide-bg-${id}`, `is-${state}`, `tf-align-${x}`, and template-literal builds
// in `renderHtml`. A naive scanner flags every composed class as dead and is
// worse than nothing. So the bias is deliberately conservative: it errs towards
// calling a class ALIVE (harvesting every string/template token as "used" and
// treating any static chunk that precedes a `${` as a live prefix), and only
// reports a selector when it appears NOWHERE — not as a literal, not as the
// prefix of a composed name. Under-reporting is the intended failure mode;
// over-reporting is the one that makes the tool untrustworthy. Promote to a gate
// only once the report is clean.
//
// SCOPE IS TRACKED FILES, NOT THE WORKING TREE (the #413 lesson)
// The gate measures `git ls-files`, not a filesystem walk. A class used only by
// an untracked scratch file must still count as dead, otherwise "green for the
// author" is not "green in CI".
//
// Run: npm run lint:deadcss   (report-only, always exits 0)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CLASS_TOKEN = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;

/**
 * A tracked file is a *source* file (its literals may reference classes) when it
 * is a `.js`/`.html` under `client/` or `shared/`. Stylesheets are excluded by
 * extension.
 * @param {string} file - Repo-relative path
 * @returns {boolean}
 */
export const isSourceFile = (file) =>
  (file.startsWith('client/') || file.startsWith('shared/')) &&
  (file.endsWith('.js') || file.endsWith('.html'));

/**
 * A tracked file is a *CSS* file we hold accountable when it is a `.css` under
 * `client/styles/`.
 * @param {string} file - Repo-relative path
 * @returns {boolean}
 */
export const isCssFile = (file) => file.startsWith('client/styles/') && file.endsWith('.css');

/**
 * List every tracked file, repo-relative. Uses `git ls-files` so the scan sees
 * exactly what CI sees — never the working tree (the #413 lesson). Filtering by
 * extension/prefix happens in JS rather than via git pathspec globs, whose `**`
 * semantics silently drop top-level files like `client/index.html`.
 * @returns {string[]}
 */
export function trackedFiles(cwd = REPO_ROOT) {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

/**
 * Harvest class-name evidence from a chunk of source text.
 *
 * Two kinds of evidence, both conservative:
 *   - `used`: every whitespace-delimited token inside a string or template
 *     literal that looks like a class name. Non-class strings leak in too, which
 *     only ever marks a selector alive — the safe direction.
 *   - `prefixes`: the last token of any static template chunk that sits directly
 *     before a `${` interpolation, e.g. `slide-bg-` in `` `slide-bg-${id}` ``.
 *     A selector starting with such a prefix is treated as composed, not dead.
 *
 * @param {string} text - Source file contents
 * @param {{used: Set<string>, prefixes: Set<string>}} acc - Accumulator to fill
 * @returns {{used: Set<string>, prefixes: Set<string>}}
 */
export function harvestSource(text, acc = { used: new Set(), prefixes: new Set() }) {
  // Quoted strings: 'x', "x". Group 2 is the (unescaped-enough) content.
  const quoted = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  for (let m; (m = quoted.exec(text)); ) {
    addTokens(m[2], acc.used);
  }

  // Template literals: `...` possibly containing ${...} holes. We do not try to
  // balance nested backticks perfectly — a pragmatic match is enough for an
  // advisory harvest, and any miss only risks a false "alive", never a false
  // "dead".
  const template = /`((?:\\.|[^`\\])*)`/g;
  for (let m; (m = template.exec(text)); ) {
    const body = m[1];
    // Static chunks are the parts between ${...} holes.
    const chunks = body.split(/\$\{[^}]*\}/g);
    chunks.forEach((chunk, i) => {
      addTokens(chunk, acc.used);
      // Every chunk except the last is immediately followed by an interpolation,
      // so its trailing token is a composition prefix (`slide-bg-`, `is-`).
      if (i < chunks.length - 1) {
        const tail = chunk.split(/\s/).pop();
        if (tail && /[_a-zA-Z][\w-]*-?$/.test(tail)) acc.prefixes.add(tail);
      }
    });
  }
  return acc;
}

/**
 * Split a literal's content on whitespace and add class-like tokens to a set.
 * @param {string} chunk - Literal content
 * @param {Set<string>} into - Destination set
 */
function addTokens(chunk, into) {
  for (const token of chunk.split(/\s+/)) {
    if (CLASS_TOKEN.test(token)) into.add(token);
  }
}

// At-rules whose block is a *group* — it holds nested rulesets, so selectors
// still appear inside it (`@media { .foo {} }`). Everything else that opens a
// `{` is a declaration block, whose body is property values, not selectors.
const GROUP_AT_RULE = /^@(media|supports|container|layer|scope|document)\b/i;

/**
 * Extract class selectors from CSS, with their line numbers.
 *
 * A single-pass scanner tracking comment / string state and a stack of block
 * kinds. Class tokens are only read in *selector* context — at the top level or
 * nested directly inside a group at-rule — never inside a declaration block
 * (`margin: .5em`), a string (`content: ".x"`), or a `url(...)`.
 *
 * @param {string} text - CSS file contents
 * @param {string} file - Repo-relative path, for the returned records
 * @returns {Array<{name: string, file: string, line: number}>}
 */
export function extractCssClasses(text, file) {
  const found = [];
  let line = 1;
  let inComment = false;
  let stringCh = '';
  /** @type {boolean[]} true = declaration block, false = group at-rule block */
  const stack = [];
  let preludeStart = 0; // start of the text preceding the next `{`
  const inSelectorContext = () => stack.every((isDecl) => isDecl === false);

  for (let i = 0; i < text.length; ) {
    const ch = text[i];
    if (ch === '\n') {
      line++;
      i++;
      continue;
    }
    if (inComment) {
      if (ch === '*' && text[i + 1] === '/') {
        inComment = false;
        i += 2;
      } else i++;
      continue;
    }
    if (stringCh) {
      if (ch === '\\') i += 2;
      else if (ch === stringCh) {
        stringCh = '';
        i++;
      } else i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      inComment = true;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      stringCh = ch;
      i++;
      continue;
    }
    // Skip url(...) wholesale: its argument may be unquoted and contain dots.
    if ((ch === 'u' || ch === 'U') && /^url\(/i.test(text.slice(i, i + 4))) {
      const close = text.indexOf(')', i);
      i = close === -1 ? text.length : close + 1;
      continue;
    }
    if (ch === '{') {
      const prelude = text.slice(preludeStart, i).trim();
      stack.push(!GROUP_AT_RULE.test(prelude)); // true = declaration block
      preludeStart = i + 1;
      i++;
      continue;
    }
    if (ch === '}') {
      stack.pop();
      preludeStart = i + 1;
      i++;
      continue;
    }
    if (ch === ';') {
      preludeStart = i + 1; // e.g. `@import ...;` — reset the prelude window
      i++;
      continue;
    }
    if (ch === '.' && inSelectorContext()) {
      const m = /^\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/.exec(text.slice(i));
      if (m) {
        found.push({ name: m[1], file, line });
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
  return found;
}

/**
 * Decide whether a class name is referenced by the harvested source evidence.
 * @param {string} name - CSS class name
 * @param {{used: Set<string>, prefixes: Set<string>}} evidence - From harvestSource
 * @returns {boolean}
 */
export function isAlive(name, evidence) {
  if (evidence.used.has(name)) return true;
  // Composed via a live prefix: `.slide-bg-red` under prefix `slide-bg-`.
  for (const p of evidence.prefixes) {
    if (p && name.startsWith(p)) return true;
  }
  // The class is itself the static base of a composed literal: `.card` when the
  // source only ever writes `card-header` as a literal token.
  for (const t of evidence.used) {
    if (t.startsWith(name + '-')) return true;
  }
  return false;
}

/**
 * Full scan: harvest source evidence, extract CSS classes, return the dead ones.
 * @param {Object} opts
 * @param {string[]} opts.sourceFiles - Repo-relative source paths
 * @param {string[]} opts.cssFiles - Repo-relative CSS paths
 * @param {(p: string) => string} [opts.read] - File reader (injectable for tests)
 * @returns {{dead: Array<{name, file, line}>, totalClasses: number, evidence}}
 */
export function scan({ sourceFiles, cssFiles, read = defaultRead }) {
  const evidence = { used: new Set(), prefixes: new Set() };
  for (const file of sourceFiles) harvestSource(read(file), evidence);

  const byName = new Map();
  for (const file of cssFiles) {
    for (const rec of extractCssClasses(read(file), file)) {
      if (!byName.has(rec.name)) byName.set(rec.name, rec);
    }
  }

  const dead = [];
  for (const [name, rec] of byName) {
    if (!isAlive(name, evidence)) dead.push(rec);
  }
  dead.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name));
  return { dead, totalClasses: byName.size, evidence };
}

const defaultRead = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** CLI entry: scan the tracked tree and print an advisory report. */
function main() {
  const all = trackedFiles();
  const sourceFiles = all.filter(isSourceFile);
  const cssFiles = all.filter(isCssFile);
  const { dead, totalClasses } = scan({ sourceFiles, cssFiles });

  if (dead.length === 0) {
    console.log(
      `lint:deadcss — no unreferenced selectors across ${totalClasses} classes ` +
        `in ${cssFiles.length} CSS files. ✅`
    );
    return;
  }

  console.log(
    `lint:deadcss (advisory) — ${dead.length} of ${totalClasses} CSS classes look ` +
      `unreferenced by ${sourceFiles.length} source files.\n` +
      `Composed names (\`slide-bg-\${id}\`, \`is-\${state}\`) are treated as alive; a\n` +
      `listed selector appears nowhere as a literal or a composition prefix. Verify\n` +
      `before deleting — this is a hint, not a verdict.\n`
  );
  for (const rec of dead) {
    console.log(`  ${rec.file}:${rec.line}  .${rec.name}`);
  }
  console.log(`\n${dead.length} unreferenced selector(s). Report-only; exit 0.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
