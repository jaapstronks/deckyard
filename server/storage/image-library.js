/**
 * Image library storage facade.
 * Uses storage adapter when initialized, falls back to file-based storage.
 */

import { isStorageInitialized, getStorage } from './adapters/index.js';
import { getDefaultOrganizationId } from '../config/database.js';

/**
 * Get the context for storage operations.
 * @returns {Object} Context with organizationId
 */
function getStorageContext() {
  return {
    organizationId: getDefaultOrganizationId(),
  };
}

export async function listImageLibrary(repoRoot) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
    return storage.listImages(ctx);
  }
  // Fall back to file-based storage
  const mod = await import('./image-library-file.js');
  return mod.listImageLibrary(repoRoot);
}

export async function getImageLibraryItem(repoRoot, id) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
    return storage.getImage(id, ctx);
  }
  const mod = await import('./image-library-file.js');
  return mod.getImageLibraryItem(repoRoot, id);
}

export async function createImageLibraryItem(repoRoot, input) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
    return storage.createImage(input, ctx);
  }
  const mod = await import('./image-library-file.js');
  return mod.createImageLibraryItem(repoRoot, input);
}

export async function updateImageLibraryItem(repoRoot, id, patch) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
    return storage.updateImage(id, patch, ctx);
  }
  const mod = await import('./image-library-file.js');
  return mod.updateImageLibraryItem(repoRoot, id, patch);
}

export async function deleteImageLibraryItem(repoRoot, id) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
    return storage.deleteImage(id, ctx);
  }
  const mod = await import('./image-library-file.js');
  return mod.deleteImageLibraryItem(repoRoot, id);
}

/**
 * Get all favorite image IDs for a user.
 * @param {string} userEmail - User's email
 * @returns {Promise<string[]>} Array of image IDs
 */
export async function getImageFavorites(userEmail) {
  if (!isStorageInitialized()) return [];
  const storage = getStorage();
  const ctx = getStorageContext();
  // Favorites are optional per backend (the file backend has no per-user
  // favorites store); treat an absent implementation as "no favorites".
  if (typeof storage.getImageFavorites !== 'function') return [];
  return storage.getImageFavorites(userEmail, ctx);
}

/**
 * Toggle favorite status for an image.
 * @param {string} imageId - Image ID
 * @param {string} userEmail - User's email
 * @returns {Promise<boolean>} New favorite status (true if now favorited)
 */
export async function toggleImageFavorite(imageId, userEmail) {
  if (!isStorageInitialized()) return false;
  const storage = getStorage();
  const ctx = getStorageContext();
  if (typeof storage.toggleImageFavorite !== 'function') return false;
  return storage.toggleImageFavorite(imageId, userEmail, ctx);
}