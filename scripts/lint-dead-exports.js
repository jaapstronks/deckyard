#!/usr/bin/env node
// Advisory scanner for JS exports that no other module imports.
//
// WHY THIS EXISTS (and why it is not an ESLint rule)
// This is the dead-*exports* half of `lint:deadcode`. It used to be
// `import-x/no-unused-modules`, but ESLint 10 removed the `FileEnumerator` API
// that rule depends on, so on this repo's ESLint 10 the rule is a silent no-op:
// it reports zero unused exports and prints a one-line "rule is disabled"
// notice that is easy to miss (B47). A gate that silently reports nothing is
// drift, so the mechanism moved in-house — same idiom as `lint:deadcss`
// (`scripts/lint-dead-css.js`) and `audit-codebase.js`: a plain Node scan over
// `git ls-files`, immune to ESLint major bumps. The import-*cycle* half stayed
// in `eslint.deadcode.config.js` (`import-x/no-cycle` still works on ESLint 10
// and is precise); `npm run lint:deadcode` runs both.
//
// WHY IT IS ADVISORY, NOT A CI GATE
// The app loads a lot of code by directory scan and string-keyed registry
// (route dispatchers, DB migrations, slide-type registries, MCP tools). Those
// exports have no static importer and will show up here — false positives by
// construction. So every hit is a *candidate*, to be hand-verified against the
// reachability keep-list in `docs/plans/briefs/dead-code-audit.md` (§D/§E)
// before anything is deleted. Report-only, always exits 0.
//
// WHAT COUNTS AS "USED" (deliberately generous — the safe direction is "alive")
// An export named N in file F is USED when any tracked module (not just the
// four scanned trees — tests and `capture/` count too, so a test-only export is
// not flagged) does one of:
//   - `import { N } from F`            (named import; `N as x` still uses N)
//   - `import D from F`  where N=default
//   - `import * as ns from F`          (namespace — marks ALL of F's exports used)
//   - `export { N } from F` / `export * from F`   (re-export — a real consumer)
//   - `import('F')` or a JSDoc `{import('F')}` type ref  (dynamic / type usage)
// Unlike the old ESLint rule, this DOES resolve dynamic `import('…')` and JSDoc
// type imports as usage and DOES count importers outside the scanned trees, so
// it reports fewer false positives — which also means its candidate count is a
// fresh baseline, not comparable to the old `no-unused-modules` numbers.
//
// SCOPE IS TRACKED FILES, NOT THE WORKING TREE (the #413 lesson)
// Usage and exports are read from `git ls-files`, never a filesystem walk: an
// export used only by an untracked scratch file must still count as dead, or
// "green for the author" is not "green in CI".
//
// Run: npm run lint:deadexports   (or via `npm run lint:deadcode`)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Trees whose exports we hold accountable. An export living here that nothing
// imports is a candidate. (Importers may live anywhere — see USAGE_TREES.)
const SCAN_PREFIXES = ['client/', 'server/', 'shared/', 'scripts/'];

// A tracked JS module is in scope (as importer or as scanned file) unless it is
// vendored or fork-local — those are not ours to audit and their imports are
// noise. `custom/` is the fork overlay; `client/vendor/` is bundled deps.
const EXCLUDE = (file) =>
  file.startsWith('client/vendor/') || file.startsWith('custom/') || file.includes('/vendor/');

const JS_EXT = /\.(js|mjs|cjs)$/;

/**
 * List every tracked file, repo-relative. Uses `git ls-files` so the scan sees
 * exactly what CI sees — never the working tree (the #413 lesson).
 * @param {string} cwd - Repo root
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
 * Turn a byte offset into a 1-based line number.
 * @param {string} text - Full file text
 * @param {number} index - Character offset into `text`
 * @returns {number}
 */
function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

/**
 * Parse an import/export clause's brace body into the set of *source* names it
 * references. `a`, `a as b` and `default as x` all reference `a` / `default`
 * (the left-hand name is the one that must exist in the target module).
 * @param {string} body - Text between `{` and `}`
 * @returns {string[]}
 */
function braceNames(body) {
  const names = [];
  for (const raw of body.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    // `a as b` -> source name is `a`; type-only markers are stripped.
    const name = part.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name) || name === 'default') names.push(name);
  }
  return names;
}

