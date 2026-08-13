import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadThemeAssets } from '../server/utils/themes.js';
import { getThemeRecord } from '../server/storage/themes.js';

/**
 * Regression guard for the *loader*, not the theme.
 *
 * Two functions in this codebase are called "get the theme" and they take
 * different arguments:
 *
 *   utils/themes.js    loadThemeAssets(repoRoot, rawThemeId, ctx?)
 *   storage/themes.js  getThemeRecord(scope, themeId)
 *
 * The queued export worker imported the second and called it with the first
 * one's arguments — `getThemeRecord(repoRoot, themeName)`. Before the scope-first
 * convention (A7.20) neither argument was rejected: a repo path was simply not
 * a theme UUID (→ `null`), so every queued export (pptx, pdf, pdf-slides, png,
 * handoff-zip, notes) rendered with `theme = null` while the synchronous path
 * rendered with a real theme. Silent in every test, wrong in production. Today
 * the same call throws: a string in the scope slot fails toStorageContext.
 *
 * These tests pin the swap itself, so putting it back turns something red.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('loadThemeAssets and storage getThemeRecord are not interchangeable', async () => {
  // The exact call the worker used to make: repoRoot in the scope slot. Since
  // the scope-first convention (A7.20) this fails loudly instead of answering
  // null — a string is not a StorageScope.
  await assert.rejects(
    () => getThemeRecord(repoRoot, 'midnight'),
    /getThemeRecord\(\) takes a storage scope, not a repoRoot string/,
    'storage getThemeRecord must refuse a repoRoot in the scope slot — the silent null is what hid the swap'
  );

  // The call it makes now, with the same two values, resolves a real theme.
  const theme = await loadThemeAssets(repoRoot, 'midnight');
  assert.equal(theme?.id, 'midnight');
  assert.ok(theme.cssVars && typeof theme.cssVars === 'object');
});

test('loadThemeAssets always resolves a theme, never null', async () => {
  // The failure mode was `theme = null` reaching every export builder, so pin
  // the invariant the worker now relies on: named, unknown and absent all
  // resolve to a usable theme object.
  for (const themeName of ['midnight', 'editorial', 'no-such-theme', '', undefined]) {
    const theme = await loadThemeAssets(repoRoot, themeName);
    assert.ok(theme?.id, `theme ${String(themeName)} must resolve to a theme object`);
  }
});

test('the export worker loads its theme through utils/themes.js', async () => {
  const src = await fs.readFile(
    path.join(repoRoot, 'server/jobs/queue/workers/export-worker.js'),
    'utf8'
  );

  assert.match(
    src,
    /import\s*\{[^}]*\bloadThemeAssets\b[^}]*\}\s*from\s*'[^']*utils\/themes\.js'/,
    'export-worker must import loadThemeAssets from utils/themes.js'
  );
  assert.doesNotMatch(
    src,
    /from\s*'[^']*storage\/themes\.js'/,
    'export-worker must not reach for the storage-layer theme accessor: its signature is (scope, themeId)'
  );
});

test('no server call site passes a repoRoot into storage getThemeRecord', async () => {
  const offenders = [];

  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'uploads') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith('.js')) {
        const src = await fs.readFile(full, 'utf8');
        if (/\bgetThemeRecord\s*\(\s*(?:job\.data\.)?_?repoRoot\b/.test(src)) {
          offenders.push(path.relative(repoRoot, full));
        }
      }
    }
  }

  await walk(path.join(repoRoot, 'server'));

  assert.deepEqual(
    offenders,
    [],
    'getThemeRecord takes (scope, themeId); passing a repoRoot as the scope throws'
  );
});
