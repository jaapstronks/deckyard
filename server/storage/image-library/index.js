/**
 * Image library storage facade.
 * Uses storage adapter when initialized, falls back to file-based storage.
 *
 * Every function takes a **storage scope** rather than a bare `repoRoot`, so the
 * organization comes from the caller instead of a hardcoded default (see
 * server/storage/scope.js). The image library is per-organization: two
 * workspaces on one instance do not share each other's uploads, and neither do
 * their per-user favorites.
 */

import { isStorageInitialized, getStorage } from '../adapters/index.js';
import { resolveScope, repoRootOf } from '../scope.js';
import { createStorageDispatch, toStorageContext } from '../backend-dispatch.js';

const withStorageFallback = createStorageDispatch(() => import('./file.js'));

/**
 * List the image library of the scope's organization.
 * @param {import('../scope.js').StorageScope} scope
 * @returns {Promise<Array<Object>>}
 */
export async function listImageLibrary(scope) {
  const ctx = toStorageContext(scope, 'listImageLibrary');
  return withStorageFallback(
    scope,
    'listImageLibrary',
    (storage) => storage.listImages(ctx),
    (mod) => mod.listImageLibrary(repoRootOf(scope))
  );
}

/**
 * Fetch one image library item within the scope's organization.
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getImageLibraryItem(scope, id) {
  const ctx = toStorageContext(scope, 'getImageLibraryItem');
  return withStorageFallback(
    scope,
    'getImageLibraryItem',
    (storage) => storage.getImage(id, ctx),
    (mod) => mod.getImageLibraryItem(repoRootOf(scope), id)
  );
}

/**
 * Add an image to the scope's organization library.
 * @param {import('../scope.js').StorageScope} scope
 * @param {Object} input
 * @returns {Promise<Object>}
 */
export async function createImageLibraryItem(scope, input) {
  const ctx = toStorageContext(scope, 'createImageLibraryItem');
  return withStorageFallback(
    scope,
    'createImageLibraryItem',
    (storage) => storage.createImage(input, ctx),
    (mod) => mod.createImageLibraryItem(repoRootOf(scope), input)
  );
}

/**
 * Patch an image library item within the scope's organization.
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} id
 * @param {Object} patch
 * @returns {Promise<Object|null>}
 */
export async function updateImageLibraryItem(scope, id, patch) {
  const ctx = toStorageContext(scope, 'updateImageLibraryItem');
  return withStorageFallback(
    scope,
    'updateImageLibraryItem',
    (storage) => storage.updateImage(id, patch, ctx),
    (mod) => mod.updateImageLibraryItem(repoRootOf(scope), id, patch)
  );
}

/**
 * Delete an image library item within the scope's organization.
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteImageLibraryItem(scope, id) {
  const ctx = toStorageContext(scope, 'deleteImageLibraryItem');
  return withStorageFallback(
    scope,
    'deleteImageLibraryItem',
    (storage) => storage.deleteImage(id, ctx),
    (mod) => mod.deleteImageLibraryItem(repoRootOf(scope), id)
  );
}

/**
 * Get all favorite image IDs for a user.
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} userEmail - User's email
 * @returns {Promise<string[]>} Array of image IDs
 */
export async function getImageFavorites(scope, userEmail) {
  const ctx = resolveScope(scope, 'getImageFavorites');
  if (!isStorageInitialized()) return [];
  const storage = getStorage();
  // Favorites are optional per backend (the file backend has no per-user
  // favorites store); treat an absent implementation as "no favorites".
  if (typeof storage.getImageFavorites !== 'function') return [];
  return storage.getImageFavorites(userEmail, ctx);
}

/**
 * Toggle favorite status for an image.
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} imageId - Image ID
 * @param {string} userEmail - User's email
 * @returns {Promise<boolean>} New favorite status (true if now favorited)
 */
export async function toggleImageFavorite(scope, imageId, userEmail) {
  const ctx = resolveScope(scope, 'toggleImageFavorite');
  if (!isStorageInitialized()) return false;
  const storage = getStorage();
  if (typeof storage.toggleImageFavorite !== 'function') return false;
  return storage.toggleImageFavorite(imageId, userEmail, ctx);
}
