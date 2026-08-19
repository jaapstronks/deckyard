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
 * - **Router** — the nine feature handlers in `server/routes/public-api/v1/`
 *   dispatch imperatively, but uniformly: a path anchor (`url.pathname === '…'`
 *   or `url.pathname.match(/…/)`) is immediately followed by a
 *   `v1MethodNotAllowed(res, ['GET', …])` call that enumerates exactly that
 *   path's methods. We pair each anchor with the method list that follows it.
 * - **Meta endpoints** live in `index.js` with a different shape (a shared
 *   `req.method !== 'GET'` guard, then path branching), so the five stable,
 *   GET-only meta/schema routes are pinned explicitly below rather than parsed.
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
import { fileURLToPath } from 'node:url';
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

/** Feature handlers parsed for anchor→method-list pairs. */
const FEATURE_HANDLERS = [
  'presentations.js',
  'slides.js',
  'exports.js',
  'ai.js',
  'comments.js',
  'publishing.js',
  'translate.js',
  'slide-library.js',
  'resources.js',
];

/**
 * Meta/schema endpoints served from index.js. They use a shared method guard
 * (not the anchor→method-list shape), and they are stable GET-only routes, so
 * they are pinned here by hand. A change to this set is a deliberate edit.
 */
const META_OPERATIONS = [
  'GET /',
  'GET /docs',
  'GET /openapi.yaml',
  'GET /schema/deck.json',
  'GET /schema/slide-types/{}.json',
];

/** Collapse any `{name}` or capture group to a bare `{}` for structural compare. */
function normalizePath(p) {
  return p.replace(/\{[^}]*\}/g, '{}');
}

/** Turn a router regex source into an OpenAPI-style path with `{}` placeholders. */
function regexToPath(source) {
  let s = source;
  s = s.replace(/\([^)]*\)/g, '{}'); // any capture group → placeholder (before unescaping)
  s = s.replace(/^\^/, '').replace(/\$$/, ''); // anchors
  s = s.replace(/\\\//g, '/'); // unescape slashes
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

function specOperations() {
  const spec = parseYaml(
    fs.readFileSync(path.join(repoRoot, 'docs/openapi.yaml'), 'utf8'),
  );
  const ops = new Set();
  for (const [p, methods] of Object.entries(spec.paths || {})) {
    for (const method of Object.keys(methods)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      ops.add(`${method.toUpperCase()} ${normalizePath(p)}`);
    }
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Router side
// ---------------------------------------------------------------------------

// Anchors are matched over the whole file (not line-by-line): the regex form
// often splits `url.pathname.match(` from its `/…/` literal across two lines.
const ANCHOR_EXACT = /url\.pathname\s*===\s*'([^']+)'/g;
// The regex literal runs from `match(/` to its terminating `/)`. Internal
// escaped slashes (`\/`) are followed by more pattern, never `)`, so the
// non-greedy body with the `s` flag stops only at the real end of the literal.
// Prettier may break the call over three lines and leave a trailing comma
// after the literal (`match(\n  /…/,\n)`), hence the optional `,`.
const ANCHOR_REGEX = /url\.pathname\.match\(\s*\/(.+?)\/\s*,?\s*\)/gs;
const METHOD_LIST = /v1MethodNotAllowed\(\s*res\s*,\s*\[([^\]]*)\]/g;

function routerOperations() {
  const ops = new Set();
  for (const file of FEATURE_HANDLERS) {
    const src = fs.readFileSync(path.join(V1_DIR, file), 'utf8');

    // Collect every anchor and method-list as positioned events, then walk them
    // in source order pairing each method-list with the anchor that precedes it.
    const events = [];
    for (const m of src.matchAll(ANCHOR_EXACT)) {
      events.push({ i: m.index, kind: 'path', path: stripPrefix(m[1]) });
    }
    for (const m of src.matchAll(ANCHOR_REGEX)) {
      events.push({
        i: m.index,
        kind: 'path',
        path: stripPrefix(regexToPath(m[1])),
      });
    }
    for (const m of src.matchAll(METHOD_LIST)) {
      events.push({ i: m.index, kind: 'methods', methods: m[1] });
    }
    events.sort((a, b) => a.i - b.i);

    let currentPath = null;
    for (const e of events) {
      if (e.kind === 'path') {
        currentPath = e.path;
      } else if (currentPath) {
        for (const raw of e.methods.split(',')) {
          const method = raw.trim().replace(/['"]/g, '');
          if (method)
            ops.add(`${method.toUpperCase()} ${normalizePath(currentPath)}`);
        }
      }
    }
  }
  // META_OPERATIONS are already written with normalized (`{}`) paths.
  for (const op of META_OPERATIONS) ops.add(op);
  return ops;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test('docs/openapi.yaml and the v1 router describe the same operations', () => {
  const spec = specOperations();
  const router = routerOperations();

  const missingFromSpec = [...router].filter((op) => !spec.has(op)).sort();
  const missingFromRouter = [...spec].filter((op) => !router.has(op)).sort();

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