/**
 * Extract every export a module declares, with the line it sits on.
 *
 * Covers declaration exports (`export function/class/const/let/var NAME`),
 * `export default`, local export blocks (`export { a, b as c }`), re-export
 * blocks (`export { a } from '…'`, whose exported name is the right-hand side)
 * and `export * as ns from '…'`. `export * from '…'` re-exports names this scan
 * cannot enumerate, so it contributes no named export here — only a usage edge
 * on the target (harvested by {@link harvestUsage}).
 *
 * Reads raw text: a commented-out `export` is a rare, harmless over-count that
 * only ever keeps a name in the "declared" set, and every hit is hand-verified.
 *
 * @param {string} text - Module source
 * @returns {Array<{name: string, line: number}>}
 */
export function extractExports(text) {
  const found = [];
  const add = (name, index) => found.push({ name, line: lineAt(text, index) });

  // `export default …` — the exported name is always `default`, whatever trails.
  for (const m of text.matchAll(/^[ \t]*export[ \t]+default\b/gm)) {
    add('default', m.index);
  }

  // Declaration exports: export [async] function|class|const|let|var NAME.
  // The `default` case is handled above, so exclude it here.
  const decl =
    /^[ \t]*export[ \t]+(?!default\b)(?:async[ \t]+)?(?:function\*?|class|const|let|var)[ \t]+([A-Za-z_$][\w$]*)/gm;
  for (const m of text.matchAll(decl)) add(m[1], m.index);

  // Re-export blocks: export { a, b as c } from '…' — exported name is the
  // right-hand side (`c`), i.e. what an importer of THIS module would ask for.
  const reexport = /export[ \t]*\{([^}]*)\}[ \t]*from[ \t]*['"][^'"]+['"]/g;
  for (const m of text.matchAll(reexport)) {
    for (const raw of m[1].split(',')) {
      const part = raw.trim();
      if (!part) continue;
      const exported = part.split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(exported)) add(exported, m.index);
    }
  }

  // export * as ns from '…' — a single named export `ns`.
  for (const m of text.matchAll(/export[ \t]*\*[ \t]*as[ \t]+([A-Za-z_$][\w$]*)[ \t]+from\b/g)) {
    add(m[1], m.index);
  }

  // Local export blocks: export { a, b as c }  (no `from`). Exported name is the
  // right-hand side. The optional trailing `from` group tells a local block from
  // a re-export (handled above) without a fragile look-ahead into the next line.
  const local = /export[ \t]*\{([^}]*)\}([ \t]*from\b)?/g;
  for (const m of text.matchAll(local)) {
    if (m[2]) continue; // has `from` -> re-export, already handled
    for (const raw of m[1].split(',')) {
      const part = raw.trim();
      if (!part) continue;
      const exported = part.split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(exported)) add(exported, m.index);
    }
  }

  return found;
}

/**
 * Extract every usage edge a module creates: for each specifier it imports
 * from, which names it pulls (`'*'` means "all exports", from a namespace
 * import, a bare `export *`, a dynamic `import()` or a JSDoc type import).
 *
 * @param {string} text - Module source
 * @returns {Array<{spec: string, names: Set<string>}>} - One entry per specifier
 */
export function harvestUsage(text) {
  /** @type {Map<string, Set<string>>} */
  const bySpec = new Map();
  const edge = (spec, name) => {
    if (!bySpec.has(spec)) bySpec.set(spec, new Set());
    if (name) bySpec.get(spec).add(name);
  };

  // Static `import <clause> from '<spec>'` (clause may span lines).
  const staticImport = /import\b([\s\S]*?)\bfrom[ \t]*['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(staticImport)) {
    const clause = m[1];
    const spec = m[2];
    edge(spec, null); // ensure the spec is recorded even for odd clauses
    if (/\*[ \t]*as[ \t]/.test(clause)) {
      edge(spec, '*'); // import * as ns -> all exports used
    }
    const brace = clause.match(/\{([\s\S]*)\}/);
    if (brace) for (const n of braceNames(brace[1])) edge(spec, n);
    // A leading identifier before `{` or `,` (and not `{`/`*`) is a default import.
    if (/^[ \t]*[A-Za-z_$][\w$]*[ \t]*(,|$)/.test(clause.replace(/\{[\s\S]*\}/, ''))) {
      edge(spec, 'default');
    }
  }

  // Re-export edges: export { a } from '<spec>'  and  export * [as x] from '<spec>'.
  for (const m of text.matchAll(/export[ \t]*\{([^}]*)\}[ \t]*from[ \t]*['"]([^'"]+)['"]/g)) {
    for (const n of braceNames(m[1])) edge(m[2], n);
  }
  for (const m of text.matchAll(/export[ \t]*\*(?:[ \t]*as[ \t]+[A-Za-z_$][\w$]*)?[ \t]*from[ \t]*['"]([^'"]+)['"]/g)) {
    edge(m[1], '*');
  }

  // Dynamic import('<spec>') AND JSDoc type refs {import('<spec>').Foo}: both
  // mark the whole target module used (we can't tell which names).
  for (const m of text.matchAll(/import[ \t]*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    edge(m[1], '*');
  }

  return [...bySpec].map(([spec, names]) => ({ spec, names }));
}

