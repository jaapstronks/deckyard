import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadThemeAssets } from '../server/utils/themes.js';
import { getThemeRecord, listSeedThemes } from '../server/storage/themes.js';
import { createFakeDb } from './helpers/fake-db.js';
import { seedRow } from './helpers/theme-seed.js';
import { __setTestDb } from '../server/db/client.js';
import {
  initializeStorage,
  __resetStorageForTests,
} from '../server/storage/lifecycle.js';

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

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const MIDNIGHT = '00000000-0000-4000-8000-0000000000be';

test.before(async () => {
  __setTestDb(
    createFakeDb({
      themes: [await seedRow('brand'), await seedRow('midnight')],
    }),
  );
  await initializeStorage();
});
test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

test('loadThemeAssets and storage getThemeRecord are not interchangeable', async () => {
  // The exact call the worker used to make: repoRoot in the scope slot. Since
  // the scope-first convention (A7.20) this fails loudly instead of answering
  // null — a string is not a StorageScope.
  await assert.rejects(
    () => getThemeRecord(repoRoot, MIDNIGHT),
    /getThemeRecord\(\) takes a storage scope, not a repoRoot string/,
    'storage getThemeRecord must refuse a repoRoot in the scope slot — the silent null is what hid the swap',
  );

  // The call it makes now, with the same two values, resolves a real theme.
  const theme = await loadThemeAssets(repoRoot, MIDNIGHT);
  assert.equal(theme?.id, MIDNIGHT);
  assert.ok(theme.cssVars && typeof theme.cssVars === 'object');
});

test('runtime resolves UUID and default, and refuses obsolete names', async () => {
  assert.equal((await listSeedThemes()).length, 2);
  assert.equal((await loadThemeAssets(repoRoot, MIDNIGHT)).id, MIDNIGHT);
  assert.equal((await loadThemeAssets(repoRoot, 'default')).slug, 'brand');
  await assert.rejects(
    loadThemeAssets(repoRoot, 'midnight'),
    /Invalid theme ID/,
  );
  await assert.rejects(
    loadThemeAssets(repoRoot, 'no-such-theme'),
    /Invalid theme ID/,
  );
});

test('the export worker loads its theme through utils/themes.js', async () => {
  // Since B520 the worker builds its context in services/exports.js, the one
  // export context every caller shares; the loader is pinned there.
  const worker = await fs.readFile(
    path.join(repoRoot, 'server/jobs/queue/workers/export-worker.js'),
    'utf8',
  );
  const service = await fs.readFile(
    path.join(repoRoot, 'server/services/exports.js'),
    'utf8',
  );

  assert.match(
    worker,
    /import\s*\{[^}]*\bprepareQueuedExportContext\b[^}]*\}\s*from\s*'[^']*services\/exports\.js'/,
    'export-worker must build its context through services/exports.js',
  );
  assert.match(
    service,
    /import\s*\{[^}]*\bloadThemeAssets\b[^}]*\}\s*from\s*'[^']*utils\/themes\.js'/,
    'services/exports.js must import loadThemeAssets from utils/themes.js',
  );
  for (const src of [worker, service]) {
    assert.doesNotMatch(
      src,
      /from\s*'[^']*storage\/themes\.js'/,
      'the export context must not reach for the storage-layer theme accessor: its signature is (scope, themeId)',
    );
  }
});

test('the export worker reads the export type from the job name, not job.data', async () => {
  // The enqueue site (`export/pipeline.js`) passes the export type as the
  // BullMQ job *name* — `addJob(QUEUE_NAMES.EXPORT, exportType, data)` — and
  // never puts a `type` field in the data. The worker used to destructure
  // `type` out of `job.data`, so every queued export failed with "Unknown
  // export type: undefined" (found by the A7.20 Redis verification; the sync
  // fallback masked it on every Redis-less environment, the same way it
  // masked the theme swap above).
  const src = await fs.readFile(
    path.join(repoRoot, 'server/jobs/queue/workers/export-worker.js'),
    'utf8',
  );

  assert.match(
    src,
    /const type = job\.name/,
    'the job name is the type’s one canonical carrier',
  );
  assert.doesNotMatch(
    src,
    /\{[^}\n]*\btype\b[^}\n]*\}\s*=\s*job\.data/,
    'job.data has no type field — destructuring one reintroduces the undefined-type failure',
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
    'getThemeRecord takes (scope, themeId); passing a repoRoot as the scope throws',
  );
});
