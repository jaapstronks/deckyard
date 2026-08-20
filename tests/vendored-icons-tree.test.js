/**
 * Guard: the vendored Lucide tree holds exactly what the registries claim.
 *
 * `scripts/vendor-lucide.js` used to only copy. A name dropped from
 * `ICON_NAMES`/`UI_ICON_NAMES` left its SVG behind, and nothing noticed: the
 * `vendor-freshness` CI job re-runs the script and fails on a changed tree,
 * but an orphan is precisely the change a copy-only script cannot make. That
 * is how `layout-grid.svg` sat in `client/vendor/` at lucide-static 0.469.0
 * until #864 happened to re-list the name and the stale copy refreshed.
 *
 * The script prunes now (A7.26). This test is the cheap half of the same
 * gate: it runs in `npm test`, needs no `npm ci`, and states the invariant
 * directly — the directory listing equals
 * `ICON_NAMES ∪ UI_ICON_NAMES ∪ keys(LEGACY_PHOSPHOR_MAP)` plus the two
 * generated JSON files. The legacy alias names are not orphans: the script
 * writes them itself, as copies under the old Phosphor name.
 *
 * Run with: node --test tests/vendored-icons-tree.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ICON_NAMES,
  UI_ICON_NAMES,
  LEGACY_PHOSPHOR_MAP,
} from '../shared/icon-names.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const VENDOR_DIR = path.join(here, '..', 'client/vendor/lucide-icons');

// Generated alongside the SVGs by the same script.
const GENERATED = ['manifest.json', 'tags.json'];

const expected = new Set([
  ...ICON_NAMES.map((n) => `${n}.svg`),
  ...UI_ICON_NAMES.map((n) => `${n}.svg`),
  ...Object.keys(LEGACY_PHOSPHOR_MAP).map((n) => `${n}.svg`),
  ...GENERATED,
]);

test('no vendored file is unclaimed by the registries', () => {
  const strays = fs
    .readdirSync(VENDOR_DIR)
    .filter((entry) => !expected.has(entry))
    .sort();
  assert.deepEqual(
    strays,
    [],
    `Unclaimed file(s) in client/vendor/lucide-icons — a name left the ` +
      `registries but its file stayed, or something was dropped in by hand:\n  ` +
      `${strays.join('\n  ')}\n` +
      'Run `npm run vendor:lucide` to prune, then commit the deletion.',
  );
});

test('every claimed name is vendored', () => {
  const present = new Set(fs.readdirSync(VENDOR_DIR));
  const missing = [...expected].filter((f) => !present.has(f)).sort();
  assert.deepEqual(
    missing,
    [],
    `Registered icon(s) with no vendored file — run \`npm run vendor:lucide\`:\n  ${missing.join('\n  ')}`,
  );
});
