/**
 * Server module layout: one folder = one seam (A7.36, D57).
 *
 * Two rules scope to `server/storage/`, one to `server/` as a whole.
 *
 * `AGENTS.md` § _Module layout: one folder = one seam_ has said this since
 * before the tree drifted away from it, and § _`server/storage/` applies this
 * literally_ spells out what a storage path is supposed to tell you:
 *
 *   - `server/storage/X.js` — an **undecomposed** store: one module, one file.
 *   - `server/storage/X/index.js` — a **decomposed** store: a seam over concern
 *     modules (`X/list.js`, `X/crud.js`, …) that consumers never import
 *     directly.
 *
 * Two shapes break that reading, and this file refuses both:
 *
 *   1. A folder whose only file is `index.js` — a folder built around a module
 *     that was never decomposed. It reads as a seam and is not one. Six of
 *     these existed (`collections`, `image-library`, `published`,
 *     `slide-library`, `slide-library-usage`, `tags`); they are single files now.
 *   2. A multi-file folder with no `index.js` — a decomposed store with no
 *     seam, so every consumer picks its own entry point and the folder has no
 *     public API. `analytics/` was the last one.
 *
 * **Scope is the store level**: the direct children of `server/storage/`. That
 * is where the `server/storage/` paragraph in `AGENTS.md` applies — one folder
 * per store — and it is deliberately not recursive: `presentations/crud/` is a
 * sub-decomposition reached only by its own store's seam
 * (`presentations/index.js`), and a seam inside a seam would be ceremony, not
 * structure.
 *
 * A third rule (A7.36 PR 3) has a wider scope: **anywhere under `server/`**, a
 * tracked `P/X.js` beside a folder `P/X/` is the eponymous wrapper that
 * `AGENTS.md` names in so many words — _"the folder's `index.js` already is the
 * seam, so the wrapper is redundant indirection"_. Twelve of those existed at
 * the 2026-08-24 scan; PR 2 removed seven and PR 3 moved the last five route
 * tables (`ai`, `follow`, `notion`, `presentations`, `static`) into their
 * folder's `index.js`.
 *
 * **There is no allowlist** on any of the three, on purpose. The previous scan
 * found four of these and they were still here at the next one; a burndown list
 * would have carried them a third time.
 *
 * Not covered by any of the three: a folder holding exactly one file that is
 * *not* `index.js` (`cache/permission-cache.js` today). Same disease as rule 1 —
 * a folder around an undecomposed module — but the brief states the rule as
 * "only an `index.js`", and widening it is a decision, not a lint fix.
 *
 * Run with: node --test tests/server-module-layout.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const storageRoot = path.join(repoRoot, 'server', 'storage');

/**
 * The direct child folders of `server/storage/`, each with its own file names.
 * @returns {Array<{name: string, files: string[]}>}
 */
function storeFolders() {
  return fs
    .readdirSync(storageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      files: fs
        .readdirSync(path.join(storageRoot, entry.name), {
          withFileTypes: true,
        })
        .filter((f) => f.isFile())
        .map((f) => f.name),
    }));
}

test('no folder under server/storage/ holds nothing but an index.js', () => {
  const offenders = storeFolders()
    .filter((d) => d.files.length === 1 && d.files[0] === 'index.js')
    .map((d) => `server/storage/${d.name}/`);

  assert.deepEqual(
    offenders,
    [],
    `A folder around a single undecomposed module is not a seam — move it to ` +
      `server/storage/<name>.js (AGENTS.md § Module layout):\n  ` +
      offenders.join('\n  '),
  );
});

test('every multi-file folder under server/storage/ has an index.js seam', () => {
  const offenders = storeFolders()
    .filter((d) => d.files.length > 1 && !d.files.includes('index.js'))
    .map((d) => `server/storage/${d.name}/ (${d.files.length} files)`);

  assert.deepEqual(
    offenders,
    [],
    `A decomposed store needs one public seam — add an index.js barrel and ` +
      `point consumers at it (AGENTS.md § Module layout):\n  ` +
      offenders.join('\n  '),
  );
});

/**
 * Every tracked path under `server/`, repo-relative with `/` separators.
 *
 * Prefers `git ls-files`, so a scratch file someone left in the tree can never
 * fail somebody else's run. Falls back to a walk when git is unavailable (a
 * tarball deploy); the guard below refuses a zero-file scan either way, so a
 * broken collector fails loudly instead of passing vacuously.
 *
 * @returns {string[]}
 */
function serverFiles() {
  try {
    const tracked = execFileSync('git', ['ls-files', '-z', 'server'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    const files = tracked.split('\0').filter(Boolean);
    if (files.length) return files;
  } catch {
    // No git: walk the tree directly.
  }
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(repoRoot, rel), {
      withFileTypes: true,
    })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) out.push(child);
    }
  };
  walk('server');
  return out;
}

/**
 * The eponymous-wrapper pairs: a file `P/X.js` sitting beside a folder `P/X/`.
 * @param {string[]} files repo-relative paths
 * @returns {string[]} the offending `P/X.js` paths, sorted
 */
function eponymousPairs(files) {
  const folders = new Set();
  for (const rel of files) {
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i += 1) {
      folders.add(parts.slice(0, i).join('/'));
    }
  }
  return files
    .filter((rel) => rel.endsWith('.js') && folders.has(rel.slice(0, -3)))
    .sort();
}

test('server file list is non-empty (guards against a vacuous scan)', () => {
  assert.ok(
    serverFiles().length > 100,
    'collected almost nothing under server/ — the collector is broken, not the tree',
  );
});

test('no file under server/ sits beside an eponymous folder', () => {
  const offenders = eponymousPairs(serverFiles());

  assert.deepEqual(
    offenders,
    [],
    `An eponymous wrapper beside its folder is redundant indirection — move ` +
      `its contents into the folder's index.js seam and repoint importers ` +
      `(AGENTS.md § Module layout):\n  ` +
      offenders.join('\n  '),
  );
});
