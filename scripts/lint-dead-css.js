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
// calling a class ALIVE, and only reports a selector it cannot account for.
// Under-reporting is the intended failure mode; over-reporting is the one that
// makes the tool untrustworthy. Promote to a gate only once the report is clean.
//
// A COMPOSED NAME MUST BE ASSEMBLABLE, NOT MERELY PREFIXED (the #1037 lesson)
// The first version treated any static chunk preceding a `${` as a live prefix
// and rescued every name starting with it. That is an unbounded wildcard, and
// `slideRootClass()` writes `` `slide-${canonicalTypeName(name)}` `` — so
// `slide-` became a live prefix and the *entire slide layer* was declared alive
// sight unseen. The dead half of `00-patterns.css` never reached the report.
// The same loophole let junk tails (`c`, `n`, `v`, `row`) from unrelated
// template literals whitelist whole families.
//
// So a prefix no longer rescues a name on its own: the *remainder* must be a
// value the source actually writes — a harvested token, or a run of digits for
// index holes like `chart-slice-${i % 8}`. A hole is filled with a value, and
// the values in this codebase are enum members, sizes and states that appear as
// literals somewhere. Two-hole builds (`` ` ${base}--${t}` `` in
// `shared/slide-types/partials.js`) leave no usable prefix at all, so a static
// chunk sitting *between* two holes is harvested as an infix and the name is
// alive when both sides of it are values.
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

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const CLASS_TOKEN = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;

/**
 * A static chunk between two holes counts as a composition joint only when it is
 * a run of two or more separators (`--`, `__`). One `-` is the ordinary word
 * joiner in every class name here, so accepting it would rescue any hyphenated
 * selector whose two halves happen to appear as strings somewhere.
 */
const SEPARATOR_INFIX = /^[-_]{2,}$/;

/** A hole that carries an index rather than a name: `chart-slice-${i % 8}`. */
const INDEX_VALUE = /^\d+$/;

/**
 * @typedef {Object} Evidence
 * @property {Set<string>} used - Class-shaped tokens the source writes; also the
 *   vocabulary of values a `${}` hole can evaluate to.
 * @property {Set<string>} prefixes - Static text directly before a hole.
 * @property {Set<string>} infixes - Separator-only static text between two holes.
 */

/**
 * A fresh, empty evidence accumulator.
 * @returns {Evidence}
 */
export const emptyEvidence = () => ({
  used: new Set(),
  prefixes: new Set(),
  infixes: new Set(),
});

/**
 * Can a `${}` hole have produced this text? Either the source writes it as a
 * literal somewhere, or it is an index.
 * @param {string} text - The candidate hole content
 * @param {Evidence} evidence - From {@link harvestSource}
 * @returns {boolean}
 */
const isValue = (text, evidence) =>
  text.length > 0 && (evidence.used.has(text) || INDEX_VALUE.test(text));

/**
 * A tracked file is a *source* file (its literals may reference classes) when it
 * is a `.js`/`.html` under `client/`, `shared/` or `server/`. Stylesheets are
 * excluded by extension.
 *
 * `server/` counts because eighteen of its modules write class attributes
 * (export, embed, published pages, the PNG/PDF renderers) and because the enum
 * members that fill client-side holes live there — `analyze-category-${cat}`
 * draws its categories from `server/utils/ai/analyze-presentation.js`. Leaving
 * it out made those composed names unaccountable.
 * @param {string} file - Repo-relative path
 * @returns {boolean}
 */
export const isSourceFile = (file) =>
  (file.startsWith('client/') ||
    file.startsWith('shared/') ||
    file.startsWith('server/')) &&
  (file.endsWith('.js') || file.endsWith('.html'));

/**
 * A tracked file is a *CSS* file we hold accountable when it is a `.css` under
 * `client/styles/`.
 * @param {string} file - Repo-relative path
 * @returns {boolean}
 */
export const isCssFile = (file) =>
  file.startsWith('client/styles/') && file.endsWith('.css');

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
 * Three kinds of evidence, all conservative:
 *   - `used`: every class-shaped token inside a string or template literal.
 *     Tokens are cut on any non-`[\w-]` run, not on whitespace: the two commonest
 *     ways this codebase names a class are `class="a b"` inside a larger string
 *     and `querySelector('.a .b')`, and whitespace-splitting yields
 *     `class="table-step-row"` / `.table-step-row` — neither of which is a class
 *     token, so both classes read as dead. Non-class strings leak in too, which
 *     only ever marks a selector alive — the safe direction. This set doubles as
 *     the *value vocabulary*: the things a `${}` hole can evaluate to.
 *   - `prefixes`: the last token of any static template chunk that sits directly
 *     before a `${` interpolation, e.g. `slide-bg-` in `` `slide-bg-${id}` ``.
 *     A prefix is only half an argument — see {@link isAlive}, which requires
 *     the remainder to be a value too.
 *   - `infixes`: a static chunk that sits *between* two holes and is nothing but
 *     separator characters, e.g. `--` in `` ` ${base}--${t}` ``. Such a build
 *     leaves no usable prefix (the chunk before the first hole is whitespace),
 *     so the separator itself is the evidence, and the name is composed when the
 *     text on both sides of it is a value. A single `-` is excluded: it joins
 *     almost every class name in the tree, so accepting it would whitelist any
 *     hyphenated name whose halves happen to appear as strings.
 *
 * @param {string} text - Source file contents
 * @param {Evidence} acc - Accumulator to fill
 * @returns {Evidence}
 */