/**
 * Resolve an import specifier to a repo-relative tracked-file path, or null for
 * bare (npm) specifiers and anything that does not land on a tracked module.
 * Mirrors Node ESM resolution enough for this repo: relative and root-absolute
 * specifiers, `.js`/`.mjs`/`.cjs` and `dir/index.*` fallbacks.
 *
 * @param {string} spec - The import specifier
 * @param {string} importer - Repo-relative path of the importing file
 * @param {Set<string>} tracked - Set of repo-relative tracked file paths
 * @returns {string|null}
 */
export function resolveSpecifier(spec, importer, tracked) {
  let base;
  if (spec.startsWith('.')) base = path.join(path.dirname(importer), spec);
  else if (spec.startsWith('/')) base = spec.slice(1);
  else return null; // bare specifier -> npm dependency
  base = base.split(/[?#]/)[0]; // strip query/hash suffixes
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}/index.js`,
    `${base}/index.mjs`,
    `${base}/index.cjs`,
  ];
  for (const c of candidates) {
    const rel = c.split(path.sep).join('/');
    if (tracked.has(rel)) return rel;
  }
  return null;
}

/**
 * Run the scan: return every export in the scanned trees that no tracked module
 * imports, plus the totals needed for a summary line.
 *
 * The file list and reader are injectable so tests can drive the scan without
 * touching git or the filesystem (the `lint-dead-css` pattern). By default the
 * universe is every tracked `.js`/`.mjs`/`.cjs` outside vendor/fork trees, read
 * from disk.
 *
 * @param {{files?: string[], read?: (file: string) => string, cwd?: string}} [opts]
 * @returns {{candidates: Array<{file: string, name: string, line: number}>,
 *            filesScanned: number, exportsScanned: number}}
 */
export function scan(opts = {}) {
  const cwd = opts.cwd ?? REPO_ROOT;
  const read = opts.read ?? ((f) => fs.readFileSync(path.join(cwd, f), 'utf8'));
  const all = (opts.files ?? trackedFiles(cwd)).filter((f) => JS_EXT.test(f) && !EXCLUDE(f));
  const tracked = new Set(all);

  // Pass 1: harvest every usage edge from every tracked module, resolved to the
  // file it targets. `used[file]` is the set of names imported from it (or '*').
  /** @type {Map<string, Set<string>>} */
  const used = new Map();
  const markUsed = (file, name) => {
    if (!used.has(file)) used.set(file, new Set());
    used.get(file).add(name);
  };
  for (const importer of all) {
    for (const { spec, names } of harvestUsage(read(importer))) {
      const target = resolveSpecifier(spec, importer, tracked);
      if (!target) continue;
      if (names.size === 0) continue; // spec recorded but no concrete name/`*`
      for (const n of names) markUsed(target, n);
    }
  }

  // Pass 2: for each scanned file, report exports that nothing imports.
  const scanFiles = all.filter((f) => SCAN_PREFIXES.some((p) => f.startsWith(p)));
  const candidates = [];
  let exportsScanned = 0;
  for (const file of scanFiles) {
    const exports = extractExports(read(file));
    exportsScanned += exports.length;
    const consumers = used.get(file) ?? new Set();
    if (consumers.has('*')) continue; // namespace/dynamic import -> all alive
    for (const { name, line } of exports) {
      if (!consumers.has(name)) candidates.push({ file, name, line });
    }
  }

  candidates.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { candidates, filesScanned: scanFiles.length, exportsScanned };
}

// --- CLI ------------------------------------------------------------------

/** @returns {boolean} true when run directly (not imported). */
const isMain = () => {
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};

if (isMain()) {
  const { candidates, filesScanned, exportsScanned } = scan();
  for (const { file, name, line } of candidates) {
    const label = name === 'default' ? 'default export' : `export '${name}'`;
    console.log(`${file}:${line}  ${label} not imported by any module`);
  }
  console.log(
    `\n${candidates.length} unused-export candidate(s) across ${exportsScanned} exports in ${filesScanned} files.`,
  );
  console.log(
    'Advisory — every hit is a candidate; hand-verify against dead-code-audit.md §D/§E before deleting.',
  );
  process.exit(0);
}
