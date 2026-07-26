/**
 * Tags storage facade.
 * Uses storage adapter when initialized.
 *
 * Tags are per-organization, and these functions used to have no way of hearing
 * which one: they built their own context from a hardcoded default. Every
 * function now takes a **storage scope** as its first argument, so the
 * organization is the caller's answer, not storage's guess — see
 * server/storage/scope.js. Tags are database-only; without an initialized
 * adapter these degrade to empty results exactly as before.
 */

import { isStorageInitialized, getStorage } from './adapters/index.js';
import { resolveScope } from './scope.js';

/**
 * List all tags of the scope's organization.
 * @param {import('./scope.js').StorageScope} scope
 * @returns {Promise<Array<{id: string, name: string, count: number}>>}
 */
export async function listTags(scope) {
  const ctx = resolveScope(scope, 'listTags');
  if (!isStorageInitialized()) {
    return [];
  }
  const storage = getStorage();
  if (typeof storage.listTags !== 'function') return [];
  return await storage.listTags(ctx);
}

/**
 * Get tags for a specific presentation.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} presentationId - Presentation ID
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function getTagsForPresentation(scope, presentationId) {
  const ctx = resolveScope(scope, 'getTagsForPresentation');
  if (!isStorageInitialized()) {
    return [];
  }
  const storage = getStorage();
  if (typeof storage.getTagsForPresentation !== 'function') return [];
  return await storage.getTagsForPresentation(presentationId, ctx);
}

/**
 * Get tags for multiple presentations at once (for list views).
 * @param {import('./scope.js').StorageScope} scope
 * @param {string[]} presentationIds - Array of presentation IDs
 * @returns {Promise<Map<string, Array<{id: string, name: string}>>>}
 */
export async function getTagsForPresentations(scope, presentationIds) {
  const ctx = resolveScope(scope, 'getTagsForPresentations');
  if (!isStorageInitialized()) {
    return new Map();
  }
  const storage = getStorage();
  if (typeof storage.getTagsForPresentations !== 'function') return new Map();
  return await storage.getTagsForPresentations(presentationIds, ctx);
}

/**
 * Set tags for a presentation (replaces existing tags).
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} presentationId - Presentation ID
 * @param {string[]} tagNames - Array of tag names
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function setTagsForPresentation(scope, presentationId, tagNames) {
  const ctx = resolveScope(scope, 'setTagsForPresentation');
  if (!isStorageInitialized()) {
    return [];
  }
  const storage = getStorage();
  if (typeof storage.setTagsForPresentation !== 'function') return [];
  return await storage.setTagsForPresentation(presentationId, tagNames, ctx);
}

/**
 * Create a new tag in the scope's organization.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} name - Tag name
 * @returns {Promise<{id: string, name: string}>}
 */
export async function createTag(scope, name) {
  const ctx = resolveScope(scope, 'createTag');
  if (!isStorageInitialized()) {
    const err = new Error('Storage not initialized');
    err.statusCode = 500;
    throw err;
  }
  const storage = getStorage();
  if (typeof storage.createTag !== 'function') {
    const err = new Error('Tags are not supported by the active storage backend');
    err.statusCode = 501;
    throw err;
  }
  return await storage.createTag(name, ctx);
}

/**
 * Delete a tag from the scope's organization.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} tagId - Tag ID
 * @returns {Promise<boolean>}
 */
export async function deleteTag(scope, tagId) {
  const ctx = resolveScope(scope, 'deleteTag');
  if (!isStorageInitialized()) {
    return false;
  }
  const storage = getStorage();
  if (typeof storage.deleteTag !== 'function') return false;
  return await storage.deleteTag(tagId, ctx);
}

/**
 * Search tags by prefix (for autocomplete).
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} prefix - Search prefix
 * @param {number} [limit=10] - Max results
 * @returns {Promise<Array<{id: string, name: string, count: number}>>}
 */
export async function searchTags(scope, prefix, limit = 10) {
  const ctx = resolveScope(scope, 'searchTags');
  if (!isStorageInitialized()) {
    return [];
  }
  const storage = getStorage();
  if (typeof storage.searchTags !== 'function') return [];
  return await storage.searchTags(prefix, ctx, limit);
}