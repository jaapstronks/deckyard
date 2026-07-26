/**
 * Collab Y.Doc state facade.
 * Uses the storage adapter when initialized, falls back to file-based storage
 * (same pattern as presentations.js).
 *
 * Every function takes a **storage scope** rather than a bare `repoRoot`: the
 * organization comes from the caller, never from a default (see
 * server/storage/scope.js). A Y.Doc binary belongs to one deck in one
 * organization, so a write that guessed the organization would park collab
 * state on the wrong workspace's deck.
 */

import { isStorageInitialized, getStorage } from './adapters/index.js';
import { resolveScope, repoRootOf } from './scope.js';

/**
 * Read the stored Y.Doc state (one merged yjs update) for a presentation.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} id - Presentation ID
 * @returns {Promise<Uint8Array|null>}
 */
export async function getYDocState(scope, id) {
  const ctx = resolveScope(scope, 'getYDocState');
  if (isStorageInitialized()) {
    return getStorage().getYDocState(id, ctx);
  }
  const mod = await import('./presentations/ydoc-state.js');
  return mod.getYDocState(repoRootOf(scope), id);
}

/**
 * Store the Y.Doc state for a presentation.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} id - Presentation ID
 * @param {Uint8Array} state - Merged yjs update
 * @returns {Promise<boolean>}
 */
export async function setYDocState(scope, id, state) {
  const ctx = resolveScope(scope, 'setYDocState');
  if (isStorageInitialized()) {
    return getStorage().setYDocState(id, state, ctx);
  }
  const mod = await import('./presentations/ydoc-state.js');
  return mod.setYDocState(repoRootOf(scope), id, state);
}

/**
 * Delete the stored Y.Doc state for a presentation.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} id - Presentation ID
 * @returns {Promise<boolean>}
 */
export async function deleteYDocState(scope, id) {
  const ctx = resolveScope(scope, 'deleteYDocState');
  if (isStorageInitialized()) {
    return getStorage().deleteYDocState(id, ctx);
  }
  const mod = await import('./presentations/ydoc-state.js');
  return mod.deleteYDocState(repoRootOf(scope), id);
}
