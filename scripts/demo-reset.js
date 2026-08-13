import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from '../server/config/paths.js';

/**
 * Reset the on-disk state of a demo instance.
 *
 * WARNING: deletes files under server/data + server/uploads. Only run this on
 * the demo deployment.
 *
 * Deck, session and settings data live in Postgres, so this script only
 * touches what a demo instance actually accumulates on disk: the thumbnail
 * cache and uploads. Resetting the database itself is a separate operation.
 * Pre-DB file-store fossils on an upgrading install are handled by
 * `scripts/prune-legacy-data.js` (fixed allowlist + dry run), not here.
 */

async function rmIfExists(p) {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {}
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function resetDemoData() {
  const dataRoot = path.join(repoRoot, 'server', 'data');
  const uploadsRoot = path.join(repoRoot, 'server', 'uploads');

  // Thumbnail cache (server/render/deck-thumbnail.js).
  await rmIfExists(path.join(dataRoot, 'deck-thumbs'));

  // Uploads (a demo should typically disable uploads anyway).
  await rmIfExists(uploadsRoot);
  await ensureDir(uploadsRoot);
}

await resetDemoData();
// eslint-disable-next-line no-console
console.log('Demo reset complete (disk state; database state is not touched).');
