#!/usr/bin/env node

/**
 * Download the curated Google Fonts we self-host, from a pinned lockfile.
 *
 * Why a lockfile: this script runs at `postinstall`, and it used to resolve
 * every file live against the Google Fonts CSS API. That made the contents of
 * `assets/fonts/google/` a function of Google's release schedule rather than of
 * this repository — any font update on their side silently shifted how decks
 * render, and no baseline (pixel or structural) could mean anything. Now every
 * byte is pinned by URL and SHA-256 in `scripts/google-fonts.lock.json`;
 * refreshing the fonts is a deliberate, reviewable diff via `--update-lock`.
 *
 * Two modes:
 *   default        read the lock, download the pinned URLs, verify checksums
 *   --update-lock  re-resolve against the Google Fonts API and rewrite the lock
 *
 * Usage:
 *   node scripts/download-google-fonts.js
 *   node scripts/download-google-fonts.js --update-lock
 *   node scripts/download-google-fonts.js --font "Inter"    # single font
 *   node scripts/download-google-fonts.js --dry-run         # show the plan
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  CURATED_FONTS,
  FONT_SUBSETS,
  FONT_SUBSET_NAMES,
  curatedFontFaces,
  curatedFontPath,
  fontFamilyToSlug,
} from '../shared/theme-fonts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const FONTS_DIR = path.join(ROOT_DIR, 'assets', 'fonts', 'google');
const LOCK_PATH = path.join(__dirname, 'google-fonts.lock.json');

// Google Fonts CSS API URL (returns CSS with @font-face rules)
const GOOGLE_FONTS_API = 'https://fonts.googleapis.com/css2';

// User agent to request WOFF2 format
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Parse command line arguments.
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    updateLock: false,
    singleFont: null,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      options.dryRun = true;
    } else if (args[i] === '--update-lock') {
      options.updateLock = true;
    } else if (args[i] === '--font' && args[i + 1]) {
      options.singleFont = args[i + 1];
      i++;
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      options.verbose = true;
    }
  }

  return options;
}

/** SHA-256 of a buffer, lowercase hex — the checksum format used in the lock. */
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Build Google Fonts API URL for a font family.
 * @param {Object} font - Font object with family and weights
 * @returns {string} - Google Fonts API URL
 */
function buildGoogleFontsUrl(font) {
  const weights = font.weights.join(';');
  const family = font.family.replace(/\s+/g, '+');
  return `${GOOGLE_FONTS_API}?family=${family}:wght@${weights}&display=swap`;
}

/**
 * Fetch the family CSS and index its @font-face rules by weight and subset.
 *
 * Google labels each block with a `/* <subset> *\/` comment immediately above
 * it, which is the only place the subset name appears — the URL itself is an
 * opaque hash. Parsing them together is what lets us pick `latin` deliberately
 * instead of "whichever rule happened to come first", which is how this script
 * ended up self-hosting the cyrillic-ext subset of every family.
 *
 * @param {string} url - Google Fonts CSS URL
 * @returns {Promise<Map<string, {weight: number, subset: string, url: string, unicodeRange: string}>>}
 *   keyed by `<weight>/<subset>`
 */
async function fetchFontFaces(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });

  if (!response.ok) {
    throw new Error(`Failed to fetch CSS: ${response.status} ${response.statusText}`);
  }

  const css = await response.text();
  const faces = new Map();

  const blockRe =
    /\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;

  let match;
  while ((match = blockRe.exec(css)) !== null) {
    const subset = match[1];
    const body = match[2];

    const weight = body.match(/font-weight:\s*(\d+)\s*;/)?.[1];
    const fileUrl = body.match(/url\(([^)]+\.woff2)\)/)?.[1];
    const unicodeRange = body.match(/unicode-range:\s*([^;]+);/)?.[1];
    if (!weight || !fileUrl || !unicodeRange) continue;

    faces.set(`${weight}/${subset}`, {
      weight: parseInt(weight, 10),
      subset,
      url: fileUrl,
      unicodeRange: unicodeRange.trim(),
    });
  }

  return faces;
}

/** Fetch a URL and return its bytes, with a clear error on a non-2xx. */
async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download font: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Resolve one family against the live API and return its lock entries.
 * @param {Object} font - Font object from CURATED_FONTS
 * @param {Object} options - CLI options
 * @returns {Promise<Array>} - Lock entries for this family
 */
async function resolveFontEntries(font, options) {
  const slug = fontFamilyToSlug(font.family);
  const apiUrl = buildGoogleFontsUrl(font);
  if (options.verbose) console.log(`   API URL: ${apiUrl}`);

  const faces = await fetchFontFaces(apiUrl);
  const entries = [];

  for (const weight of font.weights) {
    for (const { name: subset, unicodeRange: expectedRange } of FONT_SUBSETS) {
      const face = faces.get(`${weight}/${subset}`);
      if (!face) {
        throw new Error(`no ${subset} @font-face at weight ${weight} in the API response`);
      }
      // A drifting range means Google reshuffled the subset boundaries, which
      // changes which file serves which glyph. Fail loudly rather than pin a
      // file whose coverage no longer matches the constant we generate CSS from.
      if (face.unicodeRange !== expectedRange) {
        throw new Error(
          `${subset} unicode-range drifted from shared/theme-fonts.js at weight ${weight}\n` +
            `      expected: ${expectedRange}\n` +
            `      received: ${face.unicodeRange}`
        );
      }

      const bytes = await fetchBytes(face.url);
      entries.push({
        weight,
        subset,
        file: path.basename(curatedFontPath(slug, weight, subset)),
        url: face.url,
        sha256: sha256(bytes),
        bytes: bytes.length,
      });
    }
  }

  return entries;
}

