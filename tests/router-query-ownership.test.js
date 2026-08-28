/**
 * The router owns the querystring (B183).
 *
 * `client/lib/state/router.js` owned the pathname — `route()` matched on it,
 * `nav()` pushed it — while fifteen other modules each did their own
 * `new URL(location.href)` to reach a query param. Four spellings of the same
 * write coexisted (`history.state` vs `null` vs `{}` as the state argument,
 * whole-query strip vs targeted delete), which is how a share link could lose
 * an unrelated param on guest verification.
 *
 * Two halves here: the behaviour of the query API, and the guard that keeps a
 * sixteenth hand-rolled parser from appearing.
 *
 * Run with: node --test tests/router-query-ownership.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/deck-1?lang=nl&s=old#notes',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;

const { queryParam, queryString, currentUrl, urlWithQuery, setQueryParams } =
  await import('../client/lib/state/router.js');

// ---------------------------------------------------------------- behaviour

test('reads params off the live location', () => {
  assert.equal(queryParam('lang'), 'nl');
  assert.equal(queryParam('s'), 'old');
  assert.equal(queryParam('absent'), null, 'a missing param reads as null');
  assert.equal(queryString(), '?lang=nl&s=old');
});

test('currentUrl is path + query + hash — what nav() re-enters', () => {
  assert.equal(currentUrl(), '/app/deck-1?lang=nl&s=old#notes');
});

test('urlWithQuery builds a destination without navigating', () => {
  const before = location.href;
  assert.equal(
    urlWithQuery({ lang: 'en-GB', slideId: 'x1', s: null }),
    '/app/deck-1?lang=en-GB&slideId=x1#notes',
  );
  assert.equal(location.href, before, 'building a URL does not navigate');
});

test('setQueryParams replaces: no history entry, path and hash untouched', () => {
  const depth = history.length;
  setQueryParams({ slideId: 'slide-42', s: null });

  const u = new URL(location.href);
  assert.equal(u.searchParams.get('slideId'), 'slide-42');
  assert.equal(u.searchParams.get('lang'), 'nl', 'unrelated param preserved');
  assert.equal(u.searchParams.get('s'), null, 'null deletes the param');
  assert.equal(u.pathname, '/app/deck-1', 'pathname untouched');
  assert.equal(u.hash, '#notes', 'hash untouched');
  assert.equal(history.length, depth, 'replaceState: no new history entry');
});

test('setQueryParams keeps history.state', () => {
  history.replaceState({ marker: 7 }, '', location.href);
  setQueryParams({ lang: 'en-GB' });
  assert.deepEqual(history.state, { marker: 7 });
});

test('a patch that empties the query leaves a bare path', () => {
  history.replaceState(null, '', '/app/deck-1?only=1');
  setQueryParams({ only: null });
  assert.equal(location.pathname + location.search, '/app/deck-1');
});

test('non-string values are stringified, undefined deletes like null', () => {
  history.replaceState(null, '', '/app/deck-1?drop=1');
  assert.equal(urlWithQuery({ n: 42, drop: undefined }), '/app/deck-1?n=42');
});

// -------------------------------------------------------------------- guard

/**
 * The router is the only module allowed to reach for the current URL. A future
 * exception needs an argued entry here, not a quiet second parser.
 */
const ALLOWLIST = [
  {
    file: 'client/lib/state/router.js',
    reason: 'the query API itself — every other module goes through it',
  },
];

/** Third-party code we neither wrote nor patch. */
const SKIP_DIRS = new Set(['vendor']);

/** Hand-rolled reads of the live querystring, in every spelling seen so far. */
const PATTERNS = [
  /new URL\(\s*(?:window\.|globalThis\.)?location\.href\s*\)/,
  /(?:window|globalThis)?\.?location\s*\??\.\s*search/,
  /new URLSearchParams\(\s*(?:window\.|globalThis\.)?location/,
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

test('guard: only the router parses the current querystring', () => {
  const allowed = new Set(ALLOWLIST.map((a) => a.file));
  const violations = [];

  for (const file of walk(path.join(repoRoot, 'client'))) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    if (allowed.has(rel)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const trimmed = line.trimStart();
      // Comment-only lines may name the API while explaining the convention.
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      if (PATTERNS.some((re) => re.test(line))) {
        violations.push(`${rel}:${i + 1}  ${trimmed.trim()}`);
      }
    });
  }

  assert.deepEqual(
    violations,
    [],
    'read query params through queryParam()/queryString() from ' +
      'client/lib/state/router.js, and write them through setQueryParams()',
  );
});

test('guard: the patterns actually match the shapes they retired', () => {
  const retired = [
    'const url = new URL(location.href);',
    'const u = new URL(window.location.href);',
    'const qs = window.location.search;',
    'const p = new URLSearchParams(window.location.search);',
    "const qs = new URLSearchParams(globalThis.location?.search || '');",
    "const returnTo = `${location.pathname}${location.search || ''}`;",
  ];
  for (const line of retired) {
    assert.ok(
      PATTERNS.some((re) => re.test(line)),
      `pattern set should flag: ${line}`,
    );
  }
});

test('guard: unrelated location reads stay legal', () => {
  const legal = [
    'const u = new URL(path, location.origin);',
    'const hash = location.hash.slice(1);',
    'location.reload();',
    'const u = new URL(returnToRaw, location.origin);',
    '// Drawer contents re-render on open, so it inserts at the intended location.',
  ];
  for (const line of legal) {
    assert.ok(
      !PATTERNS.some((re) => re.test(line)),
      `pattern set should not flag: ${line}`,
    );
  }
});
