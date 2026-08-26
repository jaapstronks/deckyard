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
 * ## Both stores, and every language version
 *
 * The first version of this script walked one directory of deck JSON. That
 * missed the two surfaces where the legacy pair actually sat (B175, from the
 * ciiic-slides run against production, 2026-08-26):
 *
 *  - **Postgres installs migrated nothing.** slides.ciiic.nl runs on Postgres,
 *    where a file walk finds no decks at all and the script still reported a
 *    clean zero. `migrate-lijstje-slide.js` had already solved this with
 *    `--backend`; this one gets the same treatment.
 *  - **Language versions were skipped in both stores.** A deck's translations
 *    live in `i18n.versions.<lang>.slides[]` and carry their own content, hence
 *    their own legacy pair. In the CIIIC production data that surface held
 *    *more* legacy slides than the decks themselves (221 against 173).
 *
 * Surfaces, and which store holds them:
 *
 * | file store                  | Postgres                          | migrated |
 * |-----------------------------|-----------------------------------|----------|
 * | `presentations/*.json`      | `presentations.slides` + `.i18n`  | yes      |
 * | `slide-library/**\/*.json`   | `slide_library.content` + `.i18n` | yes      |
 * | `presentation-versions/**`  | `presentation_versions`           | opt-in   |
 * | —                           | `presentation_comments`           | no       |
 *
 * ## Why history is left alone (unlike the lijstje rename)
 *
 * `migrate-lijstje-slide.js` migrates version snapshots too, and says so: a
 * rename is lossless, so there is nothing to weigh against doing it
 * everywhere. This fold is **not** lossless — it drops `bgAlt` and writes
 * `slideBgText`/`slideBgOverlay` the author never picked. A snapshot is a
 * record of what the deck was, and legacy content still renders correctly
 * through the read-only fallback in `resolveSlideBgImage`, folding on the first
 * edit after a restore. So history stays as it was, and `--include-versions` is
 * there for installs that would rather have one shape everywhere. Comment
 * snapshots stay out entirely: they are frozen quotes of a slide at comment
 * time, rendered read-only, and the fallback covers them.
 *
 * Usage:
 *   node scripts/migrate-legacy-bg-image.js --dry-run
 *   node scripts/migrate-legacy-bg-image.js
 *   node scripts/migrate-legacy-bg-image.js --backend both --include-versions
 *
 * Options:
 *   --dry-run            Report what would change; write nothing.
 *   --backend <mode>     `auto` (default, follows STORAGE_MODE), `file`,
 *                        `postgres`, or `both`.
 *   --dir <path>         File-store root to walk (default: the configured data
 *                        dir). Implies `--backend file`; use it to migrate an
 *                        export.
 *   --include-versions   Also fold version snapshots (see above).
 *
 * Exit code: 0 on success, 1 on failure.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isCli } from './lib/is-cli.js';
import { rewriteJsonColumns } from './lib/pg-json-rewrite.js';
import { loadDotEnv } from '../server/config/env.js';
import { isPostgresMode } from '../server/config/database.js';
import { dataDir } from '../server/config/storage-paths.js';
import { ensureSlideBgImage } from '../shared/slide-types/legacy-bg-image.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/** The two keys that carry the legacy pair; either one marks slide content. */
const LEGACY_KEYS = ['bgImage', 'bgAlt'];

/**
 * Fold every legacy background in a parsed JSON value, returning a new value
 * plus how many slide-content objects were folded.
 *
 * Recognizes content by the legacy keys themselves rather than by the shape
 * that nests it. Decks, language versions, version snapshots and library items
 * all wrap slides differently, and the pair only ever lives on slide content —
 * so a walk that keys on `bgImage`/`bgAlt` is correct for all of them, and for
 * shapes added later. Children are walked as well as folded, so a type that
 * nests its own sub-slides is covered too.
 *
 * Pure and non-mutating: the input is left untouched, so a dry run can count
 * without any risk of a half-applied write. Returns the original value by
 * identity when nothing matched, which is what the callers use to decide
 * whether a row or file needs writing at all.
 *
 * @param {*} value - Any parsed JSON value.
 * @returns {{value: *, count: number}} The folded value and the fold count.
 */
