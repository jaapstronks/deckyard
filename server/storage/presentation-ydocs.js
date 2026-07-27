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

import { repoRootOf } from './scope.js';
import { createStorageDispatch, toStorageContext } from './backend-dispatch.js';

const withStorageFallback = createStorageDispatch(() => import('./presentations/ydoc-state.js'));

/**
 * Read the stored Y.Doc state (one merged yjs update) for a presentation.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} id - Presentation ID
 * @returns {Promise<Uint8Array|null>}
 */
export async function getYDocState(scope, id) {
  const ctx = toStorageContext(scope, 'getYDocState');
  return withStorageFallback(
    scope,
    'getYDocState',
    (storage) => storage.getYDocState(id, ctx),
    (mod) => mod.getYDocState(repoRootOf(scope), id)
  );
}

/**
 * Store the Y.Doc state for a presentation.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} id - Presentation ID
 * @param {Uint8Array} state - Merged yjs update
 * @returns {Promise<boolean>}
 */
export async function setYDocState(scope, id, state) {
  const ctx = toStorageContext(scope, 'setYDocState');
  return withStorageFallback(
    scope,
    'setYDocState',
    (storage) => storage.setYDocState(id, state, ctx),
    (mod) => mod.setYDocState(repoRootOf(scope), id, state)
  );
}

/**
 * Delete the stored Y.Doc state for a presentation.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} id - Presentation ID
 * @returns {Promise<boolean>}
 */
export async function deleteYDocState(scope, id) {
  const ctx = toStorageContext(scope, 'deleteYDocState');
  return withStorageFallback(
    scope,
    'deleteYDocState',
    (storage) => storage.deleteYDocState(id, ctx),
    (mod) => mod.deleteYDocState(repoRootOf(scope), id)
  );
}
