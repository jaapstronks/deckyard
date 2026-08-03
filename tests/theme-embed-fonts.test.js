/**
 * The built-in themes' `embedFonts` lists are generated artifacts of the
 * curated font set — and generated artifacts that are committed by hand drift.
 *
 * They already had: `themes/corporate.json` was missing Archivo's 500 weight
 * and `themes/midnight.json` both JetBrains Mono 500 and 700, so exports of
 * those themes fell back to a system face wherever the CSS asked for the
 * missing weight. Nothing caught it, because nothing compared the committed
 * lists to the list `curatedEmbedFonts()` produces.
 *
 * This does. Adding a weight to `CURATED_FONTS`, refreshing the pin, or
 * changing how faces are merged now fails here until the theme files are
 * regenerated with it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getFontByFamily } from '../shared/theme-fonts.js';
import { curatedEmbedFonts } from '../server/utils/curated-font-embed.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const themesDir = path.join(repoRoot, 'themes');

const themeFiles = (await fs.readdir(themesDir)).filter((f) => f.endsWith('.json')).sort();

const themes = await Promise.all(
  themeFiles.map(async (file) => [
    file,
    JSON.parse(await fs.readFile(path.join(themesDir, file), 'utf8')),
  ])
);

test('there are built-in themes to check', () => {
  assert.ok(themes.length > 0, 'themes/*.json should exist');
});

test("every theme's curated embedFonts match curatedEmbedFonts()", () => {
  const drift = [];

  for (const [file, theme] of themes) {
    const entries = Array.isArray(theme.embedFonts) ? theme.embedFonts : [];
    // Families in the order the theme declares them; non-curated (uploaded /
    // custom) families are the theme's own business and are left alone.
    const families = [...new Set(entries.map((e) => e.family))].filter((f) =>
      getFontByFamily(f)
    );

    for (const family of families) {
      const actual = entries.filter((e) => e.family === family);
      const expected = curatedEmbedFonts(family);
      try {
        assert.deepEqual(actual, expected);
      } catch {
        drift.push(
          `${file} — ${family}\n` +
            `      committed: ${actual.map((e) => `${e.weight}/${e.path.split('-').pop()}`).join(', ')}\n` +
            `      expected:  ${expected.map((e) => `${e.weight}/${e.path.split('-').pop()}`).join(', ')}`
        );
      }
    }
  }

  assert.deepEqual(
    drift,
    [],
    `theme embedFonts drifted from the curated font set:\n${drift.join('\n')}`
  );
});

test('a theme embeds every family its heading and body fonts name', () => {
  // The other half of the same drift: a theme that switched font but kept the
  // old embedFonts list would render its own headings in a fallback face.
  const missing = [];

  for (const [file, theme] of themes) {
    const families = new Set((theme.embedFonts || []).map((e) => e.family));
    for (const varName of ['--t-font-heading', '--t-font-body']) {
      const stack = String(theme.cssVars?.[varName] || '');
      const family = stack.split(',')[0].replace(/['"]/g, '').trim();
      if (!family || !getFontByFamily(family)) continue;
      if (!families.has(family)) missing.push(`${file}: ${varName} is ${family}, not embedded`);
    }
  }

  assert.deepEqual(missing, [], missing.join('\n'));
});

test('no curated embedFonts entry names a file the lock does not pin', async () => {
  // Paths are repo-relative and gitignored until postinstall runs, so this
  // checks the *pin*, not the disk: every path a theme names must be one the
  // lockfile knows about.
  const lock = JSON.parse(
    await fs.readFile(path.join(repoRoot, 'scripts', 'google-fonts.lock.json'), 'utf8')
  );
  const pinnedPaths = new Set();
  for (const [, entry] of Object.entries(lock.fonts)) {
    for (const file of entry.files) {
      pinnedPaths.add(`assets/fonts/google/${entry.slug}/${file.file}`);
    }
  }

  const stray = [];
  for (const [file, theme] of themes) {
    for (const entry of theme.embedFonts || []) {
      if (!getFontByFamily(entry.family)) continue;
      if (!pinnedPaths.has(entry.path)) stray.push(`${file}: ${entry.path}`);
    }
  }

  assert.deepEqual(stray, [], stray.join('\n'));
});
