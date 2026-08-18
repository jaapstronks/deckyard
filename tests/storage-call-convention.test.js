/**
 * The storage call convention (A7.20, B86): burndown gate.
 *
 * Two rules for `server/storage/**`, one allowlist.
 *
 * **The signature rule (A7.20).** Every exported function that touches storage
 * takes a `StorageScope` as its **first** parameter, named `scope`, and
 * validates it via `toStorageContext(scope, '<fn>')` before doing anything
 * else. The normative statement lives in `docs/reference/storage-scope.md`;
 * `tests/storage-scope-contract.test.js` pins the runtime behaviour of the
 * scope itself. This file pins the *signatures*: it enumerates every export
 * under `server/storage/**` and refuses
 *
 *   (a) `repoRoot` (or `_repoRoot`) as the first parameter, and
 *   (b) a parameter named `ctx`/`context` on any position other than 1.
 *
 * **The failure-shape rule (B86).** A mutation — an export whose name starts
 * with a state-changing verb — signals failure with `{ ok: false, reason }`,
 * never with `null` or `undefined`. Reads keep `null`/`[]`: absence is not a
 * failure. The normative statement lives in `docs/reference/storage-layer.md`
 * § *Failure signalling*. This file refuses
 *
 *   (c) a top-level `return null` / `return undefined` inside a mutation-named
 *       export.
 *
 * Rule (c) is deliberately shallow in three ways, and the doc says so. It reads
 * only the export's **own** body, so a `return null` in a nested closure that
 * the export converts to `{ ok, reason }` is not a violation — `createQuestion`
 * in `questions.js` is exactly that shape. It does not follow delegation, so an
 * export that tail-calls a private helper returning `null` reads as clean. And
 * it cannot judge `return false`, because a boolean is as often the payload as
 * the verdict. It is a drift stop, not a proof.
 *
 * Existing violations are carried in `storage-call-convention-burndown.json`,
 * an allowlist that may only shrink (the `eslint-suppressions.json` pattern):
 * fixing an export means deleting its line, and adding a new export in either
 * old shape fails this test. Six exports are permanently exempt from rule (a)
 * because they genuinely take a disk path, not a scope; they are listed here
 * with reasons.
 *
 * Run with: node --test tests/storage-call-convention.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'acorn';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const storageRoot = join(repoRoot, 'server', 'storage');

// ─── the six permanent exceptions: these take a path, not a scope ───────────

const PERMANENT_EXCEPTIONS = new Map([
  [
    'server/storage/uploads.js :: writeUploadedFile',
    'writes the uploaded bytes to disk; repoRoot is the destination path',
  ],
  [
    'server/storage/uploads.js :: replaceUploadFromDataUrl',
    'rewrites an upload on disk; repoRoot is the destination path',
  ],
  [
    'server/storage/boot-check.js :: strandedFileDataError',
    'migration guard that inspects dataDir() on disk before boot',
  ],
  [
    'server/storage/scope.js :: crossOrganizationScope',
    'scope *builder*: repoRoot is an input used to construct the scope',
  ],
  [
    'server/storage/scope.js :: singleOrganizationScope',
    'scope *builder*: repoRoot is an input used to construct the scope',
  ],
  [
    'server/storage/presentations/crud/factory.js :: prepareNewPresentation',
    'reads theme files from disk via loadThemeAssets(repoRoot, …)',
  ],
]);

// ─── signature scanner ───────────────────────────────────────────────────────

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.js')) yield p;
  }
}

/** Split a parameter list on top-level commas (defaults and destructuring stay intact). */
function splitParams(src) {
  const params = [];
  let depth = 0;
  let cur = '';
  for (const ch of src) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      params.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) params.push(cur.trim());
  return params;
}

/** Return the contents of the "(...)" opening at text[start], paren-balanced. */
function grabParens(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return text.slice(start + 1, i);
    }
  }
  return null;
}

// ─── failure-shape scanner (rule c) ──────────────────────────────

