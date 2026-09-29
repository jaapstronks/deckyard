/**
 * Parity gate: docs/openapi.yaml and the live public-API v1 router describe the
 * exact same set of operations (path × method), in both directions (B76).
 *
 * The spec and the router are two hand-maintained surfaces for one contract.
 * Nothing stopped them drifting — a new v1 route with no spec entry, or a
 * spec entry for a route that no longer exists. This test is that stop.
 *
 * How each side is read:
 *
 * - **Spec** — `docs/openapi.yaml` is parsed as YAML; every `paths.<p>.<method>`
 *   is one operation.
 * - **Router** — every v1 feature module exports a `ROUTES` table (B399), and
 *   `index.js` exports `SCHEMA_ROUTES`. Each row with a `method` is one
 *   operation; a method-less row is the path's 405 answer, not an operation.
 * - **Meta endpoints** `/`, `/docs` and `/openapi.yaml` are answered by the
 *   entry router in `index.js` before key auth, outside any table, so those
 *   three stable GET-only routes are pinned explicitly below.
 *
 * The two sides also agree on the operation's **name** (B515, D247): every
 * spec operation carries an `operationId`, every router row with a `method`
 * carries the same string as `id`, and a method-less row carries none. The
 * meta endpoints have no row, so their ids are pinned below with the
 * operations. That id is the `api_v1:<id>` key the dispatcher counts.
 *
 * Paths are compared structurally: every `{param}` (spec) and every capture
 * group (router regex) is normalized to `{}`, so `/presentations/{id}` and
 * `/presentations/([^/]+)` match. Method + normalized-path is the operation key.
 *
 * Run with: node --test tests/openapi-route-diff.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const V1_DIR = path.join(repoRoot, 'server/routes/public-api/v1');

const HTTP_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
]);

/** The v1 modules and the route tables they export. */
const ROUTE_TABLES = [
  ['presentations.js', 'ROUTES'],
  ['slides.js', 'ROUTES'],
  ['exports.js', 'ROUTES'],
  ['ai.js', 'ROUTES'],
  ['comments.js', 'ROUTES'],
  ['publishing.js', 'ROUTES'],
  ['translate.js', 'ROUTES'],
  ['slide-library.js', 'ROUTES'],
  ['resources.js', 'ROUTES'],
  ['index.js', 'SCHEMA_ROUTES'],
];

/**
 * Meta endpoints answered by the entry router in index.js, outside any table,
 * with their `operationId`s. Stable GET-only routes, pinned here by hand. A
 * change to this set is a deliberate edit.
 */
const META_OPERATIONS = new Map([
  ['GET /', 'getApiInfo'],
  ['GET /docs', 'getApiDocs'],
  ['GET /openapi.yaml', 'getOpenApiSpec'],
]);

/** One spelling for an operation name: lowerCamelCase, letters and digits. */
const OPERATION_ID = /^[a-z][a-zA-Z0-9]*$/;

/** Collapse any `{name}` or capture group to a bare `{}` for structural compare. */
function normalizePath(p) {
  return p.replace(/\{[^}]*\}/g, '{}');
}

/** Turn a router regex source into an OpenAPI-style path with `{}` placeholders. */
function regexToPath(source) {
  let s = source;
  s = s.replace(/\([^)]*\)/g, '{}'); // any capture group → placeholder (before unescaping)
  s = s.replace(/^\^/, '').replace(/\$$/, ''); // anchors
  s = s.replace(/\\(.)/g, '$1'); // unescape `\/`, `\.`
  return s;
}

/** Strip the `/api/v1` prefix; `/api/v1` and `/api/v1/` both mean `/`. */
function stripPrefix(p) {
  const out = p.replace(/^\/api\/v1/, '');
  return out === '' ? '/' : out;
}

// ---------------------------------------------------------------------------
// Spec side
// ---------------------------------------------------------------------------

/** @returns {Map<string, string|undefined>} operation key → its `operationId` */
function specOperations() {
  const spec = parseYaml(
    fs.readFileSync(path.join(repoRoot, 'docs/openapi.yaml'), 'utf8'),
  );
  const ops = new Map();
  for (const [p, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      ops.set(
        `${method.toUpperCase()} ${normalizePath(p)}`,
        operation.operationId,
      );
    }
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Router side
// ---------------------------------------------------------------------------

const tables = await Promise.all(
  ROUTE_TABLES.map(async ([file, exportName]) => {
    const mod = await import(pathToFileURL(path.join(V1_DIR, file)).href);
    assert.ok(Array.isArray(mod[exportName]), `${file} exports ${exportName}`);
    return mod[exportName];
  }),
);

/** @returns {Map<string, string|undefined>} operation key → the row's `id` */
function routerOperations() {
  const ops = new Map();
  for (const routes of tables) {
    for (const route of routes) {
      if (!route.method) continue;
      const p =
        typeof route.pattern === 'string'
          ? route.pattern
          : regexToPath(route.pattern.source);
      ops.set(`${route.method} ${normalizePath(stripPrefix(p))}`, route.id);
    }
  }
  // META_OPERATIONS are already written with normalized (`{}`) paths.
  for (const [op, id] of META_OPERATIONS) ops.set(op, id);
  return ops;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test('docs/openapi.yaml and the v1 router describe the same operations', () => {
  const spec = specOperations();
  const router = routerOperations();

  const missingFromSpec = [...router.keys()]
    .filter((op) => !spec.has(op))
    .sort();
  const missingFromRouter = [...spec.keys()]
    .filter((op) => !router.has(op))
    .sort();

  assert.deepEqual(
    { missingFromSpec, missingFromRouter },
    { missingFromSpec: [], missingFromRouter: [] },
    'OpenAPI spec and v1 router drifted.\n' +
      `  Router routes with no spec entry: ${missingFromSpec.join(', ') || '(none)'}\n` +
      `  Spec entries with no router route: ${missingFromRouter.join(', ') || '(none)'}`,
  );
});

test('the operation sets are non-trivial (extraction sanity)', () => {
  // Guards against a silently-empty parse making the diff vacuously pass.
  assert.ok(specOperations().size >= 30, 'expected ≥30 spec operations');
  assert.ok(routerOperations().size >= 30, 'expected ≥30 router operations');
});

test('every operation carries one operationId, the same on both sides', () => {
  const spec = specOperations();
  const router = routerOperations();

  const mismatched = [...spec]
    .filter(([op, id]) => router.get(op) !== id)
    .map(([op, id]) => `${op}: spec ${id} ≠ router ${router.get(op)}`);
  assert.deepEqual(
    mismatched,
    [],
    'operationId drifted between spec and router',
  );

  const ids = [...spec.values()];
  const malformed = ids.filter((id) => !OPERATION_ID.test(id ?? ''));
  assert.deepEqual(malformed, [], 'every operationId is lowerCamelCase');
  const duplicated = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(duplicated, [], 'every operationId is unique');
});

test('a method-less row is a 405 answer, not an operation, and carries no id', () => {
  const named = tables
    .flat()
    .filter((route) => !route.method && 'id' in route)
    .map((route) => String(route.pattern));
  assert.deepEqual(named, []);
});
