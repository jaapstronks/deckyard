#!/usr/bin/env node

/**
 * Rename migration: `lijstje-slide` → `list-slide`.
 *
 * `lijstje-slide` was never a second type — since the drift fix it is literally
 * `{ ...listSlide, ai: false }`, so the two share one field schema. That makes
 * this a **lossless rename**: only `type` is rewritten, `content` is left byte
 * for byte alone. No conversion, no field mapping, nothing to lose. It is the
 * migration step 3 of the list consolidation asks for (the rename ladder is
 * documented in `docs/reference/slide-type-removal.md`),
 * and running it is what lets rung 2 of the deprecation ladder be signed off.
 *
 * ## What this script is for now (B223)
 *
 * The rename is declared with `losslessRename: true` in
 * `shared/slide-types/removed.js` and applied by `migratePresentation()`, so a
 * *running* install renames the type on every read, write and import without
 * anyone running anything. Nothing here has to be remembered any more.
 *
 * What is left is the one job the funnel cannot do: rewriting JSON **at rest**,
 * outside a running install — an export dump, a data directory staged for
 * import, a backup being inspected. That is `--dir <path>`, and it is why this
 * file stays. The `--backend postgres` half is likewise a *backfill*: it writes
 * the columns in one pass instead of leaving each deck to be renamed on read
 * until its next save. Neither is load-bearing for correctness.
 *
 * A future lossless rename does **not** need a script like this one. Declare it
 * on the removal record and add the funnel step; see step 0 of
 * `docs/reference/slide-type-removal.md`.
 *
 * ## Both stores, on purpose
 *
 * `scripts/migrate-slides.js` is file-only. slides.ciiic.nl runs on Postgres, so
 * a file-only script would migrate nothing where it matters. This one covers
 * both backends and picks by `STORAGE_MODE` unless told otherwise, and
 * `migrate-legacy-bg-image.js` now does the same through the shared
 * `scripts/lib/pg-json-rewrite.js`.
 *
 * Surfaces that hold a slide's `type` (the Postgres list matches what
 * `server/db/migrations/030_migrate_agenda_timeline_to_timeline.js` touched,
 * plus the two that did not exist yet then):
 *
 * | file store                        | Postgres                                |
 * |-----------------------------------|-----------------------------------------|
 * | `presentations/*.json`            | `presentations.slides` + `.i18n`        |
 * | `presentation-versions/**\/*.json` | `presentation_versions.presentation_data` |
 * | `slide-library/**\/*.json`         | `slide_library.slide_type` (+ jsonb)    |
 * | —                                 | `presentation_comments.slide_snapshot`  |
 *
 * Version snapshots and comment snapshots are migrated too, not skipped as
 * "history": a restored version would reintroduce the old name, and a comment
 * snapshot is rendered like any other slide. A rename is lossless, so there is
 * nothing to weigh against doing it everywhere.
 *
 * ## How the rewrite is done
 *
 * A single pure walk over parsed JSON (`renameSlideTypeDeep`), rewriting exactly
 * two keys — `type` and `slideType` — when their value is the old name. Not a
 * per-shape transformer: decks, i18n language versions, version snapshots and
 * library items all nest slides differently, and a walk that only recognizes the
 * *key* is correct for all of them and for shapes added later. Idempotent by
 * construction — a second run finds nothing, because the old name is gone.
 *
 * Usage:
 *   node scripts/migrate-lijstje-slide.js --dry-run
 *   node scripts/migrate-lijstje-slide.js
 *   node scripts/migrate-lijstje-slide.js --backend file --dir path/to/export
 *
 * Options:
 *   --dry-run            Report what would change; write nothing.
 *   --backend <mode>     `auto` (default, follows STORAGE_MODE), `file`,
 *                        `postgres`, or `both`.
 *   --dir <path>         File-store root to walk (default: the configured data
 *                        dir). Implies `--backend file`; use it to migrate an
 *                        export before running `scripts/scan-slide-type.js`.
 *
 * Exit code: 0 on success, 1 on failure.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  readExistingColumns,
  rewriteJsonColumns,
} from './lib/pg-json-rewrite.js';
import { loadDotEnv } from '../server/config/env.js';
import { isPostgresMode } from '../server/config/database.js';
import { dataDir } from '../server/config/storage-paths.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

export const OLD_TYPE = 'lijstje-slide';
export const NEW_TYPE = 'list-slide';

/** The two keys that ever carry a slide-type id in stored JSON. */
const TYPE_KEYS = ['type', 'slideType'];

