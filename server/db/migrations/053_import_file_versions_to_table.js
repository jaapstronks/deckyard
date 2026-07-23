/**
 * Migration: import file-based presentation version snapshots into the
 * `presentation_versions` table.
 *
 * Before this change, version snapshots were always written to JSON files on
 * disk (server/data/presentation-versions/<presentationId>/<versionId>.json),
 * even when STORAGE_MODE=postgres. On Postgres that put version history
 * OUTSIDE the database backups: a redeploy without a persistent volume lost
 * every snapshot. Version create/list/get/prune now route through the storage
 * adapter, so new snapshots land in this table. This migration back-fills the
 * ones that were written to disk while the old code path was live.
 *
 * Properties:
 * - Idempotent: a row is inserted only when no row with that version id
 *   exists yet, so re-running imports each snapshot at most once.
 * - Non-destructive: never updates or deletes an existing row.
 * - No-op when the on-disk directory is absent or empty.
 * - Orphan-safe: snapshots whose presentation no longer exists in the
 *   `presentations` table are skipped (the FK would otherwise reject them).
 *
 * The migration runner only ever connects to Postgres, so "not on Postgres"
 * cannot occur here; the directory-absent guard covers file-only installs
 * that never run migrations at all.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { dataDir } from '../../config/storage-paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/db/migrations -> repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Read + parse a version snapshot JSON file. Returns null on any error so a
 * single bad file never aborts the whole import.
 * @param {string} fullPath
 * @returns {Promise<Object|null>}
 */
async function readSnapshot(fullPath) {
  try {
    const raw = await fs.readFile(fullPath, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    return obj;
  } catch {
    return null;
  }
}

export const up = async (db) => {
  const baseDir = path.join(dataDir(REPO_ROOT), 'presentation-versions');

  let presentationEntries;
  try {
    presentationEntries = await fs.readdir(baseDir, { withFileTypes: true });
  } catch {
    // Directory absent -> nothing to import.
    return;
  }

  let imported = 0;
  let skippedExisting = 0;
  let skippedOrphan = 0;

  for (const entry of presentationEntries) {
    if (!entry.isDirectory()) continue;
    const presentationId = entry.name;

    // Resolve the presentation's organization so the inserted row satisfies
    // the FK and lands in the right tenant. A missing presentation means the
    // FK would reject the insert, so skip its snapshots.
    let presRow = null;
    try {
      presRow = await db
        .selectFrom('presentations')
        .select(['organization_id'])
        .where('id', '=', presentationId)
        .executeTakeFirst();
    } catch {
      presRow = null;
    }
    if (!presRow) {
      skippedOrphan += 1;
      continue;
    }

    const dir = path.join(baseDir, presentationId);
    let files = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const snap = await readSnapshot(path.join(dir, file));
      if (!snap) continue;

      const versionId = String(snap.id || '').trim();
      if (!versionId) continue;
      // The snapshot must belong to this presentation directory.
      if (String(snap.presentationId || '') !== presentationId) continue;
      // The presentation payload is required (NOT NULL column).
      if (!snap.presentation || typeof snap.presentation !== 'object') continue;

      // Idempotency: skip if a row with this id already exists.
      let existing = null;
      try {
        existing = await db
          .selectFrom('presentation_versions')
          .select('id')
          .where('id', '=', versionId)
          .executeTakeFirst();
      } catch {
        existing = null;
      }
      if (existing) {
        skippedExisting += 1;
        continue;
      }

      const revision = Number.isFinite(Number(snap.revision))
        ? Number(snap.revision)
        : null;

      await db
        .insertInto('presentation_versions')
        .values({
          id: versionId,
          presentation_id: presentationId,
          organization_id: presRow.organization_id,
          created_by: snap.createdBy || null,
          reason: String(snap.reason || 'snapshot'),
          label: snap.label ? String(snap.label) : null,
          revision,
          title: typeof snap.title === 'string' ? snap.title : '',
          presentation_data: sql`${JSON.stringify(snap.presentation)}::jsonb`,
          // Preserve the original snapshot timestamp when present.
          created_at: snap.created ? new Date(snap.created) : sql`now()`,
        })
        .execute();

      imported += 1;
    }
  }

  console.log(
    `[053] imported ${imported} file-based version snapshot(s) ` +
      `(skipped ${skippedExisting} already present, ${skippedOrphan} orphaned presentation(s))`
  );
};

export const down = async () => {
  // Non-destructive import: there is nothing safe to reverse. Snapshots that
  // were imported are indistinguishable from ones created natively in the
  // table, so a blanket delete would destroy real history. Intentional no-op.
};
