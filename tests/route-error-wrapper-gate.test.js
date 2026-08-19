/**
 * C7e gate — every route module mounted by the api dispatcher answers errors
 * through `withErrorHandler`.
 *
 * The wrap altitude is the mount-level dispatcher (A7.19-C7d, #726–#730): one
 * `export const handleX = withErrorHandler('<module>', …)` per module entry,
 * covering every sub-handler it dispatches to (including the SSE routes,
 * because the wrapper checks `headersSent`). This test derives the mount
 * surface from `server/routes/api/index.js` itself — every `handleX` it
 * imports must resolve, possibly through one level of `export … from`
 * re-export, to a `withErrorHandler(`-wrapped export. A new module mounted
 * without the wrapper fails here.
 *
 * Allowlist entries carry the reason they are exempt; an entry that stops
 * matching an actual import fails the staleness check, so the list can only
 * shrink.
 *
 * Run with: node --test tests/route-error-wrapper-gate.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const API_DIR = path.join(repoRoot, 'server/routes/api');
const INDEX = path.join(API_DIR, 'index.js');

/**
 * Mount-level handlers that are deliberately NOT withErrorHandler-wrapped.
 * Every entry needs a reason; entries that no longer appear as imports in
 * index.js fail the staleness check below.
 */
const ALLOWLIST = {
  // The public /api/v1 surface has its own openapi-documented error contract
  // and middleware (readApiV1Body, sendV1Error) — the internal envelope does
  // not apply there (brief § C7: "contractueel eigen terrein").
  handlePublicApiV1: 'own openapi v1 error contract',
};

/** Parse `import { a, b } from './x.js';` pairs out of index.js. */
function mountImports() {
  const src = readFileSync(INDEX, 'utf8');
  const out = [];
  const re = /import\s*\{([^}]+)\}\s*from\s*'(\.[^']+)';/g;
  for (const m of src.matchAll(re)) {
    const names = m[1]
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/)[0])
      .filter((n) => n.startsWith('handle'));
    if (names.length === 0) continue;
    out.push({ names, file: path.resolve(path.dirname(INDEX), m[2]) });
  }
  return out;
}

/**
 * Does `file` export `name` wrapped in withErrorHandler — directly, or via one
 * level of `export { name } from './deeper.js'`?
 */
function isWrapped(file, name, depth = 0) {
  const src = readFileSync(file, 'utf8');
  const wrapped = new RegExp(`export const ${name} = withErrorHandler\\(`);
  if (wrapped.test(src)) return true;

  // Follow a re-export (`export { handleX, … } from './sub.js';`).
  if (depth < 2) {
    const re = /export\s*\{([^}]+)\}\s*from\s*'(\.[^']+)';/g;
    for (const m of src.matchAll(re)) {
      const names = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]);
      if (names.includes(name)) {
        return isWrapped(
          path.resolve(path.dirname(file), m[2]),
          name,
          depth + 1,
        );
      }
    }
  }
  return false;
}

test('every handler mounted in api/index.js is withErrorHandler-wrapped or allowlisted', () => {
  const failures = [];
  const seen = new Set();
  for (const { names, file } of mountImports()) {
    for (const name of names) {
      seen.add(name);
      if (ALLOWLIST[name]) continue;
      if (!isWrapped(file, name)) {
        failures.push(`${name} (${path.relative(repoRoot, file)})`);
      }
    }
  }
  assert.ok(
    seen.size > 30,
    `sanity: expected the index mount surface, saw ${seen.size} handlers`,
  );
  assert.deepEqual(
    failures,
    [],
    `Mounted route handlers must be withErrorHandler-wrapped (or allowlisted with a reason):\n  ${failures.join('\n  ')}`,
  );
});

test('the allowlist is not stale', () => {
  const imported = new Set(mountImports().flatMap((m) => m.names));
  for (const name of Object.keys(ALLOWLIST)) {
    assert.ok(
      imported.has(name),
      `Allowlist entry '${name}' no longer matches an import in api/index.js — remove it`,
    );
  }
});