/**
 * Rewrite every stored occurrence of the old slide-type id in a parsed JSON
 * value, returning a new value plus how many occurrences were rewritten.
 *
 * Pure and non-mutating: the input is left untouched, so a dry run can count
 * without any risk of a half-applied write. Returns the original value by
 * identity when nothing matched, which is what the callers use to decide
 * whether a row or file needs writing at all.
 *
 * @param {*} value - Any parsed JSON value.
 * @returns {{value: *, count: number}} The rewritten value and the hit count.
 */
export function renameSlideTypeDeep(value) {
  if (Array.isArray(value)) {
    let count = 0;
    const out = value.map((entry) => {
      const res = renameSlideTypeDeep(entry);
      count += res.count;
      return res.value;
    });
    return count ? { value: out, count } : { value, count: 0 };
  }

  if (!value || typeof value !== 'object') return { value, count: 0 };

  let count = 0;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (TYPE_KEYS.includes(key) && entry === OLD_TYPE) {
      out[key] = NEW_TYPE;
      count += 1;
      continue;
    }
    const res = renameSlideTypeDeep(entry);
    count += res.count;
    out[key] = res.value;
  }
  return count ? { value: out, count } : { value, count: 0 };
}

/* ------------------------------------------------------------------ *
 * File store
 * ------------------------------------------------------------------ */

/**
 * Walk a directory tree and rewrite every `.json` file that mentions the old
 * type.
 *
 * The whole tree is walked rather than the three known subdirectories, so the
 * same code path serves both the live data dir and an arbitrary export dump
 * passed with `--dir`. Files that do not mention the old type are never
 * rewritten, so formatting elsewhere is left alone; the original trailing
 * newline (or its absence) is preserved on the ones that are.
 *
 * @param {string} root - Directory to walk.
 * @param {{dryRun?: boolean}} [opts]
 * @returns {Promise<{root: string, filesScanned: number, filesModified: number, slidesRenamed: number, files: string[]}>}
 */
