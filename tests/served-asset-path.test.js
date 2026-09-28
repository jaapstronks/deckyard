/**
 * One resolver for the served-asset class (B509).
 *
 * Three exports turn a deck's local refs back into files: the render embed
 * (server/utils/html-utils.js), the `.deck` bundle (server/export/
 * deck-install.js) and the bulk export (server/export/bulk-export.js). Each
 * carried its own prefix → root table, and they drifted: the bulk export read
 * `/custom/assets/` from the checkout while the other two honoured a moved
 * fork root, so a backup of such an installation silently left those files
 * out. There is now one table — `servedDirsFor` in server/config/paths.js,
 * the same one the static mounts are — and one resolver on top of it.
 *
 * Run with: node --test tests/served-asset-path.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHARED_PUBLIC_DIRS, servedDirsFor } from '../server/config/paths.js';
import {
  resolveServedAssetPath,
  resolveServedPath,
} from '../server/utils/served-asset-path.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

const CALLERS = [
  'server/export/bulk-export.js',
  'server/export/deck-install.js',
  'server/utils/html-utils.js',
];

test('no caller keeps a prefix table of its own', () => {
  for (const file of CALLERS) {
    const src = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    assert.match(src, /served-asset-path\.js'/, file);
    // A second table would name a served prefix, or the root helpers the
    // table maps them to.
    for (const re of [
      /'\/(?:uploads|assets|custom\/assets)\/'/,
      /\bUPLOADS_PREFIX\b/,
      /\bICON_URL_PREFIX\b/,
      /\bcustomDirFor\b/,
      /\buploadsDir\b/,
    ]) {
      assert.doesNotMatch(src, re, `${file}: ${re}`);
    }
  }
});

test('the static mounts are the resolver table for the process root', () => {
  assert.deepEqual(SHARED_PUBLIC_DIRS, servedDirsFor(repoRoot));
});

test('each asset prefix resolves under the directory it is served from', () => {
  const served = new Map(SHARED_PUBLIC_DIRS.map((d) => [d.urlPrefix, d.dir]));
  for (const prefix of ['/uploads/', '/assets/', '/custom/assets/']) {
    const out = resolveServedAssetPath(repoRoot, `${prefix}x.png`);
    assert.equal(out?.dir, path.resolve(served.get(prefix)), prefix);
    assert.equal(out?.path, path.join(out.dir, 'x.png'), prefix);
  }
});

test('the asset resolver refuses what is served but not an asset', () => {
  for (const ref of ['/client/app.js', '/css/x.png', '/shared/x.js']) {
    assert.equal(resolveServedAssetPath(repoRoot, ref), null, ref);
  }
});

test('refs are decoded as the static mount decodes them', () => {
  const out = resolveServedAssetPath(repoRoot, '/assets/a%20b.png');
  assert.equal(path.basename(out.path), 'a b.png');
  assert.equal(resolveServedAssetPath(repoRoot, '/assets/%E0.png'), null);
});

test('nothing escapes its served directory', () => {
  for (const ref of [
    '/uploads/../package.json',
    '/assets/../package.json',
    '/assets/%2e%2e/package.json',
    '/custom/assets/../../package.json',
  ]) {
    assert.equal(resolveServedAssetPath(repoRoot, ref), null, ref);
  }
  // Below the class predicate, containment holds on its own.
  assert.equal(resolveServedPath(repoRoot, '/assets/../package.json'), null);
  assert.equal(resolveServedPath(repoRoot, '/nowhere/x.png'), null);
});

test('a moved fork root resolves /custom/assets/ from the fork, not the checkout', (t) => {
  const fork = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-b509-fork-'));
  t.after(() => fs.rmSync(fork, { recursive: true, force: true }));
  // DECKYARD_CUSTOM_DIR is read once at import, so the probe runs in a child.
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const { resolveServedAssetPath } = await import('./server/utils/served-asset-path.js');
       console.log(JSON.stringify(resolveServedAssetPath('/some/installation', '/custom/assets/bg/one.jpg')));`,
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, DECKYARD_CUSTOM_DIR: fork },
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.deepEqual(out, {
    path: path.join(fork, 'assets', 'bg', 'one.jpg'),
    dir: path.join(fork, 'assets'),
  });
});
