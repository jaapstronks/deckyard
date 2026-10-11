/**
 * Guard: reading a file, drawing a QR code and clamping a number each have one
 * definition (B675).
 *
 * Before the gate five views hand-rolled `new FileReader()` around the
 * `readFileAsDataUrl()` that already lived in `client/lib/util/file.js`, the
 * image library exported a second function under the same name,
 * `notes-join.js` carried a private copy of the QR canvas renderer, and
 * `clamp` was declared five times across `client/` and `shared/`. Each copy
 * drifted a little (reject with the event, the error or an Error; a fixed or a
 * viewport-derived size). This test keeps the copies from growing back.
 *
 * Run with: node --test tests/one-helper-per-concept-guard.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

/** Third-party code we neither wrote nor patch. */
const SKIP_DIRS = new Set(['vendor', 'node_modules']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
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

const files = [
  ...walk(path.join(repoRoot, 'client')),
  ...walk(path.join(repoRoot, 'shared')),
].map((full) => ({
  rel: path.relative(repoRoot, full).split(path.sep).join('/'),
  lines: fs.readFileSync(full, 'utf8').split('\n'),
}));

/** Lines matching `re` outside `owners`, comment-only lines skipped. */
function offenders(re, owners) {
  const found = [];
  for (const { rel, lines } of files) {
    if (owners.includes(rel)) continue;
    lines.forEach((line, i) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      if (re.test(line)) found.push(`${rel}:${i + 1}  ${trimmed.trim()}`);
    });
  }
  return found;
}

const RULES = [
  {
    name: 'a FileReader is constructed only in client/lib/util/file.js',
    re: /\bnew FileReader\b/,
    owners: ['client/lib/util/file.js'],
    fix: 'import readFileAsDataUrl()/readFileAsText() from client/lib/util/file.js',
  },
  {
    name: 'readFileAsDataUrl is declared only in client/lib/util/file.js',
    re: /\b(?:function\s+readFileAsDataUrl\b|(?:const|let|var)\s+readFileAsDataUrl\s*=|export\s*\{[^}]*\breadFileAsDataUrl\b[^}]*\}\s*from)/,
    owners: ['client/lib/util/file.js'],
    fix: 'import it from client/lib/util/file.js, do not redeclare or re-export it',
  },
  {
    name: 'the QR library is imported only by client/lib/util/qr.js',
    re: /qrcode-generator/,
    owners: ['client/lib/util/qr.js'],
    fix: 'use renderQrToCanvas()/createQrDataUrl() from client/lib/util/qr.js',
  },
  {
    name: 'clamp is declared only in shared/number-utils.js',
    re: /\b(?:function\s+clamp\b|(?:const|let|var)\s+clamp\s*=)/,
    owners: [
      'shared/number-utils.js',
      // Served standalone to third-party pages: this file has no imports by
      // design (see its header), so it keeps its own copy.
      'client/embed-sdk.js',
    ],
    fix: 'import clamp from shared/number-utils.js',
  },
];

for (const { name, re, owners, fix } of RULES) {
  test(name, () => {
    const found = offenders(re, owners);
    assert.equal(found.length, 0, `${fix}:\n  ${found.join('\n  ')}`);
  });
}

test('every owner file still exists', () => {
  for (const { owners } of RULES) {
    for (const file of owners) {
      assert.ok(
        fs.existsSync(path.join(repoRoot, file)),
        `Stale owner entry: ${file} no longer exists — update this test.`,
      );
    }
  }
});
