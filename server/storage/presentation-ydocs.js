/**
 * Collab Y.Doc state facade.
 *
 * Every function takes a **storage scope** rather than a bare `repoRoot`: the
 * organization comes from the caller, never from a default (see
 * server/storage/scope.js). A Y.Doc binary belongs to one deck in one
 * organization, so a write that guessed the organization would park collab
 * state on the wrong organization's deck.
 */

import { getStorage } from './adapters/index.js';
import { toStorageContext } from './scope.js';

/**
 * Read the stored Y.Doc state (one merged yjs update) for a presentation.
 * @param {import('./scope.js').StorageScope} storageScope
 * @param {string} id - Presentation ID
 * @returns {Promise<Uint8Array|null>}
 */
export async function getYDocState(storageScope, id) {
  const ctx = toStorageContext(storageScope, 'getYDocState');
  const storage = getStorage();
  return storage.getYDocState(id, ctx);
}

/**
 * Store the Y.Doc state for a presentation.
 * @param {import('./scope.js').StorageScope} storageScope
 * @param {string} id - Presentation ID
 * @param {Uint8Array} state - Merged yjs update
 * @returns {Promise<boolean>}
 */
export async function setYDocState(storageScope, id, state) {
  const ctx = toStorageContext(storageScope, 'setYDocState');
  const storage = getStorage();
  return storage.setYDocState(id, state, ctx);
}

/**
 * Delete the stored Y.Doc state for a presentation.
 * @param {import('./scope.js').StorageScope} storageScope
 * @param {string} id - Presentation ID
 * @returns {Promise<boolean>}
 */
export async function deleteYDocState(storageScope, id) {
  const ctx = toStorageContext(storageScope, 'deleteYDocState');
  const storage = getStorage();
  return storage.deleteYDocState(id, ctx);
}
