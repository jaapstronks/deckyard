/**
 * B360 — the `captures` declaration says the truth about its own pattern.
 *
 * A route row declares what each of its capture groups holds
 * (`utils/router.js#Route.captures`), and the dispatcher answers 404 for a
 * segment declared `'uuid'` that cannot be one. That only works while the
 * declaration and the pattern agree: a list one entry short would shape-check
 * the wrong segment, and a missing list would silently gate nothing.
 *
 * The dispatcher itself throws on a length mismatch, so a mis-declared row
 * that any test exercises fails loudly. This guard covers the rest — every
 * exported ROUTES table in the tree, including rows no test walks:
 *
 *   1. A declared `captures` has exactly one entry per capture group.
 *   2. Every entry is `'uuid'` or `'text'` — the closed vocabulary. A third
 *      spelling is the tolerance creep this gate exists to stop.
 *   3. **A table that declares, declares fully**: once any row in a module
 *      carries `captures`, every capturing row in that module must, with the
 *      exceptions below named and reasoned. Without this a new row lands
 *      ungated next to gated siblings and nothing says so.
 *
 * Rule 3 is deliberately per module rather than a hand-kept list of migrated
 * files: a module that adopts the declaration adopts it whole, and the tables
 * that have not adopted it yet (B360 migrated `/api/presentations/*`,
 * collaborators and follow) stay out of the guard's way until they do.
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

const tables = [];
for (const file of walk(ROUTES_ROOT)) {
  if (!readFileSync(file, 'utf8').includes('export const ROUTES')) continue;
  const mod = await import(file);
  if (Array.isArray(mod.ROUTES))
    tables.push([relative(ROUTES_ROOT, file), mod.ROUTES]);
}

test('the guard sees the route tables at all', () => {
  // A broken glob would make every assertion below vacuous.
  assert.ok(tables.length >= 40, `found ${tables.length} exported tables`);
  const names = tables.map(([name]) => name);
  for (const expected of [
    'api/presentations/index.js',
    'api/collaborators.js',
    'api/follow/index.js',
  ])
    assert.ok(names.includes(expected), `${expected} is among them`);
});

test('a captures declaration has one entry per capture group', () => {
  for (const [name, routes] of tables) {
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
  for (const [name, routes] of tables) {
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

test('a table that declares captures declares them on every capturing row', () => {
  for (const [name, routes] of tables) {
    if (!routes.some((route) => route.captures)) continue;
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
    const table = tables.find(([file]) => file === name)?.[1];
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
