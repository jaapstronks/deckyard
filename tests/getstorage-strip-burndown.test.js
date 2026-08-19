/**
 * The storage-adapter strip (B79 / D34): getStorage() regression guard.
 *
 * D34 decided to **strip** the storage adapter class, and the strip is now
 * **complete**: every domain facade reaches PostgreSQL through direct Kysely on
 * `getDb()`, `getStorage()` and the whole `server/storage/adapters/**` tree are
 * deleted, and the burndown allowlist has reached empty. This gate stays on as a
 * cheap permanent guard: it forbids re-introducing the adapter idiom.
 *
 * It enumerates every module under `server/**` that calls `getStorage(` and
 * refuses any caller not carried in `getstorage-strip-burndown.json` — now the
 * empty list, which may only ever stay empty (the `eslint-suppressions.json` /
 * A7.20 burndown pattern). Any new `getStorage()` caller anywhere fails.
 *
 * `getStorageMode()` (server/config/database.js) is a different function and is
 * not matched — the pattern requires `getStorage` immediately followed by `(`.
 * `DEFINITION_FILE` names the removed module that *used* to define `getStorage()`
 * so the detector's "the definition is not a caller" contract stays documented
 * and self-tested; no such file exists in the tree anymore.
 *
 * Run with: node --test tests/getstorage-strip-burndown.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverRoot = join(repoRoot, 'server');

// The (now-removed) module that *defined* getStorage() — never a "caller".
// Retained so the detector's definition-vs-caller contract stays self-tested;
// no file at this path exists anymore, so the exclusion never fires on a real
// scan.
const DEFINITION_FILE = 'server/storage/adapters/index.js';

// Matches a getStorage() *call*: the identifier immediately followed by `(`.
// `getStorageMode(` does not match (an "M" sits between `getStorage` and `(`).
const CALL_RE = /\bgetStorage\s*\(/;

/**
 * Pure detector: given a map of `{ repoRelativePath: fileText }`, return the
 * sorted list of paths that call getStorage(), excluding the definition file.
 * Factored out so the negative self-test can exercise it without touching disk.
 * @param {Record<string, string>} fileTexts
 * @returns {string[]}
 */
export function detectCallers(fileTexts) {
  const callers = [];
  for (const [rel, text] of Object.entries(fileTexts)) {
    if (rel === DEFINITION_FILE) continue;
    if (CALL_RE.test(text)) callers.push(rel);
  }
  return callers.sort();
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.js')) yield p;
  }
}

function scanServer() {
  /** @type {Record<string, string>} */
  const fileTexts = {};
  for (const file of walk(serverRoot)) {
    fileTexts[relative(repoRoot, file)] = readFileSync(file, 'utf8');
  }
  return detectCallers(fileTexts);
}

const burndown = JSON.parse(
  readFileSync(
    join(repoRoot, 'tests', 'getstorage-strip-burndown.json'),
    'utf8',
  ),
);
const found = scanServer();

// ─── the gate ────────────────────────────────────────────────────────────────

test('no new getStorage() caller: every caller is on the burndown allowlist', () => {
  const allowed = new Set(burndown);
  const fresh = found.filter((f) => !allowed.has(f));
  assert.deepEqual(
    fresh,
    [],
    'new code must reach PostgreSQL through direct Kysely (getDb() / withDbGuard), ' +
      'not getStorage() → PostgresAdapter — the adapter class is being stripped (B79/D34). ' +
      'Do not add lines to tests/getstorage-strip-burndown.json; it only shrinks.',
  );
});

test('the burndown list only shrinks: every line still calls getStorage()', () => {
  const present = new Set(found);
  const stale = burndown.filter((f) => !present.has(f));
  assert.deepEqual(
    stale,
    [],
    'these facades no longer call getStorage() — delete their lines from ' +
      'tests/getstorage-strip-burndown.json so the list keeps burning down',
  );
});

test('the burndown list is sorted and free of duplicates', () => {
  const sorted = [...burndown].sort();
  assert.deepEqual(
    burndown,
    sorted,
    'keep the list sorted so diffs stay reviewable',
  );
  assert.equal(new Set(burndown).size, burndown.length, 'no duplicate lines');
});

// ─── negative self-tests: prove the detector actually catches a violation ─────

test('detector flags a getStorage() caller outside the allowlist', () => {
  const hits = detectCallers({
    'server/routes/evil.js':
      'import { getStorage } from "x";\nconst s = getStorage();',
  });
  assert.deepEqual(hits, ['server/routes/evil.js']);
});

test('detector ignores the definition file and getStorageMode()', () => {
  const hits = detectCallers({
    [DEFINITION_FILE]: 'export function getStorage() { return adapter; }',
    'server/config/database.js':
      'export function getStorageMode() {}\nreturn getStorageMode();',
  });
  assert.deepEqual(hits, []);
});

test('detector matches through whitespace but not a bare mention', () => {
  assert.deepEqual(detectCallers({ 'server/a.js': 'getStorage ()' }), [
    'server/a.js',
  ]);
  assert.deepEqual(
    detectCallers({ 'server/b.js': 'the getStorage helper' }),
    [],
  );
});
