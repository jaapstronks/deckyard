/**
 * Boot-time schema guards: the two ways a reachable database is still not one
 * Deckyard may serve from.
 *
 * Neither is a storage module; both exist because the alternative is an install
 * that *looks* started and is broken.
 *
 * - {@link pendingMigrationsError}: the schema is behind the migrations on disk
 *   (a fresh database that never ran `db:migrate` is the extreme case, with
 *   nothing in it at all). Serving that answers every request with a 500
 *   `relation "…" does not exist`, so boot stops with the one command that
 *   fixes it. The compose path never trips this: its entrypoint migrates first.
 * - {@link strandedFileDataError}: an install that used to keep its decks as
 *   disk JSON pulls a newer Deckyard and boots against an empty database while
 *   its data sits untouched under `server/data/`. An empty organization next to
 *   real data looks exactly like data loss. Nothing is read, written or deleted
 *   in the data directory; once `server/data/presentations/` is moved aside,
 *   the trigger disarms itself. There is no import path any more (B385): the
 *   guard reports the situation, it does not offer to fix it.
 *
 * Order matters in server.js: the schema check runs first, because "is this
 * database empty?" is only a meaningful question once the tables exist.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from '../config/storage-paths.js';
import { getDb, isDatabaseAvailable } from '../db/client.js';

/**
 * Number of deck JSON files in the legacy data directory.
 * @param {string} repoRoot
 * @returns {Promise<number>}
 */
async function countFilePresentations(repoRoot) {
  const dir = path.join(dataDir(repoRoot), 'presentations');
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return 0; // no data directory: nothing to strand
  }
  return entries.filter((f) => f.endsWith('.json')).length;
}

/**
 * Refuse to boot against a database whose schema is behind the migrations on
 * disk.
 *
 * The comparison is the migration runner's own — same file list, same
 * `_migrations` table — so there is one answer to "is this schema current",
 * not a boot-time approximation of it. A missing `_migrations` table means no
 * migration ever ran: every migration is pending.
 *
 * @returns {Promise<string|null>} Error message, or null when the schema is current.
 */
export async function pendingMigrationsError() {
  if (!isDatabaseAvailable()) return null;

  const { listMigrationFiles, listAppliedMigrations } =
    await import('../db/migrate.js');
  const files = await listMigrationFiles();

  /** @type {string[]} */
  let applied;
  try {
    applied = await listAppliedMigrations(getDb());
  } catch {
    // No `_migrations` table (42P01) on a reachable database: nothing has been
    // migrated. Any other read failure lands here too, and answering "migrate"
    // is the right advice for an unreadable ledger as well.
    applied = [];
  }

  const pending = files.filter((f) => !applied.includes(f));
  if (pending.length === 0) return null;

  const scope = applied.length === 0 ? 'has no Deckyard schema' : 'is behind';
  return (
    `The database ${scope}: ${pending.length} of ${files.length} migration${
      files.length === 1 ? '' : 's'
    } ${pending.length === 1 ? 'has' : 'have'} not been applied.\n` +
    `  First pending: ${pending[0]}\n` +
    `Serving now would fail every request with \`relation "…" does not exist\`, so Deckyard stops here.\n` +
    `Apply them (idempotent, safe to repeat):\n` +
    `    npm run db:migrate\n` +
    `  Check what is pending first:  npm run db:migrate:status`
  );
}

/**
 * Whether the presentations table holds any row at all (trashed included: a
 * trashed deck still means this database is the one in use).
 * @returns {Promise<boolean|null>} null when the answer cannot be determined.
 */
async function databaseHasPresentations() {
  if (!isDatabaseAvailable()) return null;
  try {
    // Existence, not a count: one row is enough to know this database is in use.
    const row = await getDb()
      .selectFrom('presentations')
      .select('id')
      .limit(1)
      .executeTakeFirst();
    return Boolean(row);
  } catch {
    // Unmigrated schema or an unreachable database: not this check's business.
    // Both are refused before this one runs — the connection by the boot guard
    // in server.js, the schema by pendingMigrationsError() above.
    return null;
  }
}

/**
 * Refuse to boot Postgres mode on an empty database while legacy disk-JSON
 * decks are still on disk.
 *
 * @param {string} repoRoot - Repository root path.
 * @returns {Promise<string|null>} Error message, or null when the boot is fine.
 */
export async function strandedFileDataError(repoRoot) {
  const hasDbData = await databaseHasPresentations();
  if (hasDbData !== false) return null;

  const fileCount = await countFilePresentations(repoRoot);
  if (fileCount === 0) return null;

  const dir = path.join(dataDir(repoRoot), 'presentations');
  return (
    `Storage mode is "postgres" and the database holds no presentations, but the ` +
    `legacy data directory is not empty:\n` +
    `  ${dir} - ${fileCount} deck${fileCount === 1 ? '' : 's'}\n` +
    `Starting now would show an empty organization next to your data, so Deckyard stops here.\n` +
    `Your files have not been touched, but Deckyard cannot read them: disk-JSON storage was ` +
    `removed in 1.x and the one-time file->Postgres import was retired with it.\n` +
    `Back the directory up and move it aside (or point DATA_DIR elsewhere) to continue.`
  );
}
