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
 * in `questions.js` is exactly that shape. It follows delegation exactly one
 * level and only in return position (`return helper(…)` to a module-private
 * helper); a `null` reached any other way — an imported helper, a helper whose
 * result is stored and returned later — reads as clean. And it cannot judge
 * `return false`, because a boolean is as often the payload as the verdict.
 * It is a drift stop, not a proof.
 *
 * **The reason-vocabulary rule (B93).** A `reason` is drawn from the layer-wide
 * vocabulary (`not_found`, `invalid`, `forbidden`, `conflict`, `unavailable`)
 * before a domain-specific one is minted; a domain reason is fine where it
 * carries information a route or UI acts on, a *second spelling* for a meaning
 * that already has one is not. This file refuses
 *
 *   (d) the retired spellings `no_session`, `bad_request` and `empty` anywhere
 *       under `server/storage/**`. They were the audience-facing interaction
 *       and feedback exports' private vocabulary until B93 folded them into
 *       `not_found` / `invalid`. A flat needle, not a vocabulary proof: it
 *       stops the three known losers coming back, it cannot judge a new one.
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
 * A whitelist on purpose, and it must name every state-changing verb the tree
 * actually uses — an export whose verb is missing here is simply not looked at,
 * so a new leak behind an unlisted verb reads as clean. When a new mutation verb
 * appears under server/storage, add it here (the scan of unlisted export names
 * in the review of B86 PR A is how the current list was completed).
 *
 * Prefixes deliberately left out, with why:
 * `get`/`find`/`list`/`count`/`search`/`aggregate`/`has`/`is`/`load`/`read` are
 * reads, where `null`/`[]` *is* the canonical miss; `hydrate` fills the
 * in-process session map on the way to answering "give me this session", so its
 * `null` is a read miss too; `attach`/`detach`/`broadcast` wire up process-local
 * SSE sockets rather than rows, as does `notify`; `assert`/`enforce` throw on
 * failure (the third canonical shape); `normalize`/`build`/`prepare`/`generate`
 * are pure helpers that never reach the database.
 */
const MUTATION_VERBS =
  /^(accept|acquire|activate|add|anonymize|append|approve|archive|assign|bump|cancel|claim|cleanup|clear|consume|create|deactivate|decline|delete|disable|dismiss|downvote|duplicate|enable|end|ensure|erase|expire|grant|increment|insert|invalidate|invite|link|lock|log|mark|migrate|move|permanentlyDelete|persist|pin|preRegister|promote|prune|publish|purge|record|refresh|regenerate|reject|release|remove|rename|reopen|reorder|replace|request|resend|reset|restore|revoke|rotate|save|seed|send|set|store|submit|sweep|sync|toggle|touch|transfer|transition|unlink|unlock|unpin|unpublish|update|upsert|upvote|vote|write)(?=[A-Z_]|$)/;

const FUNCTION_NODES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

/**
 * Every top-level `function f()` / `const f = () => …` in one module, exported
 * or not, as `{ exported: Map<name, fnNode>, local: Map<name, fnNode> }`. The
 * local ones matter because a mutation export may hand its answer straight to a
 * module-private helper (`return helper(…)`), and that helper's `return null`
 * is then the export's own failure shape.
 */
function moduleFunctions(ast) {
  const exported = new Map();
  const local = new Map();
  for (const node of ast.body) {
    const isExport = node.type === 'ExportNamedDeclaration';
    const decl = isExport ? node.declaration : node;
    if (!decl) continue;
    const into = isExport ? exported : local;
    if (decl.type === 'FunctionDeclaration') {
      into.set(decl.id.name, decl);
    } else if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        if (d.init && FUNCTION_NODES.has(d.init.type) && d.id.type === 'Identifier') {
          into.set(d.id.name, d.init);
        }
      }
    }
  }
  return { exported, local };
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

/**
 * The module-private helper a return statement hands its answer to — for
 * `return helper(…)` / `return await helper(…)` — or `null` when the statement
 * returns anything else. Only same-module private functions are followed:
 * an imported callee has a contract of its own, gated where it is exported.
 */
function delegatedCallee(ret, local) {
  let arg = ret.argument;
  if (arg?.type === 'AwaitExpression') arg = arg.argument;
  if (arg?.type !== 'CallExpression' || arg.callee.type !== 'Identifier') return null;
  const fn = local.get(arg.callee.name);
  return fn ? { name: arg.callee.name, fn } : null;
}

/**
 * Rule (c) violations in one module. Judges the export's own return statements
 * and, one level down, the returns of any module-private helper the export
 * tail-calls (`return helper(…)`); the helper's `null` is then reported against
 * the export as `mutation-returns-null-via-<helper>`.
 */
function scanFailureShapes(rel, text) {
  const violations = [];
  const ast = parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
  const { exported, local } = moduleFunctions(ast);
  for (const [name, fn] of exported) {
    if (!MUTATION_VERBS.test(name)) continue;
    const kinds = new Set();
    for (const ret of ownReturnStatements(fn)) {
      const kind = forbiddenFailureLiteral(ret.argument);
      if (kind) kinds.add(kind);
      const helper = delegatedCallee(ret, local);
      if (!helper) continue;
      for (const inner of ownReturnStatements(helper.fn)) {
        const innerKind = forbiddenFailureLiteral(inner.argument);
        if (innerKind) kinds.add(`${innerKind}-via-${helper.name}`);
      }
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

// Needles built from fragments so this guard file does not match its own text.
const RETIRED_REASONS = [
  { needle: 'no' + '_session', use: 'not_found' },
  { needle: 'bad' + '_request', use: 'invalid (bad_request is the HTTP envelope code, not a storage reason)' },
  { needle: "'emp" + "ty'", use: 'invalid' },
];

test('no storage reason uses a retired spelling', () => {
  const violations = [];
  for (const file of walk(storageRoot)) {
    const rel = relative(repoRoot, file).replace(/\\/g, '/');
    const text = readFileSync(file, 'utf8');
    for (const { needle, use } of RETIRED_REASONS) {
      if (text.includes(needle)) violations.push(`${rel}: ${needle} → use ${use}`);
    }
  }
  assert.deepEqual(
    violations.sort(),
    [],
    'a storage `reason` is drawn from the layer-wide vocabulary before a domain ' +
      'one is minted, and never as a second spelling of a meaning that already ' +
      'has one (docs/reference/storage-layer.md § Failure signalling)'
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
