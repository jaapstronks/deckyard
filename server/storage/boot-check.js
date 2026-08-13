/**
 * Boot-time migration guard.
 *
 * This is not a storage module: it exists for exactly one scenario — an
 * install that used to keep its decks as disk JSON pulls a newer Deckyard and
 * boots against an empty database while its data sits untouched under
 * `server/data/`. An empty organization next to real data looks exactly like
 * data loss, so the guard turns it into a loud stop with the two commands that
 * resolve it (`db:migrate` + `db:import`). Nothing is read, written or deleted
 * in the data directory. Once `server/data/presentations/` is pruned after a
 * verified import (scripts/prune-legacy-data.js), the trigger disarms itself.
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
    // The storage layer surfaces those on its own.
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
    `Your files have not been touched. Import them into Postgres (idempotent, safe to repeat):\n` +
    `    npm run db:migrate && npm run db:import\n` +
    `  Inside docker compose: docker compose exec app npm run db:import\n` +
    `Disk-JSON storage was removed in 1.x, so STORAGE_MODE=file is no longer a way out.`
  );
}
