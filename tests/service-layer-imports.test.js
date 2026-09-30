/**
 * Ratchet: the machine contracts reach the domain through `server/services/`,
 * not through another contract's routes or straight into the deck storage
 * (A7.4, D256).
 *
 * The three contracts — internal `/api`, public v1, MCP — are adapters: parse,
 * call a service, render the answer in their own envelope. Two kinds of import
 * betray an adapter that still carries domain logic of its own:
 *
 *   1. **into another contract's routes** — `server/mcp/**` or
 *      `server/routes/public-api/v1/**` importing from `server/routes/api/**`.
 *      MCP used to borrow the comment-count broadcast and the length limit from
 *      an internal route module; B518 moved both into `services/comments.js`.
 *      This one is at zero and stays there.
 *   2. **into the deck storage** — the same two trees importing from
 *      `server/storage/presentations/**`. Every such import is a deck operation
 *      the adapter composes itself, where a service should decide it. Each
 *      A7.4 item (B519–B521 and what follows) lowers this count; A7.4 closes
 *      at zero.
 *
 * The test counts import statements and pins both numbers **exactly**. More is
 * a new bypass: route the call through a service instead. Fewer is progress:
 * lower the baseline here in the same PR, so the ratchet never slips back.
 *
 * Run with: node --test tests/service-layer-imports.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The adapter trees the ratchet watches. */
const ADAPTER_DIRS = ['server/mcp', 'server/routes/public-api/v1'];

/** Current baselines. Lower them when an item removes an import; never raise. */
const BASELINE = {
  'server/routes/api': 0,
  'server/storage/presentations': 14,
};

function listJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(repoRoot, dir), {
    withFileTypes: true,
  })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJs(rel));
    else if (entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

/** Every relative import specifier of a file, resolved repo-relative. */
function importTargets(file) {
  const src = fs.readFileSync(path.join(repoRoot, file), 'utf8');
  const targets = [];
  const re = /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"](\.[^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    targets.push(path.posix.join(path.posix.dirname(file), m[1]));
  }
  return targets;
}

/**
 * The adapter imports that land in `targetDir`, as `file -> target` lines.
 * @param {string} targetDir
 * @returns {string[]}
 */
function importsInto(targetDir) {
  const hits = [];
  for (const dir of ADAPTER_DIRS) {
    for (const file of listJs(dir)) {
      for (const target of importTargets(file)) {
        if (target.startsWith(`${targetDir}/`))
          hits.push(`${file} -> ${target}`);
      }
    }
  }
  return hits;
}

for (const [targetDir, baseline] of Object.entries(BASELINE)) {
  test(`adapter imports into ${targetDir} stay at ${baseline}`, () => {
    const hits = importsInto(targetDir);
    assert.ok(
      hits.length <= baseline,
      `${hits.length - baseline} new adapter import(s) into ${targetDir}; ` +
        'go through server/services/ instead (D256):\n  ' +
        hits.join('\n  '),
    );
    assert.equal(
      hits.length,
      baseline,
      `Adapter imports into ${targetDir} dropped to ${hits.length}: lower ` +
        'BASELINE in tests/service-layer-imports.test.js so the ratchet holds.',
    );
  });
}

test('the counter sees the import shapes the adapters use', () => {
  // Guard against a regex that silently matches nothing: the storage count is
  // nonzero today, and MCP's own storage import must be among the hits.
  const hits = importsInto('server/storage/presentations');
  assert.ok(
    hits.some((h) => h.startsWith('server/mcp/tools.js -> ')),
    hits.join('\n'),
  );
});