/**
 * Verb prefixes that make an export a **mutation**: it changes stored state, so
 * every non-throw failure branch must read `{ ok: false, reason }`.
 *
 * A whitelist on purpose. Prefixes deliberately left out, with why:
 * `get`/`find`/`list`/`count`/`search`/`aggregate`/`has`/`is`/`load`/`read` are
 * reads, where `null`/`[]` *is* the canonical miss; `hydrate` fills the
 * in-process session map on the way to answering "give me this session", so its
 * `null` is a read miss too; `attach`/`detach`/`broadcast` wire up process-local
 * SSE sockets rather than rows; `assert`/`enforce` throw on failure (the third
 * canonical shape); `normalize`/`build`/`prepare` are pure helpers that never
 * reach the database.
 */
const MUTATION_VERBS =
  /^(accept|activate|add|append|approve|archive|assign|bump|cancel|claim|clear|consume|create|deactivate|decline|delete|disable|downvote|duplicate|enable|ensure|expire|grant|increment|insert|invalidate|invite|link|lock|mark|migrate|move|persist|pin|prune|publish|purge|record|regenerate|reject|release|remove|rename|replace|reset|restore|revoke|rotate|save|seed|set|store|sync|toggle|touch|unlink|unlock|unpin|unpublish|update|upsert|upvote|vote|write)(?=[A-Z_]|$)/;

const FUNCTION_NODES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

/** Every `export function f()` / `export const f = () => …` in one module, as [name, fnNode]. */
function exportedFunctions(ast) {
  const out = [];
  for (const node of ast.body) {
    if (node.type !== 'ExportNamedDeclaration' || !node.declaration) continue;
    const decl = node.declaration;
    if (decl.type === 'FunctionDeclaration') {
      out.push([decl.id.name, decl]);
    } else if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        if (d.init && FUNCTION_NODES.has(d.init.type) && d.id.type === 'Identifier') {
          out.push([d.id.name, d.init]);
        }
      }
    }
  }
  return out;
}

/**
 * The return statements belonging to `fn` itself. Nested functions — the
 * callbacks handed to `withDbGuard`, `try`-wrapped closures — have their own
 * contract with their caller and are skipped.
 */
function ownReturnStatements(fn) {
  const found = [];
  (function visit(node, nested) {
    if (!node || typeof node.type !== 'string') return;
    const inNested = nested || (node !== fn && FUNCTION_NODES.has(node.type));
    if (!inNested && node.type === 'ReturnStatement') found.push(node);
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === 'string') visit(child, inNested);
        }
      } else if (value && typeof value.type === 'string') {
        visit(value, inNested);
      }
    }
  })(fn.body, false);
  return found;
}

/**
 * `null` or `undefined` — the two failure signals a mutation must not use, or
 * `null` when the return statement is fine.
 *
 * A bare `return;` is not a failure encoding: in a void function it is an early
 * exit. `return false` is not judged either — a boolean is as often the payload
 * as the verdict (`toggleImageFavorite` returns the *new* favourite state), so
 * it cannot be decided from syntax.
 */
function forbiddenFailureLiteral(argument) {
  if (!argument) return null;
  if (argument.type === 'Literal' && argument.value === null) return 'null';
  if (argument.type === 'Identifier' && argument.name === 'undefined') return 'undefined';
  return null;
}

/** Rule (c) violations in one module. */
function scanFailureShapes(rel, text) {
  const violations = [];
  const ast = parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
  for (const [name, fn] of exportedFunctions(ast)) {
    if (!MUTATION_VERBS.test(name)) continue;
    const kinds = new Set();
    for (const ret of ownReturnStatements(fn)) {
      const kind = forbiddenFailureLiteral(ret.argument);
      if (kind) kinds.add(kind);
    }
    for (const kind of [...kinds].sort()) {
      violations.push(`${rel} :: ${name} :: mutation-returns-${kind}`);
    }
  }
  return violations;
}

/**
 * Scan every export under server/storage/** and return the violation lines,
 * each shaped `<file> :: <export> :: <kind>`.
 */
