#!/usr/bin/env node

/**
 * Title-slide background migration (bgImage → slideBgImage).
 *
 * Folds every stored `title-slide`'s legacy `bgImage`/`bgAlt` into the
 * canonical `slideBgImage`, reproducing the old `.has-bg` look via the generic
 * controls (slideBgText: 'light' + slideBgOverlay: 'gradient-bottom'). Uses the
 * SAME authority as migrate-on-edit (`ensureTitleSlideBackground`), so a deck
 * migrated by this script is byte-identical to one migrated by opening it in
 * the editor. Idempotent — safe to run repeatedly.
 *
 * Scope: only the core `title-slide` type. `split-partner-title-slide` (being
 * archived) and the custom `ciiic-title-slide` (draws its own bgImage) are left
 * untouched on purpose.
 *
 * Usage:
 *   node scripts/migrate-title-bg.js [--dry-run] [--dir path/to/decks]
 *
 * Defaults to the file-based deck store (data/decks). Use --dry-run first.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ensureTitleSlideBackground } from '../shared/slide-types/title-slide-background.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dirIdx = args.indexOf('--dir');
const dataDir = dirIdx !== -1 ? resolve(args[dirIdx + 1]) : resolve('data/decks');

let totalDecks = 0;
let modifiedDecks = 0;
let slidesMigrated = 0;

/**
 * Migrate a single title slide's content in place. Returns true when the
 * content changed (a legacy bgImage was present and got folded).
 * @param {Object} slide
 * @returns {boolean}
 */
function migrateSlide(slide) {
  const before = JSON.stringify(slide.content || {});
  ensureTitleSlideBackground(slide.content || {});
  return JSON.stringify(slide.content || {}) !== before;
}

async function processFile(filePath) {
  const raw = await readFile(filePath, 'utf8');
  let deck;
  try {
    deck = JSON.parse(raw);
  } catch {
    return; // skip non-JSON
  }
  if (!deck || !Array.isArray(deck.slides)) return;
  totalDecks++;

  let modified = false;
  for (const slide of deck.slides) {
    if (!slide || slide.type !== 'title-slide') continue;
    if (!slide.content || typeof slide.content !== 'object') continue;
    if (migrateSlide(slide)) {
      slidesMigrated++;
      modified = true;
    }
  }

  if (modified) {
    modifiedDecks++;
    if (!dryRun) {
      await writeFile(filePath, JSON.stringify(deck, null, 2) + '\n', 'utf8');
    }
  }
}

async function walkDir(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    console.error(`Cannot read directory: ${dir}`);
    process.exit(1);
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(full);
    } else if (entry.name.endsWith('.json')) {
      await processFile(full);
    }
  }
}

console.log(`${dryRun ? '[DRY RUN] ' : ''}Migrating title backgrounds in: ${dataDir}`);
await walkDir(dataDir);
console.log(`\nResults:`);
console.log(`  Decks scanned:            ${totalDecks}`);
console.log(`  Decks modified:           ${modifiedDecks}`);
console.log(`  title slides migrated:    ${slidesMigrated}`);
if (dryRun) console.log(`\n  [DRY RUN] No files were modified.`);
