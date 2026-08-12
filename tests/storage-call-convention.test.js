/**
 * The storage call convention (A7.20): burndown gate.
 *
 * One convention for `server/storage/**`: every exported function that touches
 * storage takes a `StorageScope` as its **first** parameter, named `scope`,
 * and validates it via `toStorageContext(scope, '<fn>')` before doing anything
 * else. The normative statement lives in `docs/reference/storage-scope.md`;
 * `tests/storage-scope-contract.test.js` pins the runtime behaviour of the
 * scope itself. This file pins the *signatures*: it enumerates every export
 * under `server/storage/**` and refuses
 *
 *   (a) `repoRoot` (or `_repoRoot`) as the first parameter, and
 *   (b) a parameter named `ctx`/`context` on any position other than 1.
 *
 * Existing violations are carried in `storage-call-convention-burndown.json`,
 * an allowlist that may only shrink (the `eslint-suppressions.json` pattern):
 * fixing an export means deleting its line, and adding a new export in either
 * old shape fails this test. Six exports are permanently exempt because they
 * genuinely take a disk path, not a scope; they are listed here with reasons.
 *
 * Run with: node --test tests/storage-call-convention.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const storageRoot = join(repoRoot, 'server', 'storage');

// ─── the six permanent exceptions: these take a path, not a scope ───────────

const PERMANENT_EXCEPTIONS = new Map([
  [
    'server/storage/uploads.js :: writeUploadedFile',
    'writes the uploaded bytes to disk; repoRoot is the destination path',
  ],
  [
    'server/storage/uploads.js :: replaceUploadFromDataUrl',
    'rewrites an upload on disk; repoRoot is the destination path',
  ],
  [
    'server/storage/boot-check.js :: strandedFileDataError',
    'migration guard that inspects dataDir() on disk before boot',
  ],
  [
    'server/storage/scope.js :: crossOrganizationScope',
    'scope *builder*: repoRoot is an input used to construct the scope',
  ],
  [
    'server/storage/scope.js :: singleOrganizationScope',
    'scope *builder*: repoRoot is an input used to construct the scope',
  ],
  [
    'server/storage/presentations/crud/factory.js :: prepareNewPresentation',
    'reads theme files from disk via loadTheme(repoRoot, …)',
  ],
]);

// ─── signature scanner ───────────────────────────────────────────────────────

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.js')) yield p;
  }
}

/** Split a parameter list on top-level commas (defaults and destructuring stay intact). */
function splitParams(src) {
  const params = [];
  let depth = 0;
  let cur = '';
  for (const ch of src) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      params.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) params.push(cur.trim());
  return params;
}

/** Return the contents of the "(...)" opening at text[start], paren-balanced. */
function grabParens(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return text.slice(start + 1, i);
    }
  }
  return null;
}

/**
 * Scan every export under server/storage/** and return the violation lines,
 * each shaped `<file> :: <export> :: <kind>`.
 */
function scanViolations() {
  const violations = [];
  for (const file of walk(storageRoot)) {
    const rel = relative(repoRoot, file);
    const text = readFileSync(file, 'utf8');
    const exportRe =
      /export\s+(?:async\s+)?function\s+(\w+)\s*\(|export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(/g;
    let m;
    while ((m = exportRe.exec(text))) {
      const name = m[1] || m[2];
      const paramsSrc = grabParens(text, m.index + m[0].length - 1);
      if (paramsSrc === null) continue;
      const names = splitParams(paramsSrc).map(
        (p) => (p.replace(/=.*/s, '').trim().match(/^\w+/) || [''])[0]
      );
      const key = `${rel} :: ${name}`;
      if (/^_?repoRoot$/.test(names[0] || '') && !PERMANENT_EXCEPTIONS.has(key)) {
        violations.push(`${key} :: repoRoot-first`);
      }
      names.forEach((n, i) => {
        if (i > 0 && /^(ctx|context)$/.test(n)) {
          violations.push(`${key} :: ctx-at-position-${i + 1}`);
        }
      });
    }
  }
  return violations.sort();
}

const burndown = JSON.parse(
  readFileSync(join(repoRoot, 'tests', 'storage-call-convention-burndown.json'), 'utf8')
);
const found = scanViolations();

// ─── the gate ────────────────────────────────────────────────────────────────

test('no storage export takes a new pre-convention shape', () => {
  const allowed = new Set(burndown);
  const fresh = found.filter((v) => !allowed.has(v));
  assert.deepEqual(
    fresh,
    [],
    'new storage exports must take `fn(scope, …)` — a StorageScope first, ' +
      'validated via toStorageContext(scope, …). See docs/reference/storage-scope.md. ' +
      'Do not add lines to the burndown list; it only shrinks.'
  );
});

test('the burndown list only shrinks: every line still names a real violation', () => {
  const present = new Set(found);
  const stale = burndown.filter((v) => !present.has(v));
  assert.deepEqual(
    stale,
    [],
    'these exports were fixed or removed — delete their lines from ' +
      'tests/storage-call-convention-burndown.json so the list keeps burning down'
  );
});

test('the burndown list is sorted and free of duplicates', () => {
  const sorted = [...burndown].sort();
  assert.deepEqual(burndown, sorted, 'keep the list sorted so diffs stay reviewable');
  assert.equal(new Set(burndown).size, burndown.length, 'no duplicate lines');
});

test('the permanent exceptions still exist and still take a disk path first', () => {
  // Guards the exception list against rot: each entry must still be an export
  // whose first parameter is repoRoot. If one is renamed or migrated to a
  // scope, its exception line must go.
  const filesToCheck = new Map();
  for (const key of PERMANENT_EXCEPTIONS.keys()) {
    const [rel, name] = key.split(' :: ');
    if (!filesToCheck.has(rel)) filesToCheck.set(rel, []);
    filesToCheck.get(rel).push(name);
  }
  for (const [rel, names] of filesToCheck) {
    const text = readFileSync(join(repoRoot, rel), 'utf8');
    for (const name of names) {
      const re = new RegExp(
        `export\\s+(?:async\\s+)?function\\s+${name}\\s*\\(\\s*repoRoot\\b|` +
          `export\\s+const\\s+${name}\\s*=\\s*(?:async\\s*)?\\(\\s*repoRoot\\b`
      );
      assert.match(
        text,
        re,
        `${rel} :: ${name} is on the permanent exception list but no longer ` +
          'exports a repoRoot-first function — update PERMANENT_EXCEPTIONS'
      );
    }
  }
});

test('no burndown line doubles as a permanent exception', () => {
  const overlap = burndown.filter((v) =>
    PERMANENT_EXCEPTIONS.has(v.split(' :: ').slice(0, 2).join(' :: '))
  );
  assert.deepEqual(overlap, [], 'an export is either exempt or on the burndown list, never both');
});