/**
 * Re-resolve every curated font against the API and rewrite the lockfile.
 * @param {Object} options - CLI options
 * @returns {Promise<number>} - Number of families that failed
 */
async function updateLock(options) {
  const existing = await readLock({ optional: true });
  const fonts = existing?.fonts ? { ...existing.fonts } : {};
  let errorCount = 0;

  for (const font of selectFonts(options)) {
    console.log(`\n📝 Resolving: ${font.family}`);
    if (options.dryRun) {
      console.log(`   Would resolve weights ${font.weights.join(', ')} × ${FONT_SUBSET_NAMES.join(', ')}`);
      continue;
    }
    try {
      const files = await resolveFontEntries(font, options);
      fonts[font.family] = { slug: fontFamilyToSlug(font.family), files };
      console.log(`   ✓ ${files.length} files pinned`);
    } catch (err) {
      console.error(`   ❌ ${err.message}`);
      errorCount++;
    }
  }

  if (options.dryRun) return errorCount;

  // Drop families that have left CURATED_FONTS, so the lock never carries
  // pins for fonts nothing can request any more.
  const curated = new Set(CURATED_FONTS.map((f) => f.family));
  for (const family of Object.keys(fonts)) {
    if (!curated.has(family)) delete fonts[family];
  }

  const lock = {
    $comment:
      'Generated by `node scripts/download-google-fonts.js --update-lock`. ' +
      'Pins every self-hosted Google Font file by URL and SHA-256 so postinstall ' +
      'is reproducible and a Google-side font update cannot silently change how ' +
      'decks render. Do not hand-edit.',
    subsets: FONT_SUBSETS.map(({ name, unicodeRange }) => ({ name, unicodeRange })),
    fonts: Object.fromEntries(
      Object.keys(fonts)
        .sort()
        .map((family) => [family, fonts[family]])
    ),
  };

  await fs.writeFile(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`\n📄 Lockfile written: ${path.relative(ROOT_DIR, LOCK_PATH)}`);
  return errorCount;
}

/**
 * Read and shallow-validate the lockfile.
 * @param {{optional?: boolean}} [opts]
 * @returns {Promise<Object|null>}
 */
async function readLock({ optional = false } = {}) {
  let raw;
  try {
    raw = await fs.readFile(LOCK_PATH, 'utf8');
  } catch {
    if (optional) return null;
    throw new Error(
      `missing ${path.relative(ROOT_DIR, LOCK_PATH)} — run ` +
        '`node scripts/download-google-fonts.js --update-lock` to generate it'
    );
  }
  const lock = JSON.parse(raw);
  if (!lock?.fonts || typeof lock.fonts !== 'object') {
    throw new Error(`${path.relative(ROOT_DIR, LOCK_PATH)} has no "fonts" map`);
  }
  return lock;
}

/**
 * Download one family's pinned files, verifying each checksum.
 *
 * A checksum mismatch is fatal: it means the bytes on disk are not the bytes
 * this repository pinned, and rendering against them would be unreproducible in
 * exactly the way the lock exists to prevent. A *network* failure is not fatal —
 * these assets are optional at runtime (every consumer falls back to the system
 * stack) and failing `npm install` over a flaky connection would be worse.
 *
 * @param {Object} font - Font object from CURATED_FONTS
 * @param {Object} lock - Parsed lockfile
 * @param {Object} options - CLI options
 * @returns {Promise<{downloaded: number, cached: number}>}
 */
