#!/usr/bin/env node
/**
 * Generate the bundled gradient library into `assets/gradients/`.
 *
 *   npm run gen:gradients
 *
 * The set is themes × compositions (see server/media/bundled-gradients.js). Run
 * this after changing a theme's `brandColors`/background tokens or a recipe;
 * `tests/bundled-gradients.test.js` fails until the committed files match.
 *
 * Files that no longer belong to any item are removed, so deleting a theme
 * leaves no orphan asset behind.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GRADIENT_DIR_REL,
  buildGradientItems,
  loadBundledGradientThemes,
  renderGradientSvg,
} from '../server/media/bundled-gradients.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const outDir = path.join(repoRoot, GRADIENT_DIR_REL);
  await fs.mkdir(outDir, { recursive: true });

  const themes = await loadBundledGradientThemes(repoRoot);
  const items = buildGradientItems(themes);
  if (!items.length) {
    console.error('No usable themes found in themes/ — nothing generated.');
    process.exitCode = 1;
    return;
  }

  const expected = new Set(items.map((it) => `${it.id}.svg`));
  let written = 0;
  for (const item of items) {
    const file = path.join(outDir, `${item.id}.svg`);
    const svg = renderGradientSvg(item.spec);
    const prev = await fs.readFile(file, 'utf8').catch(() => null);
    if (prev === svg) continue;
    await fs.writeFile(file, svg, 'utf8');
    written++;
  }

  let removed = 0;
  for (const name of await fs.readdir(outDir)) {
    if (!name.endsWith('.svg') || expected.has(name)) continue;
    await fs.rm(path.join(outDir, name));
    removed++;
  }

  console.log(
    `Bundled gradients: ${items.length} item(s) from ${new Set(items.map((i) => i.theme)).size} theme(s) — ` +
      `${written} written, ${removed} removed → ${GRADIENT_DIR_REL}/`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
