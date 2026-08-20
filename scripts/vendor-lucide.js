import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ICON_NAMES,
  UI_ICON_NAMES,
  LEGACY_PHOSPHOR_MAP,
} from '../shared/icon-names.js';
import { ICON_SEARCH_ALIASES } from '../shared/icon-catalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function main() {
  const destDir = path.join(repoRoot, 'client', 'vendor', 'lucide-icons');
  await ensureDir(destDir);

  // lucide-static stores icons in node_modules/lucide-static/icons/
  const srcDir = path.join(repoRoot, 'node_modules', 'lucide-static', 'icons');

  if (!(await exists(srcDir))) {
    throw new Error(
      'Could not find lucide-static icons directory. Did npm install run?',
    );
  }

  const copied = [];
  const copiedUi = [];
  const missing = [];

  // Copy each icon in our curated list
  for (const name of ICON_NAMES) {
    const src = path.join(srcDir, `${name}.svg`);
    const dst = path.join(destDir, `${name}.svg`);
    if (!(await exists(src))) {
      missing.push(name);
      continue;
    }
    await fs.copyFile(src, dst);
    copied.push(name);
  }

  // Copy the UI-chrome names too. They are kept out of `copied` on purpose:
  // that list drives the picker's search tags, and chrome glyphs are not
  // offered as slide content.
  for (const name of UI_ICON_NAMES) {
    if (copied.includes(name)) continue;
    const src = path.join(srcDir, `${name}.svg`);
    const dst = path.join(destDir, `${name}.svg`);
    if (!(await exists(src))) {
      missing.push(name);
      continue;
    }
    await fs.copyFile(src, dst);
    copiedUi.push(name);
  }

  // Create legacy alias files: copy the Lucide SVG under the old Phosphor name
  const aliases = [];
  for (const [oldName, newName] of Object.entries(LEGACY_PHOSPHOR_MAP)) {
    const src = path.join(destDir, `${newName}.svg`);
    const dst = path.join(destDir, `${oldName}.svg`);
    if (!(await exists(src))) continue;
    await fs.copyFile(src, dst);
    aliases.push(`${oldName} -> ${newName}`);
  }

  // Write a trimmed search-tags file (only the icons we vendor) so the picker
  // can fuzzy-search by keyword without shipping Lucide's full 1.5k-entry map.
  const tagsPath = path.join(srcDir, '..', 'tags.json');
  if (await exists(tagsPath)) {
    const allTags = JSON.parse(await fs.readFile(tagsPath, 'utf8'));
    const trimmed = {};
    for (const name of copied) {
      if (Array.isArray(allTags[name]) && allTags[name].length) {
        trimmed[name] = allTags[name];
      }
    }
    // Merge in our concept-word aliases so authors can find icons by intent
    // (e.g. "democracy" → vote/landmark) even when Lucide's own tags don't.
    let aliasCount = 0;
    for (const [name, extra] of Object.entries(ICON_SEARCH_ALIASES)) {
      if (!copied.includes(name) || !Array.isArray(extra)) continue;
      const merged = new Set([...(trimmed[name] || []), ...extra]);
      trimmed[name] = [...merged];
      aliasCount += 1;
    }
    // eslint-disable-next-line no-console
    console.log(`Merged search aliases for ${aliasCount} icons`);
    await fs.writeFile(
      path.join(destDir, 'tags.json'),
      JSON.stringify(trimmed),
      'utf8',
    );
    // eslint-disable-next-line no-console
    console.log(`Wrote search tags for ${Object.keys(trimmed).length} icons`);
  }

  // Prune whatever the registries no longer claim. Copying alone can never
  // produce a deletion, so a name dropped from ICON_NAMES/UI_ICON_NAMES left
  // its SVG behind for good — and, worse, invisibly: CI's vendor-freshness job
  // re-runs this script and fails on a changed tree, but an orphan is exactly
  // the change a copy-only script cannot make. That is how layout-grid.svg sat
  // in client/vendor at lucide-static 0.469.0 until #864 happened to re-list
  // it. The expected set is the union of both registries plus the legacy alias
  // names this script writes itself (those have no registry entry of their own
  // and are not orphans), plus the two generated JSON files.
  const expected = new Set([
    ...ICON_NAMES.map((n) => `${n}.svg`),
    ...UI_ICON_NAMES.map((n) => `${n}.svg`),
    ...Object.keys(LEGACY_PHOSPHOR_MAP).map((n) => `${n}.svg`),
    'manifest.json',
    'tags.json',
  ]);
  // Deliberately not recorded in the manifest: the manifest describes the
  // vendored tree, and after a run the tree never holds a pruned file. Writing
  // the list there would make two consecutive runs produce different output —
  // the one thing a freshness gate cannot tolerate.
  const pruned = [];
  for (const entry of await fs.readdir(destDir)) {
    if (expected.has(entry)) continue;
    await fs.rm(path.join(destDir, entry), { recursive: true, force: true });
    pruned.push(entry);
  }

  // Write manifest
  const manifestPath = path.join(destDir, 'manifest.json');
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        source: 'lucide-static',
        sourceDir: path.relative(repoRoot, srcDir),
        destDir: path.relative(repoRoot, destDir),
        copied,
        copiedUi,
        missing,
        aliases,
      },
      null,
      2,
    ),
    'utf8',
  );

  // eslint-disable-next-line no-console
  console.log(
    `Vendored ${copied.length} catalog + ${copiedUi.length} UI-chrome Lucide ` +
      `icons to ${path.relative(repoRoot, destDir)}`,
  );
  if (aliases.length) {
    // eslint-disable-next-line no-console
    console.log(`Created ${aliases.length} legacy alias files`);
  }
  if (pruned.length) {
    // eslint-disable-next-line no-console
    console.log(
      `Pruned ${pruned.length} file(s) no longer in the registries: ${pruned.join(', ')}`,
    );
  }
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `Missing ${missing.length} icons (not found in package): ${missing.join(', ')}`,
    );
  }
}

await main();
