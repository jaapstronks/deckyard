#!/usr/bin/env node

/**
 * Download Google Fonts for self-hosting.
 *
 * Downloads WOFF2 files for all curated fonts and saves them to /assets/fonts/google/.
 * Run this script during build/setup, not at runtime.
 *
 * Usage:
 *   node scripts/download-google-fonts.js
 *   node scripts/download-google-fonts.js --font "Inter"    # Download single font
 *   node scripts/download-google-fonts.js --dry-run         # Show what would be downloaded
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const FONTS_DIR = path.join(ROOT_DIR, 'assets', 'fonts', 'google');

// Import curated fonts list
import { CURATED_FONTS, fontFamilyToSlug } from '../shared/theme-fonts.js';

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
    singleFont: null,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      options.dryRun = true;
    } else if (args[i] === '--font' && args[i + 1]) {
      options.singleFont = args[i + 1];
      i++;
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      options.verbose = true;
    }
  }

  return options;
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
 * Fetch CSS from Google Fonts and extract font URLs.
 * @param {string} url - Google Fonts CSS URL
 * @returns {Promise<Array>} - Array of { weight, url } objects
 */
async function fetchFontUrls(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch CSS: ${response.status} ${response.statusText}`);
  }

  const css = await response.text();

  // Parse @font-face rules to extract URLs and weights
  const fontUrls = [];
  const regex =
    /@font-face\s*\{[^}]*font-weight:\s*(\d+);[^}]*src:[^}]*url\(([^)]+\.woff2)\)[^}]*\}/g;

  let match;
  while ((match = regex.exec(css)) !== null) {
    fontUrls.push({
      weight: parseInt(match[1], 10),
      url: match[2],
    });
  }

  return fontUrls;
}

/**
 * Download a font file.
 * @param {string} url - Font URL
 * @param {string} destPath - Destination file path
 */
async function downloadFont(url, destPath) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download font: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  await fs.writeFile(destPath, Buffer.from(buffer));
}

/**
 * Process a single font family.
 * @param {Object} font - Font object
 * @param {Object} options - CLI options
 */
async function processFont(font, options) {
  const slug = fontFamilyToSlug(font.family);
  const fontDir = path.join(FONTS_DIR, slug);

  console.log(`\n📝 Processing: ${font.family}`);

  if (options.dryRun) {
    console.log(`   Would create directory: ${fontDir}`);
    console.log(`   Weights: ${font.weights.join(', ')}`);
    return;
  }

  // Create font directory
  await fs.mkdir(fontDir, { recursive: true });

  // Fetch font URLs from Google Fonts
  const apiUrl = buildGoogleFontsUrl(font);
  if (options.verbose) {
    console.log(`   API URL: ${apiUrl}`);
  }

  const fontUrls = await fetchFontUrls(apiUrl);

  if (fontUrls.length === 0) {
    console.log(`   ⚠️  No fonts found in CSS response`);
    return;
  }

  // Download each weight
  for (const { weight, url } of fontUrls) {
    const filename = `${slug}-${weight}.woff2`;
    const destPath = path.join(fontDir, filename);

    // Check if file already exists
    try {
      await fs.access(destPath);
      console.log(`   ✓ ${filename} (exists)`);
      continue;
    } catch {
      // File doesn't exist, download it
    }

    console.log(`   ⬇ Downloading ${filename}...`);
    await downloadFont(url, destPath);
    console.log(`   ✓ ${filename}`);
  }
}

/**
 * Generate @font-face CSS for all downloaded fonts.
 */
async function generateFontFaceCSS() {
  let css = '/* Auto-generated @font-face rules for self-hosted Google Fonts */\n\n';

  for (const font of CURATED_FONTS) {
    const slug = fontFamilyToSlug(font.family);

    for (const weight of font.weights) {
      const filename = `${slug}-${weight}.woff2`;
      const fontPath = `/assets/fonts/google/${slug}/${filename}`;

      css += `@font-face {
  font-family: '${font.family}';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url('${fontPath}') format('woff2');
}

`;
    }
  }

  return css;
}

/**
 * Main entry point.
 */
async function main() {
  const options = parseArgs();

  console.log('🔤 Google Fonts Downloader');
  console.log('========================');

  if (options.dryRun) {
    console.log('(Dry run - no files will be downloaded)');
  }

  // Create fonts directory
  if (!options.dryRun) {
    await fs.mkdir(FONTS_DIR, { recursive: true });
  }

  // Filter fonts if single font specified
  let fontsToProcess = CURATED_FONTS;
  if (options.singleFont) {
    fontsToProcess = CURATED_FONTS.filter(
      (f) => f.family.toLowerCase() === options.singleFont.toLowerCase()
    );

    if (fontsToProcess.length === 0) {
      console.error(`\n❌ Font "${options.singleFont}" not found in curated list.`);
      console.log('\nAvailable fonts:');
      for (const font of CURATED_FONTS) {
        console.log(`  - ${font.family}`);
      }
      process.exit(1);
    }
  }

  // Process each font
  let successCount = 0;
  let errorCount = 0;

  for (const font of fontsToProcess) {
    try {
      await processFont(font, options);
      successCount++;
    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`);
      errorCount++;
    }
  }

  // Generate @font-face CSS
  if (!options.dryRun) {
    console.log('\n📄 Generating @font-face CSS...');
    const css = await generateFontFaceCSS();
    const cssPath = path.join(FONTS_DIR, 'fonts.css');
    await fs.writeFile(cssPath, css);
    console.log(`   ✓ ${cssPath}`);
  }

  // Summary
  console.log('\n========================');
  console.log(`✅ Processed: ${successCount} fonts`);
  if (errorCount > 0) {
    console.log(`❌ Errors: ${errorCount} fonts`);
  }

  if (options.dryRun) {
    console.log('\n(Run without --dry-run to download fonts)');
  }
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
