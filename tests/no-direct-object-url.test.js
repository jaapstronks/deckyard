/**
 * Guard: no direct `URL.createObjectURL` in client code outside
 * `client/lib/dom/download.js`.
 *
 * Downloading a blob is one concept with one canonical form:
 * `downloadBlob(blob, filename)` from `client/lib/dom/download.js`. Before the
 * helper existed, three views hand-rolled the same objectURL + `<a download>`
 * + click + revoke dance with small drifts (attached vs. detached anchor,
 * immediate vs. 10s-delayed revoke). This test keeps that drift from growing
 * back (A7.16 cluster 6).
 *
 * A future *non-download* use of an object URL (e.g. an image preview) is a
 * new decision, not a chore: add it to ALLOWLIST with a reason.
 *
 * Run with: node --test tests/no-direct-object-url.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

/** The helper itself, plus any argued non-download exception. */
const ALLOWLIST = [
  {
    file: 'client/lib/dom/download.js',
    reason: 'the downloadBlob() implementation itself',
  },
];

/** Third-party code we neither wrote nor patch. */
const SKIP_DIRS = new Set(['vendor']);

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

test('URL.createObjectURL in client/ only via downloadBlob()', () => {
  const allowed = new Set(ALLOWLIST.map((a) => a.file));
  const violations = [];

  for (const file of walk(path.join(repoRoot, 'client'))) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    if (allowed.has(rel)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const trimmed = line.trimStart();
      // Comment-only lines may mention the API in documentation.
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      if (line.includes('URL.createObjectURL')) {
        violations.push(`${rel}:${i + 1}  ${trimmed.trim()}`);
      }
    });
  }

  assert.equal(
    violations.length,
    0,
    'Use downloadBlob() from client/lib/dom/download.js instead of a direct ' +
      'URL.createObjectURL, or add an allowlist entry with a reason to this ' +
      `test:\n  ${violations.join('\n  ')}`,
  );
});

test('the allowlist only names files that still exist', () => {
  for (const { file } of ALLOWLIST) {
    assert.ok(
      fs.existsSync(path.join(repoRoot, file)),
      `Stale allowlist entry: ${file} no longer exists — remove it.`,
    );
  }
});