function scanViolations() {
  const violations = [];
  for (const file of walk(storageRoot)) {
    const rel = relative(repoRoot, file);
    const text = readFileSync(file, 'utf8');
    const exportRe =
      /export\s+(?:async\s+)?function\s+(\w+)\s*\(|export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(/g;
    let m;
    while ((m = exportRe.exec(text))) {
      const name = m[1] || m[2];
      const paramsSrc = grabParens(text, m.index + m[0].length - 1);
      if (paramsSrc === null) continue;
      const names = splitParams(paramsSrc).map(
        (p) => (p.replace(/=.*/s, '').trim().match(/^\w+/) || [''])[0]
      );
      const key = `${rel} :: ${name}`;
      if (/^_?repoRoot$/.test(names[0] || '') && !PERMANENT_EXCEPTIONS.has(key)) {
        violations.push(`${key} :: repoRoot-first`);
      }
      names.forEach((n, i) => {
        if (i > 0 && /^(ctx|context)$/.test(n)) {
          violations.push(`${key} :: ctx-at-position-${i + 1}`);
        }
      });
    }
    violations.push(...scanFailureShapes(rel, text));
  }
  return violations.sort();
}

const burndown = JSON.parse(
  readFileSync(join(repoRoot, 'tests', 'storage-call-convention-burndown.json'), 'utf8')
);
const found = scanViolations();

// ─── the gate ────────────────────────────────────────────────────────────────

test('no storage export takes a new pre-convention shape', () => {
  const allowed = new Set(burndown);
  const fresh = found.filter((v) => !allowed.has(v));
  assert.deepEqual(
    fresh,
    [],
    'storage exports obey two rules: `fn(scope, …)` takes a StorageScope first, ' +
      'validated via toStorageContext(scope, …) (docs/reference/storage-scope.md), and ' +
      'a mutation signals failure with `{ ok: false, reason }`, never `null`/`undefined` ' +
      '(docs/reference/storage-layer.md § Failure signalling). ' +
      'Do not add lines to the burndown list; it only shrinks.'
  );
});

test('the burndown list only shrinks: every line still names a real violation', () => {
  const present = new Set(found);
  const stale = burndown.filter((v) => !present.has(v));
  assert.deepEqual(
    stale,
    [],
    'these exports were fixed or removed — delete their lines from ' +
      'tests/storage-call-convention-burndown.json so the list keeps burning down'
  );
});

test('the burndown list is sorted and free of duplicates', () => {
  const sorted = [...burndown].sort();
  assert.deepEqual(burndown, sorted, 'keep the list sorted so diffs stay reviewable');
  assert.equal(new Set(burndown).size, burndown.length, 'no duplicate lines');
});

test('the permanent exceptions still exist and still take a disk path first', () => {
  // Guards the exception list against rot: each entry must still be an export
  // whose first parameter is repoRoot. If one is renamed or migrated to a
  // scope, its exception line must go.
  const filesToCheck = new Map();
  for (const key of PERMANENT_EXCEPTIONS.keys()) {
    const [rel, name] = key.split(' :: ');
    if (!filesToCheck.has(rel)) filesToCheck.set(rel, []);
    filesToCheck.get(rel).push(name);
  }
  for (const [rel, names] of filesToCheck) {
    const text = readFileSync(join(repoRoot, rel), 'utf8');
    for (const name of names) {
      const re = new RegExp(
        `export\\s+(?:async\\s+)?function\\s+${name}\\s*\\(\\s*repoRoot\\b|` +
          `export\\s+const\\s+${name}\\s*=\\s*(?:async\\s*)?\\(\\s*repoRoot\\b`
      );
      assert.match(
        text,
        re,
        `${rel} :: ${name} is on the permanent exception list but no longer ` +
          'exports a repoRoot-first function — update PERMANENT_EXCEPTIONS'
      );
    }
  }
});

test('no burndown line doubles as a permanent exception', () => {
  const overlap = burndown.filter((v) =>
    PERMANENT_EXCEPTIONS.has(v.split(' :: ').slice(0, 2).join(' :: '))
  );
  assert.deepEqual(overlap, [], 'an export is either exempt or on the burndown list, never both');
});
