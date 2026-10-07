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
 * The first kind is pinned at zero. The second is pinned **edge by edge**: each
 * adapter file → storage module import that is still open is listed in
 * {@link OPEN_STORAGE_EDGES} with the item that closes it (B575 gave every edge
 * an address). A new edge is a new bypass: route the call through a service
 * instead. A closed edge is progress: drop its line here in the same PR, so the
 * ratchet never slips back. An edge only closes when its *last* import goes
 * (lesson 1 of the B521 follow-ups: count edges, not symbols).
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

/** Adapter imports into another contract's routes: none, and none to come. */
const ROUTES_BASELINE = 0;

/**
 * The adapter → deck-storage edges still open, each with the item that closes
 * it (brief `one-service-layer.md` § Vervolgknippen). A7.4 closes when this is
 * empty.
 */
const OPEN_STORAGE_EDGES = {
  // listPresentations (B606: one deck list on three contracts) and the PUT's
  // plain save (B607: one deck save, shared with the editor's PUT).
  'server/routes/public-api/v1/presentations.js -> server/storage/presentations/index.js':
    'B606, B607',
  // The AI wizard's update after the create (B608: a create that carries its
  // content, shared with the internal wizards and MCP's creates).
  'server/routes/public-api/v1/ai.js -> server/storage/presentations/index.js':
    'B608',
  // The translation write (B609: one translate, shared with the internal route
  // and the translate worker).
  'server/routes/public-api/v1/translate.js -> server/storage/presentations/index.js':
    'B609',
  // list_presentations (B606), the creates' update and normalizeSlides
  // pre-check (B608), and the slide-set writes of remove_slide,
  // reorder_slides, append_slides, compress_presentation and
  // iterate_presentation (B610).
  'server/mcp/tools.js -> server/storage/presentations/index.js':
    'B606, B608, B610',
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

test(`adapter imports into server/routes/api stay at ${ROUTES_BASELINE}`, () => {
  const hits = importsInto('server/routes/api');
  assert.equal(
    hits.length,
    ROUTES_BASELINE,
    'Adapter import(s) into server/routes/api; go through server/services/ ' +
      'instead (D256):\n  ' +
      hits.join('\n  '),
  );
});

test('adapter imports into server/storage/presentations are the open edges', () => {
  const edges = [...new Set(importsInto('server/storage/presentations'))];
  const open = Object.keys(OPEN_STORAGE_EDGES);
  const added = edges.filter((edge) => !open.includes(edge));
  const closed = open.filter((edge) => !edges.includes(edge));
  assert.deepEqual(
    added,
    [],
    'New adapter import(s) into server/storage/presentations; go through ' +
      'server/services/ instead (D256):\n  ' +
      added.join('\n  '),
  );
  assert.deepEqual(
    closed,
    [],
    'Closed edge(s): drop them from OPEN_STORAGE_EDGES in ' +
      'tests/service-layer-imports.test.js so the ratchet holds:\n  ' +
      closed.join('\n  '),
  );
});

test('the counter sees the import shapes the adapters use', () => {
  // Guard against a regex that silently matches nothing: the storage count is
  // nonzero today, and MCP's own storage import must be among the hits.
  const hits = importsInto('server/storage/presentations');
  assert.ok(
    hits.some((h) => h.startsWith('server/mcp/tools.js -> ')),
    hits.join('\n'),
  );
});
