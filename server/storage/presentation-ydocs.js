/**
 * Collab Y.Doc state facade.
 * Uses the storage adapter when initialized, falls back to file-based storage
 * (same pattern as presentations.js).
 */

import { isStorageInitialized, getStorage } from './adapters/index.js';
import { getDefaultOrganizationId } from '../config/database.js';

function ctx() {
  return { organizationId: getDefaultOrganizationId() };
}

/**
 * Read the stored Y.Doc state (one merged yjs update) for a presentation.
 * @param {string} repoRoot
 * @param {string} id - Presentation ID
 * @returns {Promise<Uint8Array|null>}
 */
export async function getYDocState(repoRoot, id) {
  if (isStorageInitialized()) {
    return getStorage().getYDocState(id, ctx());
  }
  const mod = await import('./presentations/ydoc-state.js');
  return mod.getYDocState(repoRoot, id);
}

/**
 * Store the Y.Doc state for a presentation.
 * @param {string} repoRoot
 * @param {string} id - Presentation ID
 * @param {Uint8Array} state - Merged yjs update
 * @returns {Promise<boolean>}
 */
export async function setYDocState(repoRoot, id, state) {
  if (isStorageInitialized()) {
    return getStorage().setYDocState(id, state, ctx());
  }
  const mod = await import('./presentations/ydoc-state.js');
  return mod.setYDocState(repoRoot, id, state);
}

/**
 * Delete the stored Y.Doc state for a presentation.
 * @param {string} repoRoot
 * @param {string} id - Presentation ID
 * @returns {Promise<boolean>}
 */
export async function deleteYDocState(repoRoot, id) {
  if (isStorageInitialized()) {
    return getStorage().deleteYDocState(id, ctx());
  }
  const mod = await import('./presentations/ydoc-state.js');
  return mod.deleteYDocState(repoRoot, id);
}
