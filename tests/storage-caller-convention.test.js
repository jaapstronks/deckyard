/**
 * The storage call convention, seen from the caller's side.
 *
 * `tests/storage-call-convention.test.js` pins the *signatures* under
 * `server/storage/**`: a function that touches storage takes a `StorageScope`
 * as its first parameter, named `scope`. Inside `server/` the routes and jobs
 * are exercised by the suite, so a caller that falls behind a signature change
 * fails a test. The entry points **outside** `server/` are not: `capture/` and
 * `scripts/` import the storage facade directly, run only by hand, and nothing
 * covers them. That is how `capture/lib/comments-seed.js` kept calling
 * `createComment(presentationId, data, ctx)` — the pre-scope order — for a
 * whole migration without anyone noticing, until a capture run failed (#1056).
 *
 * This test closes that gap statically. For every `.js` file under `capture/`
 * and `scripts/` it resolves each named import from `server/storage/**`, looks
 * up the export's declaration, and — when that declaration's first parameter is
 * literally `scope` — requires every call site to pass a scope in first
 * position: an identifier named `scope`, or a call to one of the scope
 * builders (`singleOrganizationScope`, `crossOrganizationScope`, `jobScope`,
 * or any `…Scope(…)` helper). Exports whose first parameter is anything else
 * are not judged here; the signature test owns that side.
 *
 * Run with: node --test tests/storage-caller-convention.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'acorn';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CALLER_ROOTS = ['capture', 'scripts'];
const STORAGE_PREFIX = join(repoRoot, 'server', 'storage') + '/';

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules') yield* walk(p);
    } else if (p.endsWith('.js')) yield p;
  }
}

function parseModule(file) {
  return parse(readFileSync(file, 'utf8'), {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
  });
}

/** Name of the first parameter of a function-ish node, or null. */
function firstParamName(fn) {
  const p = fn?.params?.[0];
  return p?.type === 'Identifier' ? p.name : null;
}

/**
 * Map export name → first parameter name for a storage module. Follows
 * `export function f(scope, …)`, `export const f = (scope, …) => …`, and
 * `export { f }` / `export { f as g }` of a local declaration. Re-exports from
 * other modules are followed one hop.
 */
const exportCache = new Map();
function exportFirstParams(file) {
  if (exportCache.has(file)) return exportCache.get(file);
  const out = new Map();
  exportCache.set(file, out);
  const ast = parseModule(file);
  const locals = new Map();
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration') {
      locals.set(node.id.name, firstParamName(node));
    } else if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) {
        if (
          d.id.type === 'Identifier' &&
          d.init &&
          /Function/.test(d.init.type)
        ) {
          locals.set(d.id.name, firstParamName(d.init));
        }
      }
    }
  }
  for (const node of ast.body) {
    if (node.type !== 'ExportNamedDeclaration') continue;
    const decl = node.declaration;
    if (decl?.type === 'FunctionDeclaration') {
      out.set(decl.id.name, firstParamName(decl));
    } else if (decl?.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        if (
          d.id.type === 'Identifier' &&
          d.init &&
          /Function/.test(d.init.type)
        ) {
          out.set(d.id.name, firstParamName(d.init));
        }
      }
    } else if (node.source) {
      const target = resolve(dirname(file), node.source.value);
      const upstream = existsSync(target)
        ? exportFirstParams(target)
        : new Map();
      for (const s of node.specifiers) {
        out.set(s.exported.name, upstream.get(s.local.name) ?? null);
      }
    } else {
      for (const s of node.specifiers) {
        out.set(s.exported.name, locals.get(s.local.name) ?? null);
      }
    }
  }
  return out;
}

/** Does this argument node read as "a scope"? */
function isScopeArgument(arg) {
  if (!arg) return false;
  if (arg.type === 'Identifier') return arg.name === 'scope';
  if (arg.type === 'CallExpression') {
    const c = arg.callee;
    const name = c.type === 'Identifier' ? c.name : c.property?.name;
    return typeof name === 'string' && /Scope$/.test(name);
  }
  if (arg.type === 'AwaitExpression') return isScopeArgument(arg.argument);
  return false;
}

/** Depth-first visit of every node in an ESTree AST. */
function* nodes(node) {
  if (!node || typeof node.type !== 'string') return;
  yield node;
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (Array.isArray(v)) for (const c of v) yield* nodes(c);
    else if (v && typeof v.type === 'string') yield* nodes(v);
  }
}

/** Every violation in one caller file: `{ line, callee, first }`. */
function violationsIn(file) {
  const ast = parseModule(file);
  // local binding name → first-param name of the storage export it refers to
  const scoped = new Map();
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue;
    const target = resolve(dirname(file), node.source.value);
    if (!target.startsWith(STORAGE_PREFIX) || !existsSync(target)) continue;
    const params = exportFirstParams(target);
    for (const s of node.specifiers) {
      if (s.type !== 'ImportSpecifier') continue;
      if (params.get(s.imported.name) === 'scope')
        scoped.set(s.local.name, true);
    }
  }
  if (!scoped.size) return [];

  const out = [];
  for (const node of nodes(ast)) {
    if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier')
      continue;
    if (!scoped.has(node.callee.name)) continue;
    if (isScopeArgument(node.arguments[0])) continue;
    out.push({
      line: node.loc?.start?.line ?? '?',
      callee: node.callee.name,
      first: node.arguments[0]?.type ?? '(none)',
    });
  }
  return out;
}

test('callers outside server/ pass a storage scope first', () => {
  const problems = [];
  let scannedCalls = 0;
  for (const root of CALLER_ROOTS) {
    for (const file of walk(join(repoRoot, root))) {
      const rel = relative(repoRoot, file);
      const ast = parseModule(file);
      for (const node of nodes(ast))
        if (node.type === 'CallExpression') scannedCalls++;
      for (const v of violationsIn(file)) {
        problems.push(
          `${rel}:${v.line} — ${v.callee}(…) takes a StorageScope first; ` +
            `got ${v.first}. Build one with singleOrganizationScope(repoRoot, '${rel}', …).`,
        );
      }
    }
  }
  assert.ok(scannedCalls > 0, 'expected to scan at least one call expression');
  assert.deepEqual(problems, [], `\n${problems.join('\n')}\n`);
});

test('the scanner itself recognises the seed helper as a scoped caller', () => {
  // A self-check that the test is not vacuous: comments-seed.js imports
  // createComment/resolveComment (scope-first) and must be judged.
  const seed = join(repoRoot, 'capture', 'lib', 'comments-seed.js');
  const params = exportFirstParams(
    join(repoRoot, 'server', 'storage', 'presentations', 'comments.js'),
  );
  assert.equal(params.get('createComment'), 'scope');
  assert.equal(params.get('resolveComment'), 'scope');
  assert.deepEqual(violationsIn(seed), []);
});
