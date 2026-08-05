import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTheme } from '../server/utils/themes.js';
import { getTheme } from '../server/storage/themes.js';

/**
 * Regression guard for the *loader*, not the theme.
 *
 * Two functions in this codebase are called "get the theme" and they take
 * opposite arguments:
 *
 *   utils/themes.js    loadTheme(repoRoot, rawThemeId, ctx?)
 *   storage/themes.js  getTheme(themeId, ctx)
 *
 * The queued export worker imported the second and called it with the first
 * one's arguments — `getTheme(repoRoot, themeName)`. Neither argument is
 * rejected: a repo path is simply not a theme UUID (→ `null`) and a theme name
 * is an object-shaped ctx that has no `organizationId` (→ no org filter). So
 * every queued export (pptx, pdf, pdf-slides, png, handoff-zip, notes) rendered
 * with `theme = null` while the synchronous path rendered with a real theme.
 * Silent in every test, wrong in production.
 *
 * These tests pin the swap itself, so putting it back turns something red.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('loadTheme and storage getTheme are not interchangeable', async () => {
  // The exact call the worker used to make: repoRoot in the themeId slot.
  assert.equal(
    await getTheme(repoRoot, 'midnight'),
    null,
    'storage getTheme accepts a repoRoot silently and answers null — that is why the swap was invisible'
  );

  // The call it makes now, with the same two values, resolves a real theme.
  const theme = await loadTheme(repoRoot, 'midnight');
  assert.equal(theme?.id, 'midnight');
  assert.ok(theme.cssVars && typeof theme.cssVars === 'object');
});

test('loadTheme always resolves a theme, never null', async () => {
  // The failure mode was `theme = null` reaching every export builder, so pin
  // the invariant the worker now relies on: named, unknown and absent all
  // resolve to a usable theme object.
  for (const themeName of ['midnight', 'editorial', 'no-such-theme', '', undefined]) {
    const theme = await loadTheme(repoRoot, themeName);
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
    /import\s*\{[^}]*\bloadTheme\b[^}]*\}\s*from\s*'[^']*utils\/themes\.js'/,
    'export-worker must import loadTheme from utils/themes.js'
  );
  assert.doesNotMatch(
    src,
    /from\s*'[^']*storage\/themes\.js'/,
    'export-worker must not reach for the storage-layer theme accessor: its signature is (themeId, ctx)'
  );
});

test('no server call site passes a repoRoot into storage getTheme', async () => {
  const offenders = [];

  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'uploads') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith('.js')) {
        const src = await fs.readFile(full, 'utf8');
        if (/\bgetTheme\s*\(\s*(?:job\.data\.)?_?repoRoot\b/.test(src)) {
          offenders.push(path.relative(repoRoot, full));
        }
      }
    }
  }

  await walk(path.join(repoRoot, 'server'));

  assert.deepEqual(
    offenders,
    [],
    'getTheme takes (themeId, ctx); passing a repoRoot returns null instead of throwing'
  );
});
