/**
 * The built-in theme id set: disk, enum, and what happens to a retired id.
 *
 * Renaming a built-in touches two places — `themes/<id>.json` and the `THEMES`
 * array in shared/slide-types/registry.js, which is the validation enum. Doing
 * only one of the two is the classic half-rename: the theme still renders (the
 * loader falls back) but saving a deck on it fails, or the picker offers an id
 * with no file behind it.
 *
 * The `deckyard` theme was renamed to `amethyst` (id, label and logo) because a
 * product name did not belong among five palette-named archetypes, and because
 * it carried the green brand mark on a violet palette. No alias was kept: the
 * old id is retired, and this file pins what that costs.
 *
 * **A fork's theme is not a built-in.** Every assertion here is about the five
 * shipped archetypes, and the enum it compares them to is core's. A fork that
 * put its theme in `themes/` met this gate and read it as "add your id to
 * `THEMES`" — the enum is what the failures named, so the enum is where forks
 * went. The right answer was `custom/themes/<id>/theme.json`, which needs no
 * enum entry and no core edit at all; the messages below say so now. See
 * {@link THEME_SEAM_HINT} and `docs/reference/fork-setup.md`.
 *
 * Run with: node --test tests/theme-builtin-ids.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  THEMES,
  validatePresentation,
  newPresentation,
} from '../shared/slide-types.js';
import { DEFAULT_THEME_ID } from '../shared/constants/themes.js';
import { loadThemeAssets, resolveThemeId } from '../server/utils/themes.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const themesDir = path.join(repoRoot, 'themes');

const RETIRED_ID = 'deckyard';

/**
 * The seam every failure in this file points at.
 *
 * A gate that fails correctly and suggests the wrong fix costs one session per
 * fork (B163). Custom themes are discovered from disk by
 * `server/utils/themes.js`, so they are validated as `custom` and never need to
 * appear in `THEMES`.
 */
const THEME_SEAM_HINT =
  'A fork theme belongs in custom/themes/<id>/theme.json — it is discovered ' +
  'from disk and needs no entry in THEMES. See docs/reference/fork-setup.md.';

test('every shipped theme file is in the validation enum, and vice versa', async () => {
  const onDisk = (await fs.readdir(themesDir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();

  assert.deepEqual(
    [...THEMES].sort(),
    onDisk,
    `THEMES and themes/*.json must name the same set.\n${THEME_SEAM_HINT}`,
  );
});

test('each theme file declares the id its filename promises', async () => {
  for (const id of THEMES) {
    const raw = JSON.parse(
      await fs.readFile(path.join(themesDir, `${id}.json`), 'utf8'),
    );
    assert.equal(
      raw.id,
      id,
      `themes/${id}.json must declare "id": "${id}"\n${THEME_SEAM_HINT}`,
    );
  }
});

test('only the brand theme wears the Deckyard mark', async () => {
  for (const id of THEMES) {
    const raw = JSON.parse(
      await fs.readFile(path.join(themesDir, `${id}.json`), 'utf8'),
    );
    const usesMark = JSON.stringify(raw).includes('deckyard-mark.svg');
    if (id === DEFAULT_THEME_ID) {
      assert.ok(usesMark, `${id} is the brand theme and should carry the mark`);
    } else {
      assert.ok(
        !usesMark,
        `${id} is an archetype and must use the neutral placeholder logo.\n` +
          `${THEME_SEAM_HINT}`,
      );
    }
  }
});

test('the retired deckyard id is gone from the enum and from disk', async () => {
  assert.ok(!THEMES.includes(RETIRED_ID), 'no alias was kept for the old id');
  await assert.rejects(() =>
    fs.access(path.join(themesDir, `${RETIRED_ID}.json`)),
  );
});

test('a deck on a retired theme id still renders — the loader falls back to the default', async () => {
  // This is the whole risk of the rename. resolveThemeId() keeps an unknown but
  // well-formed id as-is, and loadThemeAssets() then finds no file and retries
  // with DEFAULT_THEME. So an old deck renders in the default theme instead of
  // throwing or rendering unstyled.
  assert.equal(
    resolveThemeId(RETIRED_ID),
    RETIRED_ID,
    'the id is not silently rewritten',
  );

  const theme = await loadThemeAssets(repoRoot, RETIRED_ID);
  assert.equal(theme.id, DEFAULT_THEME_ID);
});

test('saving a deck on a retired theme id fails loudly rather than silently', () => {
  // The flip side of the fallback: validation has no such tolerance, so the
  // stale id surfaces as an error on the next write instead of quietly
  // persisting an id nothing can load.
  const { ok, errors } = validatePresentation(
    newPresentation({ theme: RETIRED_ID }),
  );
  assert.equal(ok, false);
  assert.ok(
    errors.some((e) => e.includes('theme')),
    `expected a theme error, got: ${errors.join('; ')}`,
  );
});

test('the seam the failures name is a real, reachable place', () => {
  // A hint is only worth its line if the directory it sends a fork to exists
  // upstream and the docs explain it. Both are cheap to break by tidying.
  assert.ok(
    THEME_SEAM_HINT.includes('custom/themes/'),
    'the hint must name the seam, not the enum',
  );
  assert.ok(
    fsSync.existsSync(path.join(repoRoot, 'custom', 'themes')),
    'custom/themes/ must exist upstream (with a .gitkeep)',
  );
});