export function harvestSource(text, acc = emptyEvidence()) {
  // Quoted strings: 'x', "x". Group 2 is the (unescaped-enough) content.
  const quoted = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  for (let m; (m = quoted.exec(text));) {
    addTokens(m[2], acc.used);
  }

  // Class attributes, read straight from the raw text rather than from inside a
  // recognised string. The scan above walks quotes left to right and desyncs on
  // quote characters inside regex literals — on a line like
  // `.replace(/"([^"]+)":/g, '<span class="json-key">…')` the regex's quotes
  // consume the attribute's, so `json-key` reads as unreferenced. This pass is
  // immune to that, and class attributes are how most markup here names classes.
  const classAttr = /class\s*=\s*(['"])([^'"]*)\1/g;
  for (let m; (m = classAttr.exec(text));) {
    addTokens(m[2], acc.used);
  }

  // Template literals: `...` possibly containing ${...} holes. We do not try to
  // balance nested backticks perfectly — a pragmatic match is enough for an
  // advisory harvest, and any miss only risks a false "alive", never a false
  // "dead".
  const template = /`((?:\\.|[^`\\])*)`/g;
  for (let m; (m = template.exec(text));) {
    const body = m[1];
    // Static chunks are the parts between ${...} holes.
    const chunks = body.split(/\$\{[^}]*\}/g);
    chunks.forEach((chunk, i) => {
      addTokens(chunk, acc.used);
      // Every chunk except the last is immediately followed by an interpolation,
      // so its trailing token is a composition prefix (`slide-bg-`, `is-`).
      if (i < chunks.length - 1) {
        // The trailing run of class characters, not the trailing whitespace-
        // delimited word: in `class="slide-bg-${id}"` the word is
        // `class="slide-bg-`, which matches no selector.
        const tail = /[_a-zA-Z][\w-]*$/.exec(chunk)?.[0];
        if (tail) acc.prefixes.add(tail);
      }
      // A chunk with a hole on both sides that is pure separator: the joint of
      // a `${base}--${tone}` build, which yields no prefix worth the name.
      if (i > 0 && i < chunks.length - 1 && SEPARATOR_INFIX.test(chunk)) {
        acc.infixes.add(chunk);
      }
    });
  }
  return acc;
}

/**
 * Cut a literal's content into class-shaped tokens and add them to a set.
 *
 * Splits on any run of characters a class name cannot contain, so a class
 * survives being embedded in markup (`class="a b"`) or in a selector
 * (`.a > .b`). That is more generous than splitting on whitespace, which is the
 * safe direction for this tool: it can only mark a selector alive.
 *
 * @param {string} chunk - Literal content
 * @param {Set<string>} into - Destination set
 */
function addTokens(chunk, into) {
  for (const token of chunk.split(/[^\w-]+/)) {
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

  for (let i = 0; i < text.length;) {
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
 * Decide whether a class name is accounted for by the harvested evidence.
 *
 * Four ways to be alive, in the order they are cheapest to check. The composed
 * ones (2 and 3) both demand that the interpolated part is a *value* the source
 * writes — a bare prefix match is not evidence, it is a wildcard, and that is
 * how `slide-` once absolved the whole slide layer.
 *
 * @param {string} name - CSS class name
 * @param {Evidence} evidence - From {@link harvestSource}
 * @returns {boolean}
 */
export function isAlive(name, evidence) {
  // 1. Written as a literal.
  if (evidence.used.has(name)) return true;

  // 2. Composed from a prefix and a value: `.slide-bg-red` from
  //    `` `slide-bg-${id}` `` with `red` written somewhere.
  for (const p of evidence.prefixes) {
    if (p && name.startsWith(p) && isValue(name.slice(p.length), evidence)) {
      return true;
    }
  }

  // 3. Composed across a separator joint: `.slide-badge--danger` from
  //    `` ` ${base}--${t}` `` with both `slide-badge` and `danger` written.
  for (const sep of evidence.infixes) {
    for (
      let at = name.indexOf(sep);
      at !== -1;
      at = name.indexOf(sep, at + 1)
    ) {
      if (
        isValue(name.slice(0, at), evidence) &&
        isValue(name.slice(at + sep.length), evidence)
      ) {
        return true;
      }
    }
  }

  // 4. The class is itself the static base of a composed literal: `.card` when
  //    the source only ever writes `card-header` as a literal token.
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
  const evidence = emptyEvidence();
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
  dead.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.name.localeCompare(b.name),
  );
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
        `in ${cssFiles.length} CSS files. ✅`,
    );
    return;
  }

  console.log(
    `lint:deadcss (advisory) — ${dead.length} of ${totalClasses} CSS classes look ` +
      `unreferenced by ${sourceFiles.length} source files.\n` +
      `Composed names (\`slide-bg-\${id}\`, \`\${base}--\${tone}\`) count as alive when\n` +
      `the interpolated part is a value the source writes; a listed selector could\n` +
      `not be assembled from any literal or composition. Verify before deleting —\n` +
      `this is a hint, not a verdict.\n`,
  );
  for (const rec of dead) {
    console.log(`  ${rec.file}:${rec.line}  .${rec.name}`);
  }
  console.log(
    `\n${dead.length} unreferenced selector(s). Report-only; exit 0.`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
