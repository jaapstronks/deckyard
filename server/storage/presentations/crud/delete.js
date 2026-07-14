/**
 * CRUD delete operations - soft delete, restore, and permanent delete.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  deletePresentationFile,
  readPresentation,
  writePresentation,
} from '../io.js';
import { removePublishedEntry } from '../../published.js';
import { dataDir } from '../../../config/storage-paths.js';
import { normalizeEmail, nowIso } from '../../../utils/normalize.js';
import { getPresentation } from './read.js';
import { normalizeMeta } from './helpers.js';

/**
 * Soft delete a presentation (set trashedAt).
 * @param {string} repoRoot - Repository root path
 * @param {string} id - Presentation ID
 * @param {Object} opts - Options
 * @param {string} [opts.actorEmail] - Email of the user trashing the presentation
 * @param {string} [opts.message] - Optional message for collaborators
 * @returns {Promise<boolean>} True if deleted, false if already trashed or not found
 */
export async function deletePresentation(repoRoot, id, opts = {}) {
  // Soft delete: set trashedAt and trashedBy instead of deleting the file
  const existing = await getPresentation(repoRoot, id);
  if (!existing) return false;

  // If already trashed, do nothing
  if (existing.trashedAt) return false;

  const now = nowIso();
  const updated = {
    ...existing,
    trashedAt: now,
    trashedBy: normalizeEmail(opts?.actorEmail) || null,
    trashMessage: opts?.message || null,
  };

  await writePresentation(repoRoot, updated);
  return true;
}

/**
 * Restore a trashed presentation.
 * @param {string} repoRoot - Repository root path
 * @param {string} id - Presentation ID
 * @returns {Promise<Object|null>} Restored presentation or null
 */
export async function restorePresentation(repoRoot, id) {
  const existing = await readPresentation(repoRoot, id);
  if (!existing) return null;

  // If not trashed, cannot restore
  if (!existing.trashedAt) return null;

  const updated = {
    ...existing,
    trashedAt: null,
    trashedBy: null,
  };

  await writePresentation(repoRoot, updated);
  return normalizeMeta(updated);
}

/**
 * Permanently delete a presentation and all related artifacts.
 * @param {string} repoRoot - Repository root path
 * @param {string} id - Presentation ID
 * @returns {Promise<boolean>} True if deleted
 */
export async function permanentlyDeletePresentation(repoRoot, id) {
  // Permanently delete: clean up related artifacts and delete the file
  try {
    const existing = await readPresentation(repoRoot, id);
    if (existing && typeof existing === 'object') {
      const publishId = String(existing?.published?.id || '').trim();
      if (publishId) await removePublishedEntry(repoRoot, publishId);
      const versionsDir = path.join(
        dataDir(repoRoot),
        'presentation-versions',
        String(existing?.id || id || '')
      );
      await fs.rm(versionsDir, { recursive: true, force: true });
    }
  } catch {
    // ignore
  }
  return await deletePresentationFile(repoRoot, id);
}
