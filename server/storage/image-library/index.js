/**
 * Image library storage facade.
 *
 * Every function takes a **storage scope** rather than a bare `repoRoot`, so the
 * organization comes from the caller instead of a hardcoded default (see
 * server/storage/scope.js). The image library is per-organization: two
 * workspaces on one instance do not share each other's uploads, and neither do
 * their per-user favorites.
 */

import { getStorage } from '../adapters/index.js';
import { resolveScope } from '../scope.js';
import { toStorageContext } from '../backend-dispatch.js';

/**
 * List the image library of the storageScope's organization.
 * @param {import('../scope.js').StorageScope} storageScope
 * @returns {Promise<Array<Object>>}
 */
export async function listImageLibrary(storageScope) {
  const ctx = toStorageContext(storageScope, 'listImageLibrary');
  const storage = getStorage();
  return storage.listImages(ctx);
}

/**
 * Fetch one image library item within the storageScope's organization.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getImageLibraryItem(storageScope, id) {
  const ctx = toStorageContext(storageScope, 'getImageLibraryItem');
  const storage = getStorage();
  return storage.getImage(id, ctx);
}

/**
 * Add an image to the storageScope's organization library.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {Object} input
 * @returns {Promise<Object>}
 */
export async function createImageLibraryItem(storageScope, input) {
  const ctx = toStorageContext(storageScope, 'createImageLibraryItem');
  const storage = getStorage();
  return storage.createImage(input, ctx);
}

/**
 * Patch an image library item within the storageScope's organization.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} id
 * @param {Object} patch
 * @returns {Promise<Object|null>}
 */
export async function updateImageLibraryItem(storageScope, id, patch) {
  const ctx = toStorageContext(storageScope, 'updateImageLibraryItem');
  const storage = getStorage();
  return storage.updateImage(id, patch, ctx);
}

/**
 * Delete an image library item within the storageScope's organization.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteImageLibraryItem(storageScope, id) {
  const ctx = toStorageContext(storageScope, 'deleteImageLibraryItem');
  const storage = getStorage();
  return storage.deleteImage(id, ctx);
}

/**
 * Get all favorite image IDs for a user.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} userEmail - User's email
 * @returns {Promise<string[]>} Array of image IDs
 */
export async function getImageFavorites(storageScope, userEmail) {
  const ctx = resolveScope(storageScope, 'getImageFavorites');
  const storage = getStorage();
  return storage.getImageFavorites(userEmail, ctx);
}

/**
 * Toggle favorite status for an image.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} imageId - Image ID
 * @param {string} userEmail - User's email
 * @returns {Promise<boolean>} New favorite status (true if now favorited)
 */
export async function toggleImageFavorite(storageScope, imageId, userEmail) {
  const ctx = resolveScope(storageScope, 'toggleImageFavorite');
  const storage = getStorage();
  return storage.toggleImageFavorite(imageId, userEmail, ctx);
}
