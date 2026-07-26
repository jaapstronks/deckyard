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
import { singleWorkspaceScope } from '../../scope.js';
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
 *
 * Unpublishing goes through the published facade, which is organization-scoped,
 * so the organization has to travel here in `opts`. It matters: this cleanup sits
 * inside a catch-all, so a scope error would be swallowed and the deck's public
 * link would survive its deck. When the caller states nothing, the single
 * workspace is the answer — and refuses to guess on an instance with several.
 *
 * @param {string} repoRoot - Repository root path
 * @param {string} id - Presentation ID
 * @param {Object} [opts]
 * @param {string} [opts.organizationId] - The organization this delete acts in.
 * @returns {Promise<boolean>} True if deleted
 */
export async function permanentlyDeletePresentation(repoRoot, id, opts = {}) {
  // Permanently delete: clean up related artifacts and delete the file
  try {
    const existing = await readPresentation(repoRoot, id);
    if (existing && typeof existing === 'object') {
      const publishId = String(existing?.published?.id || '').trim();
      if (publishId) {
        const scope =
          typeof opts?.organizationId === 'string' && opts.organizationId
            ? { repoRoot, organizationId: opts.organizationId }
            : singleWorkspaceScope(repoRoot, 'permanently deleting a presentation');
        await removePublishedEntry(scope, publishId);
      }
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