export function foldLegacyBgImageDeep(value) {
  if (Array.isArray(value)) {
    let count = 0;
    const out = value.map((entry) => {
      const res = foldLegacyBgImageDeep(entry);
      count += res.count;
      return res.value;
    });
    return count ? { value: out, count } : { value, count: 0 };
  }

  if (!value || typeof value !== 'object') return { value, count: 0 };

  let count = 0;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    const res = foldLegacyBgImageDeep(entry);
    count += res.count;
    out[key] = res.value;
  }

  const carriesLegacy = LEGACY_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
  if (carriesLegacy) {
    const before = JSON.stringify(out);
    // The copy is fresh, so the mutating shared authority is safe to use here —
    // and using it is the point: one fold, wherever it runs.
    ensureSlideBgImage(out);
    if (JSON.stringify(out) !== before) count += 1;
  }

  return count ? { value: out, count } : { value, count: 0 };
}

/* ------------------------------------------------------------------ *
 * File store
 * ------------------------------------------------------------------ */

/** Directories holding history, walked only with `--include-versions`. */
const HISTORY_DIRS = new Set(['presentation-versions']);

/**
 * Walk a directory tree and fold every `.json` file carrying the legacy pair.
 *
 * The whole tree is walked rather than the known subdirectories, so the same
 * code path serves both the live data dir and an arbitrary export dump passed
 * with `--dir` — minus the history subtree, which mirrors what the Postgres
 * side skips. Files without the pair are never rewritten, so formatting
 * elsewhere is left alone; the original trailing newline (or its absence) is
 * preserved on the ones that are.
 *
 * @param {string} root - Directory to walk.
 * @param {{dryRun?: boolean, includeVersions?: boolean}} [opts]
 * @returns {Promise<{root: string, filesScanned: number, filesModified: number, slidesMigrated: number, files: string[]}>}
 */
export async function migrateFileStore(root, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const includeVersions = Boolean(opts.includeVersions);
  const stats = {
    root,
    filesScanned: 0,
    filesModified: 0,
    slidesMigrated: 0,
    files: [],
  };

  /** @param {string} dir */
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // absent or unreadable subtree — nothing to migrate here
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!includeVersions && HISTORY_DIRS.has(entry.name)) continue;
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        await processFile(full);
      }
    }
  }

  /** @param {string} filePath */
  async function processFile(filePath) {
    let raw;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch {
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // not JSON — skip
    }
    stats.filesScanned += 1;

    // Cheap pre-filter: no legacy key, no walk, no rewrite.
    if (!LEGACY_KEYS.some((key) => raw.includes(`"${key}"`))) return;

    const { value, count } = foldLegacyBgImageDeep(parsed);
    if (!count) return;

    stats.filesModified += 1;
    stats.slidesMigrated += count;
    stats.files.push(path.relative(root, filePath) || path.basename(filePath));

    if (!dryRun) {
      const trailing = raw.endsWith('\n') ? '\n' : '';
      await writeFile(
        filePath,
        JSON.stringify(value, null, 2) + trailing,
        'utf8',
      );
    }
  }

  await walk(root);
  return stats;
}

/* ------------------------------------------------------------------ *
 * Postgres
 * ------------------------------------------------------------------ */

/**
 * The jsonb columns per table that can contain slide content. `i18n` carries
 * the language versions, which is where most of the legacy pairs turned out to
 * live.
 */
const PG_TARGETS = [
  { table: 'presentations', columns: ['slides', 'i18n'] },
  { table: 'slide_library', columns: ['content', 'i18n'] },
];

/** Only walked with `--include-versions` — see the stance in the header. */
const PG_HISTORY_TARGETS = [
  { table: 'presentation_versions', columns: ['presentation_data'] },
];