export async function migrateFileStore(root, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const stats = {
    root,
    filesScanned: 0,
    filesModified: 0,
    slidesRenamed: 0,
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

    // Cheap pre-filter: no mention of the name, no walk, no rewrite.
    if (!raw.includes(OLD_TYPE)) return;

    const { value, count } = renameSlideTypeDeep(parsed);
    if (!count) return;

    stats.filesModified += 1;
    stats.slidesRenamed += count;
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
 * The jsonb columns per table that can contain a slide object.
 * `slide_library.slide_type` is a plain varchar and is handled separately.
 */
const PG_JSON_TARGETS = [
  { table: 'presentations', columns: ['slides', 'i18n'] },
  { table: 'presentation_versions', columns: ['presentation_data'] },
  { table: 'slide_library', columns: ['content', 'i18n'] },
  { table: 'presentation_comments', columns: ['slide_snapshot'] },
];

/**
 * Rewrite the old type across every Postgres surface that stores a slide.
 *
 * The batched read-rewrite-write loop is `scripts/lib/pg-json-rewrite.js`,
 * shared with `migrate-legacy-bg-image.js`; what is this migration's own is the
 * target list and the pure rewrite handed to it.
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {{dryRun?: boolean}} [opts]
 * @returns {Promise<Array<{table: string, present: boolean, rowsScanned: number, rowsModified: number, slidesRenamed: number}>>}
 */
export async function migratePostgres(db, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  // A second catalog read next to the helper's own: the scalar column below is
  // not a rewrite target, and threading the set through the shared API to save
  // one information_schema query in a one-time script is not worth the seam.
  const existing = await readExistingColumns(db);
  const results = (
    await rewriteJsonColumns(db, PG_JSON_TARGETS, renameSlideTypeDeep, {
      dryRun,
    })
  ).map(({ hits, ...rest }) => ({ ...rest, slidesRenamed: hits }));

  // slide_library.slide_type is a scalar column, not JSON.
  const libraryResult = {
    table: 'slide_library.slide_type',
    present: existing.has('slide_library.slide_type'),
    rowsScanned: 0,
    rowsModified: 0,
    slidesRenamed: 0,
  };
  results.push(libraryResult);
  if (libraryResult.present) {
    const rows = await db
      .selectFrom('slide_library')
      .select('id')
      .where('slide_type', '=', OLD_TYPE)
      .execute();
    libraryResult.rowsScanned = rows.length;
    libraryResult.rowsModified = rows.length;
    libraryResult.slidesRenamed = rows.length;
    if (rows.length && !dryRun) {
      await db
        .updateTable('slide_library')
        .set({ slide_type: NEW_TYPE })
        .where('slide_type', '=', OLD_TYPE)
        .execute();
    }
  }

  return results;
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

/**
 * @param {string[]} argv - `process.argv.slice(2)`
 * @returns {{dryRun: boolean, backend: string, dir: (string|null)}}
 */
function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const backendIdx = argv.indexOf('--backend');
  const dirIdx = argv.indexOf('--dir');
  const dir = dirIdx !== -1 ? path.resolve(argv[dirIdx + 1] || '') : null;
  let backend =
    backendIdx !== -1
      ? String(argv[backendIdx + 1] || '').toLowerCase()
      : 'auto';
  if (dir && backend === 'auto') backend = 'file';
  return { dryRun, backend, dir };
}

async function main() {
  const { dryRun, backend, dir } = parseArgs(process.argv.slice(2));
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
    `${prefix}Renaming "${OLD_TYPE}" → "${NEW_TYPE}" (backend: ${resolved})\n`,
  );

  if (resolved === 'file' || resolved === 'both') {
    const root = dir || dataDir(REPO_ROOT);
    const stats = await migrateFileStore(root, { dryRun });
    console.log(`File store: ${stats.root}`);
    console.log(`  JSON files scanned:   ${stats.filesScanned}`);
    console.log(`  Files modified:       ${stats.filesModified}`);
    console.log(`  Slides renamed:       ${stats.slidesRenamed}`);
    for (const file of stats.files) console.log(`    • ${file}`);
    console.log('');
  }

  if (resolved === 'postgres' || resolved === 'both') {
    const { initializeDatabase, closeDatabase } =
      await import('../server/db/client.js');
    if (!isPostgresMode()) {
      console.error(
        'STORAGE_MODE is not "postgres", so there is no database to migrate.\n' +
          'Run this on the Postgres install (or point --dir at a file-store export).',
      );
      process.exit(1);
    }
    const db = await initializeDatabase();
    try {
      const results = await migratePostgres(db, { dryRun });
      console.log('Postgres:');
      for (const r of results) {
        if (!r.present) {
          console.log(`  ${r.table.padEnd(28)} (table absent — skipped)`);
          continue;
        }
        console.log(
          `  ${r.table.padEnd(28)} rows scanned ${String(r.rowsScanned).padStart(5)}` +
            `   rows modified ${String(r.rowsModified).padStart(4)}` +
            `   slides renamed ${String(r.slidesRenamed).padStart(4)}`,
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
    console.log(
      `Done. Verify with:  node scripts/scan-slide-type.js ${OLD_TYPE}` +
        (dir ? ` --dir ${dir}` : ''),
    );
  }
}

// Only run as a CLI; importing the module (tests) must not touch any store.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
