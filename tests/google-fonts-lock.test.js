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
 *
 * **Two locks, one contract (B163).** A fork's families are declared in
 * `custom/fonts.js` and pinned in `custom/google-fonts.lock.json`; upstream's
 * file holds upstream's families and nothing else. Coverage is therefore checked
 * per owner — otherwise this gate is the thing that forces a fork to edit a
 * generated core file, which is the friction the seam removes. Everything below
 * coverage (subsets, checksums, filenames) is about the *format* of a pin and
 * runs over both locks merged.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CURATED_FONTS,
  CUSTOM_FONT_FAMILIES,
  FONT_SUBSETS,
  FONT_SUBSET_NAMES,
  curatedFontFaces,
  curatedFontPath,
  fontFamilyToSlug,
  isCustomFont,
} from '../shared/theme-fonts.js';
import {
  CUSTOM_FONTS_FILE_REL,
  CUSTOM_FONTS_LOCK_REL,
  customFontProblem,
} from '../shared/custom-fonts-loader.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const lockPath = path.join(repoRoot, 'scripts', 'google-fonts.lock.json');
const coreLock = JSON.parse(await fs.readFile(lockPath, 'utf8'));

/** The fork half, absent upstream. */
const customLock = await fs
  .readFile(path.join(repoRoot, CUSTOM_FONTS_LOCK_REL), 'utf8')
  .then(JSON.parse)
  .catch(() => null);

/** Every pin this checkout honours, whichever file it came from. */
const lock = {
  ...coreLock,
  fonts: { ...coreLock.fonts, ...(customLock?.fonts || {}) },
};

/** The seam, spelled once for the messages that have to point at it. */
const SEAM_HINT =
  `A fork's families belong in ${CUSTOM_FONTS_FILE_REL} and are pinned in ` +
  `${CUSTOM_FONTS_LOCK_REL} by the same \`--update-lock\` run — not in ` +
  "upstream's list or upstream's lock.";

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

test("upstream's lockfile covers exactly upstream's curated fonts", () => {
  const locked = Object.keys(coreLock.fonts).sort();
  const curated = CURATED_FONTS.map((f) => f.family)
    .filter((f) => !isCustomFont(f))
    .sort();
  assert.deepEqual(
    locked,
    curated,
    'adding or removing a font in CURATED_FONTS must be followed by ' +
      `\`node scripts/download-google-fonts.js --update-lock\`.\n${SEAM_HINT}`,
  );
});

test("the fork's lockfile covers exactly the fork's declared fonts", () => {
  // Skips cleanly upstream, where both sides are empty, and is the whole check
  // in a fork: it is the assertion that used to fail as "npm install died".
  const locked = Object.keys(customLock?.fonts || {}).sort();
  assert.deepEqual(
    locked,
    [...CUSTOM_FONT_FAMILIES].sort(),
    `${CUSTOM_FONTS_FILE_REL} and ${CUSTOM_FONTS_LOCK_REL} disagree — run ` +
      '`node scripts/download-google-fonts.js --update-lock`',
  );
});

test('upstream ships the seam empty', async () => {
  // The other direction of the same honesty: the split above only means
  // something if upstream's own list is core's. This is a claim about *this*
  // checkout, so it steps aside in a fork — where the pairing test above is the
  // one that has teeth — rather than turning the seam into a red suite, which
  // is the friction it exists to remove.
  const forked = await fs
    .access(path.join(repoRoot, CUSTOM_FONTS_FILE_REL))
    .then(() => true)
    .catch(() => false);
  if (forked) return;

  assert.deepEqual(
    CUSTOM_FONT_FAMILIES,
    [],
    `no ${CUSTOM_FONTS_FILE_REL}, so nothing should have been folded in`,
  );
  assert.equal(
    customLock,
    null,
    `${CUSTOM_FONTS_LOCK_REL} is written only when a fork declares fonts`,
  );
});

test('the seam rejects entries that would break a consumer', () => {
  // Self-test: the validator runs on input built to fail, so an upstream
  // checkout with nothing to load still exercises the logic a fork depends on.
  const taken = new Set(['Inter']);
  const cases = [
    [null, 'not an object'],
    [{ category: 'serif', weights: [400] }, 'missing a "family" string'],
    [
      { family: 'X', category: 'blackletter', weights: [400] },
      'category must be',
    ],
    [{ family: 'X', category: 'serif', weights: [] }, 'non-empty array'],
    [{ family: 'X', category: 'serif', weights: [400.5] }, 'integers between'],
    [{ family: 'Inter', category: 'serif', weights: [400] }, 'already curated'],
  ];
  for (const [entry, expected] of cases) {
    const problem = customFontProblem(entry, taken);
    assert.ok(
      problem?.includes(expected),
      `expected "${expected}" for ${JSON.stringify(entry)}, got ${problem}`,
    );
  }
  assert.equal(
    customFontProblem(
      { family: 'League Spartan', category: 'sans-serif', weights: [400, 700] },
      taken,
    ),
    null,
    'a well-formed fork family is accepted',
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
