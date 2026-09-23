/**
 * B360/B399 — the `captures` declaration says the truth about its own pattern.
 *
 * A route row declares what each of its capture groups holds
 * (`utils/router.js#Route.captures`), and the dispatcher answers 404 for a
 * segment declared `'uuid'` that cannot be one. That only works while the
 * declaration and the pattern agree: a list one entry short would shape-check
 * the wrong segment, and a missing list would silently gate nothing.
 *
 * The dispatcher itself throws on a length mismatch, so a mis-declared row
 * that any test exercises fails loudly. This guard covers the rest — every
 * exported route table in the tree (`ROUTES`, `PUBLIC_ROUTES`, `GATED_ROUTES`,
 * … — any exported array of rows), including rows no test walks:
 *
 *   1. A declared `captures` has exactly one entry per capture group.
 *   2. Every entry is `'uuid'` or `'text'` — the closed vocabulary. A third
 *      spelling is the tolerance creep this gate exists to stop.
 *   3. **Every capturing row under `api/` declares**, with the exceptions
 *      below named and reasoned (B399). Without this a new row lands ungated
 *      and nothing says so.
 *   4. **Elsewhere, a table that declares, declares fully**: once any row in a
 *      module carries `captures`, every capturing row in that module must.
 *
 * Rule 4 is the transitional form of rule 3 for `public-api/v1/` and
 * `static/`, which B399's second PR brings under rule 3; then rule 4 goes.
 *
 * Run with: node --test tests/route-captures-guard.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const ROUTES_ROOT = join(repoRoot, 'server', 'routes');

/**
 * Capturing rows that deliberately carry no `captures`, by module and handler
 * name. Each entry is an exception to rule 3 and needs a reason here.
 */
const UNDECLARED_ROWS = {
  'api/presentations/index.js': {
    // The bare `/api/presentations/:id` row must answer `false` for a
    // non-uuid, not 404: the segment is then not its id but a sibling
    // module's collection name (`shared-with-me`), and the chain decides.
    // A `captures` declaration answers 404, which is the one thing this row
    // may not do, so its shape check lives in the handler adapter instead.
    handlePresentationItemRoute:
      'falls through instead of answering 404; checked in the adapter',
  },
};

/** @returns {string[]} every `.js` file under `server/routes`, repo-relative. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * How many capture groups does this pattern have?
 *
 * The `source + '|'` trick makes the whole pattern optional, so `exec('')`
 * always matches and its length reports the group count without needing to
 * parse the source by hand.
 *
 * @param {string|RegExp} pattern
 * @returns {number}
 */
function groupCount(pattern) {
  if (typeof pattern === 'string') return 0;
  return new RegExp(`${pattern.source}|`).exec('').length - 1;
}

/**
 * Is this exported value a route table? Every row has a `pattern` and a
 * `handler` — the shape `dispatchRoutes` walks, whatever the export is named.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isRouteTable(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (row) => row && 'pattern' in row && typeof row.handler === 'function',
    )
  );
}

/** `[module, exportName, rows]` for every exported table under `server/routes`. */
const tables = [];
for (const file of walk(ROUTES_ROOT)) {
  if (!/export const [A-Z_]*ROUTES\b/.test(readFileSync(file, 'utf8')))
    continue;
  const mod = await import(file);
  for (const [exportName, value] of Object.entries(mod))
    if (isRouteTable(value))
      tables.push([relative(ROUTES_ROOT, file), exportName, value]);
}

/** Rule 3 holds here without a per-module escape; rule 4 elsewhere (B399). */
const isApiModule = (name) => name.startsWith('api/');

test('the guard sees the route tables at all', () => {
  // A broken glob would make every assertion below vacuous.
  assert.ok(tables.length >= 40, `found ${tables.length} exported tables`);
  const names = tables.map(([name, exportName]) => `${name}#${exportName}`);
  for (const expected of [
    'api/presentations/index.js#ROUTES',
    'api/collaborators.js#ROUTES',
    'api/follow/index.js#ROUTES',
    'api/export.js#ROUTES',
    // Tables not named ROUTES are tables all the same.
    'api/share-links/management.js#MANAGEMENT_ROUTES',
    'api/share-links/public.js#PUBLIC_ROUTES',
    'api/notion/index.js#GATED_ROUTES',
  ])
    assert.ok(names.includes(expected), `${expected} is among them`);
});

test('a captures declaration has one entry per capture group', () => {
  for (const [name, , routes] of tables) {
    for (const route of routes) {
      if (!route.captures) continue;
      assert.equal(
        route.captures.length,
        groupCount(route.pattern),
        `${name} → ${route.handler.name}: ${route.pattern}`,
      );
    }
  }
});

test('captures uses only the two declared kinds', () => {
  for (const [name, , routes] of tables) {
    for (const route of routes) {
      if (!route.captures) continue;
      for (const kind of route.captures)
        assert.ok(
          kind === 'uuid' || kind === 'text',
          `${name} → ${route.handler.name}: unknown capture kind ${JSON.stringify(kind)}`,
        );
    }
  }
});

test('every capturing row declares its captures (api/ always, elsewhere per module)', () => {
  for (const [name, , routes] of tables) {
    if (!isApiModule(name) && !routes.some((route) => route.captures)) continue;
    for (const route of routes) {
      if (route.captures || groupCount(route.pattern) === 0) continue;
      const reason = UNDECLARED_ROWS[name]?.[route.handler.name];
      assert.ok(
        reason,
        `${name} → ${route.handler.name} captures ${groupCount(route.pattern)} segment(s) but declares nothing`,
      );
    }
  }
});

test('every reasoned exception still exists', () => {
  // A stale allowlist entry is an invitation to add a new one next to it.
  for (const [name, rows] of Object.entries(UNDECLARED_ROWS)) {
    const table = tables.find(([file]) => file === name)?.[2];
    assert.ok(table, `${name} is still a route table`);
    for (const handlerName of Object.keys(rows)) {
      const route = table.find((r) => r.handler.name === handlerName);
      assert.ok(route, `${name} still has a row ${handlerName}`);
      assert.equal(
        route.captures,
        undefined,
        `${name} → ${handlerName} now declares captures; drop the exception`,
      );
    }
  }
});