async function downloadPinnedFont(font, lock, options) {
  const pinned = lock.fonts[font.family];
  if (!pinned) {
    throw new Error(
      `not in the lockfile — run \`node scripts/download-google-fonts.js --update-lock\``
    );
  }

  const fontDir = path.join(FONTS_DIR, pinned.slug);
  if (options.dryRun) {
    console.log(`   Would write ${pinned.files.length} files to ${fontDir}`);
    return { downloaded: 0, cached: 0 };
  }

  await fs.mkdir(fontDir, { recursive: true });

  let downloaded = 0;
  let cached = 0;

  for (const entry of pinned.files) {
    const destPath = path.join(fontDir, entry.file);

    // An existing file counts only if it *is* the pinned bytes. Anything else
    // (a stale download from before the pin, a truncated fetch) is replaced.
    try {
      const onDisk = await fs.readFile(destPath);
      if (sha256(onDisk) === entry.sha256) {
        if (options.verbose) console.log(`   ✓ ${entry.file} (pinned, cached)`);
        cached++;
        continue;
      }
      console.log(`   ↻ ${entry.file} (does not match the pin, re-downloading)`);
    } catch {
      // Not on disk yet.
    }

    const bytes = await fetchBytes(entry.url);
    const actual = sha256(bytes);
    if (actual !== entry.sha256) {
      throw new Error(
        `checksum mismatch for ${entry.file}\n` +
          `      expected ${entry.sha256}\n` +
          `      received ${actual}\n` +
          `      the pinned URL no longer serves the pinned bytes; re-run with --update-lock ` +
          `and review the diff`
      );
    }
    await fs.writeFile(destPath, bytes);
    console.log(`   ✓ ${entry.file}`);
    downloaded++;
  }

  // Prune anything the lock does not name. `assets/fonts/google/` is a
  // generated, gitignored directory, so a file that is not pinned is a leftover
  // from an earlier naming scheme — and a leftover that still matches the old
  // `<slug>-<weight>.woff2` pattern would keep being served by a stale CSS
  // build. Nothing outside the generated tree is touched.
  const expected = new Set(pinned.files.map((f) => f.file));
  for (const name of await fs.readdir(fontDir)) {
    if (expected.has(name) || !name.endsWith('.woff2')) continue;
    await fs.rm(path.join(fontDir, name));
    if (options.verbose) console.log(`   ✗ ${name} (not pinned, removed)`);
  }

  return { downloaded, cached };
}

/**
 * Generate @font-face CSS for all downloaded fonts.
 *
 * One rule per weight × subset, each carrying its `unicode-range` so the
 * browser picks the file that actually holds the glyph it needs.
 */
function generateFontFaceCSS() {
  let css =
    '/* Auto-generated @font-face rules for self-hosted Google Fonts.\n' +
    '   Written by scripts/download-google-fonts.js — do not edit. */\n\n';

  for (const font of CURATED_FONTS) {
    for (const face of curatedFontFaces(font.family)) {
      css += `@font-face {
  font-family: '${font.family}';
  font-style: normal;
  font-weight: ${face.weight};
  font-display: swap;
  src: url('/${face.path}') format('woff2');
  unicode-range: ${face.unicodeRange};
}

`;
    }
  }

  return css;
}

/** The families this run should touch, honouring --font. */
function selectFonts(options) {
  if (!options.singleFont) return CURATED_FONTS;

  const matches = CURATED_FONTS.filter(
    (f) => f.family.toLowerCase() === options.singleFont.toLowerCase()
  );
  if (matches.length === 0) {
    console.error(`\n❌ Font "${options.singleFont}" not found in curated list.`);
    console.log('\nAvailable fonts:');
    for (const font of CURATED_FONTS) console.log(`  - ${font.family}`);
    process.exit(1);
  }
  return matches;
}

/**
 * Main entry point.
 */
async function main() {
  const options = parseArgs();

  console.log('🔤 Google Fonts Downloader');
  console.log('========================');
  if (options.dryRun) console.log('(Dry run - nothing will be written)');

  if (options.updateLock) {
    console.log('(Refreshing the lockfile against the Google Fonts API)');
    const errors = await updateLock(options);
    console.log('\n========================');
    if (errors > 0) {
      console.error(`❌ ${errors} font(s) could not be resolved — lockfile left incomplete`);
      process.exit(1);
    }
    console.log('✅ Lockfile up to date');
    return;
  }

  const lock = await readLock();

  if (!options.dryRun) await fs.mkdir(FONTS_DIR, { recursive: true });

  let successCount = 0;
  let errorCount = 0;
  let fatal = null;

  for (const font of selectFonts(options)) {
    console.log(`\n📝 Processing: ${font.family}`);
    try {
      const { downloaded, cached } = await downloadPinnedFont(font, lock, options);
      if (!options.dryRun && downloaded === 0) console.log(`   ✓ ${cached} files already pinned`);
      successCount++;
    } catch (err) {
      // A broken pin is a repository problem and must stop the run; a failed
      // fetch is an environment problem and must not break `npm install`.
      if (/checksum mismatch|lockfile/.test(err.message)) {
        fatal = err;
        break;
      }
      console.error(`   ❌ Error: ${err.message}`);
      errorCount++;
    }
  }

  if (fatal) {
    console.error(`\n❌ ${fatal.message}`);
    process.exit(1);
  }

  // Generate @font-face CSS
  if (!options.dryRun) {
    console.log('\n📄 Generating @font-face CSS...');
    const cssPath = path.join(FONTS_DIR, 'fonts.css');
    await fs.writeFile(cssPath, generateFontFaceCSS());
    console.log(`   ✓ ${cssPath}`);
  }

  // Summary
  console.log('\n========================');
  console.log(`✅ Processed: ${successCount} fonts`);
  if (errorCount > 0) {
    console.log(`⚠️  Skipped: ${errorCount} fonts (download failed — fonts fall back to the system stack)`);
  }

  if (options.dryRun) {
    console.log('\n(Run without --dry-run to download fonts)');
  }
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