/**
 * Fold every legacy background across the Postgres surfaces that store slides.
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {{dryRun?: boolean, includeVersions?: boolean}} [opts]
 * @returns {Promise<import('./lib/pg-json-rewrite.js').RewriteResult[]>}
 */
export async function migratePostgres(db, opts = {}) {
  const targets = opts.includeVersions
    ? [...PG_TARGETS, ...PG_HISTORY_TARGETS]
    : PG_TARGETS;
  return rewriteJsonColumns(db, targets, foldLegacyBgImageDeep, {
    dryRun: Boolean(opts.dryRun),
  });
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

/**
 * @param {string[]} argv - `process.argv.slice(2)`
 * @returns {{dryRun: boolean, backend: string, dir: (string|null), includeVersions: boolean}}
 */
function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const includeVersions = argv.includes('--include-versions');
  const backendIdx = argv.indexOf('--backend');
  const dirIdx = argv.indexOf('--dir');
  const dir = dirIdx !== -1 ? path.resolve(argv[dirIdx + 1] || '') : null;
  let backend =
    backendIdx !== -1
      ? String(argv[backendIdx + 1] || '').toLowerCase()
      : 'auto';
  if (dir && backend === 'auto') backend = 'file';
  return { dryRun, backend, dir, includeVersions };
}

async function main() {
  const { dryRun, backend, dir, includeVersions } = parseArgs(
    process.argv.slice(2),
  );
  if (!['auto', 'file', 'postgres', 'both'].includes(backend)) {
    console.error(
      `Unknown --backend "${backend}" (use auto, file, postgres or both).`,
    );
    process.exit(1);
  }

  await loadDotEnv(REPO_ROOT);
  const resolved =
    backend === 'auto' ? (isPostgresMode() ? 'postgres' : 'file') : backend;
  const prefix = dryRun ? '[DRY RUN] ' : '';
  console.log(
    `${prefix}Folding legacy backgrounds (bgImage → slideBgImage) ` +
      `(backend: ${resolved}, version history: ` +
      `${includeVersions ? 'included' : 'skipped'})\n`,
  );

  if (resolved === 'file' || resolved === 'both') {
    const root = dir || dataDir(REPO_ROOT);
    const stats = await migrateFileStore(root, { dryRun, includeVersions });
    console.log(`File store: ${stats.root}`);
    console.log(`  JSON files scanned:   ${stats.filesScanned}`);
    console.log(`  Files modified:       ${stats.filesModified}`);
    console.log(`  Slides migrated:      ${stats.slidesMigrated}`);
    for (const file of stats.files) console.log(`    • ${file}`);
    console.log('');
  }

  if (resolved === 'postgres' || resolved === 'both') {
    if (!isPostgresMode()) {
      console.error(
        'STORAGE_MODE is not "postgres", so there is no database to migrate.\n' +
          'Run this on the Postgres install (or point --dir at a file-store export).',
      );
      process.exit(1);
    }
    const { initializeDatabase, closeDatabase } =
      await import('../server/db/client.js');
    const db = await initializeDatabase();
    try {
      const results = await migratePostgres(db, { dryRun, includeVersions });
      console.log('Postgres:');
      for (const r of results) {
        if (!r.present) {
          console.log(`  ${r.table.padEnd(24)} (table absent — skipped)`);
          continue;
        }
        console.log(
          `  ${r.table.padEnd(24)} rows scanned ${String(r.rowsScanned).padStart(5)}` +
            `   rows modified ${String(r.rowsModified).padStart(4)}` +
            `   slides migrated ${String(r.hits).padStart(4)}`,
        );
      }
      console.log('');
    } finally {
      await closeDatabase();
    }
  }

  if (dryRun) {
    console.log(
      '[DRY RUN] Nothing was written. Re-run without --dry-run to apply.',
    );
  } else {
    console.log('Done.');
  }
}

// Only run as a CLI; importing the module (tests) must not touch any store.
if (isCli(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
