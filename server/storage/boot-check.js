/**
 * Boot-time storage sanity check.
 *
 * Postgres is the default storage backend, so an install that used to run on
 * file storage and simply pulls a newer Deckyard would otherwise come up
 * against an empty database while its decks sit untouched on disk — an empty
 * organization that looks exactly like data loss. This check turns that into a
 * loud stop with the two commands that resolve it. Nothing is read, written or
 * deleted in the data directory; the file data stays exactly where it is.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from '../config/storage-paths.js';
import { getDb, isDatabaseAvailable } from '../db/client.js';

/**
 * Number of deck JSON files in the file-storage data directory.
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
 * Refuse to boot Postgres mode on an empty database while file-storage decks
 * are still on disk.
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
    `file-storage data directory is not empty:\n` +
    `  ${dir} - ${fileCount} deck${fileCount === 1 ? '' : 's'}\n` +
    `Starting now would show an empty organization next to your data, so Deckyard stops here.\n` +
    `Your files have not been touched. Import them into Postgres (idempotent, safe to repeat):\n` +
    `    npm run db:migrate && npm run db:import\n` +
    `  Inside docker compose: docker compose exec app npm run db:import\n` +
    `The file backend itself was removed in 1.x, so STORAGE_MODE=file is no longer a way out.`
  );
}
