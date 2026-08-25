#!/usr/bin/env node

/**
 * Legacy background migration (bgImage → slideBgImage).
 *
 * Folds every stored slide's legacy `bgImage`/`bgAlt` into the canonical
 * `slideBgImage`, reproducing the old `.has-bg` look via the generic controls
 * (slideBgText: 'light' + slideBgOverlay: 'gradient-bottom'). Uses the SAME
 * authority as migrate-on-edit (`ensureSlideBgImage`), so a deck migrated by
 * this script is byte-identical to one migrated by opening it in the editor.
 * Idempotent — safe to run repeatedly.
 *
 * Scope: every slide type, not just the core `title-slide` this script started
 * out on. The pair is a content legacy any type could declare — the contributor
 * doc taught forks to — and a fork type still carrying it renders its own
 * picker beside the shared Background section until the fold has run.
 *
 * Usage:
 *   node scripts/migrate-legacy-bg-image.js [--dry-run] [--dir path/to/decks]
 *
 * Defaults to the file-based deck store (data/decks). Use --dry-run first.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ensureSlideBgImage } from '../shared/slide-types/legacy-bg-image.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dirIdx = args.indexOf('--dir');
const dataDir =
  dirIdx !== -1 ? resolve(args[dirIdx + 1]) : resolve('data/decks');

let totalDecks = 0;
let modifiedDecks = 0;
let slidesMigrated = 0;

/**
 * Migrate a single slide's content in place. Returns true when the content
 * changed (a legacy bgImage/bgAlt was present and got folded).
 * @param {Object} slide
 * @returns {boolean}
 */
function migrateSlide(slide) {
  const before = JSON.stringify(slide.content || {});
  ensureSlideBgImage(slide.content || {});
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
    if (!slide?.content || typeof slide.content !== 'object') continue;
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

console.log(
  `${dryRun ? '[DRY RUN] ' : ''}Migrating legacy backgrounds in: ${dataDir}`,
);
await walkDir(dataDir);
console.log(`\nResults:`);
console.log(`  Decks scanned:            ${totalDecks}`);
console.log(`  Decks modified:           ${modifiedDecks}`);
console.log(`  Slides migrated:          ${slidesMigrated}`);
if (dryRun) console.log(`\n  [DRY RUN] No files were modified.`);
