/**
 * The Google Fonts pin — gate on `scripts/google-fonts.lock.json`.
 *
 * `postinstall` fills the gitignored `assets/fonts/google/` from that lockfile.
 * Before the pin existed the script resolved every file live against Google's
 * CSS API, which had two consequences this file guards against:
 *
 *  1. **Nothing was reproducible.** A font update on Google's side silently
 *     changed how every deck rendered, so no baseline — pixel or structural —
 *     could mean anything (docs/plans/briefs/export-structural-metrics.md).
 *  2. **The wrong bytes were shipped.** The script took whichever @font-face
 *     came first in the response, which is Google's `cyrillic-ext` subset. Those
 *     files contain no Latin glyphs at all, so every curated font quietly
 *     rendered in a fallback face.
 *
 * These tests run offline: they check the lock itself and the consistency
 * between the lock, `CURATED_FONTS`, and the path helper every consumer derives
 * its `<link>`/`@font-face` URLs from. The font files are not in git, so the
 * on-disk checksum check skips when they have not been downloaded.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CURATED_FONTS,
  FONT_SUBSETS,
  FONT_SUBSET_NAMES,
  curatedFontFaces,
  curatedFontPath,
  fontFamilyToSlug,
} from '../shared/theme-fonts.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const lockPath = path.join(repoRoot, 'scripts', 'google-fonts.lock.json');
const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));

/** Every (family, weight, subset) triple the curated list implies. */
function expectedTriples() {
  const out = [];
  for (const font of CURATED_FONTS) {
    for (const weight of font.weights) {
      for (const subset of FONT_SUBSET_NAMES) {
        out.push({ family: font.family, weight, subset });
      }
    }
  }
  return out;
}

test('the lockfile covers exactly the curated font list', () => {
  const locked = Object.keys(lock.fonts).sort();
  const curated = CURATED_FONTS.map((f) => f.family).sort();
  assert.deepEqual(
    locked,
    curated,
    'adding or removing a font in CURATED_FONTS must be followed by ' +
      '`node scripts/download-google-fonts.js --update-lock`',
  );
});

test('every curated weight is pinned in both Latin subsets', () => {
  const missing = [];
  for (const { family, weight, subset } of expectedTriples()) {
    const files = lock.fonts[family]?.files || [];
    if (!files.some((f) => f.weight === weight && f.subset === subset)) {
      missing.push(`${family} ${weight} ${subset}`);
    }
  }
  assert.deepEqual(missing, [], `unpinned font files: ${missing.join(', ')}`);
});

test('no pinned file falls outside the declared subsets', () => {
  // The regression that made this file necessary: the downloader shipping
  // cyrillic-ext because it happened to be first in Google's response.
  const stray = [];
  for (const [family, entry] of Object.entries(lock.fonts)) {
    for (const file of entry.files) {
      if (!FONT_SUBSET_NAMES.includes(file.subset)) {
        stray.push(`${family} ${file.weight} ${file.subset}`);
      }
    }
  }
  assert.deepEqual(
    stray,
    [],
    `pinned files outside latin/latin-ext: ${stray.join(', ')}`,
  );
});

test('every pin carries a real URL and SHA-256', () => {
  const bad = [];
  for (const [family, entry] of Object.entries(lock.fonts)) {
    for (const file of entry.files) {
      if (!/^[0-9a-f]{64}$/.test(String(file.sha256 || ''))) {
        bad.push(`${family} ${file.file}: sha256 is not 64 hex chars`);
      }
      if (!/^https:\/\/fonts\.gstatic\.com\//.test(String(file.url || ''))) {
        bad.push(
          `${family} ${file.file}: url is not an https fonts.gstatic.com URL`,
        );
      }
      if (!Number.isInteger(file.bytes) || file.bytes <= 0) {
        bad.push(`${family} ${file.file}: bytes is not a positive integer`);
      }
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('lockfile filenames match the path helper every consumer uses', () => {
  // The theme builder, the embed/export CSS and the app-chrome stylesheet all
  // derive their URLs from curatedFontPath(); if the downloader ever wrote a
  // different name the files would exist and still 404.
  const mismatched = [];
  for (const [family, entry] of Object.entries(lock.fonts)) {
    const slug = fontFamilyToSlug(family);
    assert.equal(
      entry.slug,
      slug,
      `${family}: lockfile slug should be ${slug}`,
    );
    for (const file of entry.files) {
      const expected = path.basename(
        curatedFontPath(slug, file.weight, file.subset),
      );
      if (file.file !== expected)
        mismatched.push(`${family}: ${file.file} ≠ ${expected}`);
    }
  }
  assert.deepEqual(mismatched, [], mismatched.join('\n'));
});

test('no two pins write to the same file', () => {
  for (const [family, entry] of Object.entries(lock.fonts)) {
    const names = entry.files.map((f) => f.file);
    assert.equal(
      new Set(names).size,
      names.length,
      `${family} pins the same output filename twice — one download would overwrite the other`,
    );
  }
});

test('the lock records the unicode ranges the CSS generators emit', () => {
  // The downloader refuses to refresh when Google's ranges drift from these
  // constants; this asserts the committed lock was produced under that rule,
  // so the ranges in generated @font-face rules describe the pinned bytes.
  assert.deepEqual(
    lock.subsets,
    FONT_SUBSETS.map(({ name, unicodeRange }) => ({ name, unicodeRange })),
    'lockfile subsets drifted from FONT_SUBSETS — re-run --update-lock',
  );
});

test('curatedFontFaces() describes the same set of files as the lock', () => {
  for (const font of CURATED_FONTS) {
    const faces = curatedFontFaces(font.family)
      .map((f) => path.basename(f.path))
      .sort();
    const pinned = lock.fonts[font.family].files.map((f) => f.file).sort();
    assert.deepEqual(
      faces,
      pinned,
      `${font.family}: face list and pin list disagree`,
    );
  }
});

test('downloaded font files match their pinned checksums', async () => {
  // assets/fonts/google/ is gitignored and filled by postinstall. A contributor
  // who skipped the optional download gets a skip, not a false red.
  const probe = path.join(repoRoot, curatedFontPath('inter', 400, 'latin'));
  try {
    await fs.access(probe);
  } catch {
    return; // fonts not downloaded in this checkout
  }

  const mismatches = [];
  for (const [family, entry] of Object.entries(lock.fonts)) {
    for (const file of entry.files) {
      const abs = path.join(
        repoRoot,
        curatedFontPath(entry.slug, file.weight, file.subset),
      );
      let buf;
      try {
        buf = await fs.readFile(abs);
      } catch {
        mismatches.push(`${family} ${file.file}: pinned but not downloaded`);
        continue;
      }
      const actual = crypto.createHash('sha256').update(buf).digest('hex');
      if (actual !== file.sha256)
        mismatches.push(`${family} ${file.file}: checksum mismatch`);
    }
  }
  assert.deepEqual(mismatches, [], mismatches.join('\n'));
});
