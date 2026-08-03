/**
 * Tags storage facade.
 *
 * Tags are per-organization, and these functions used to have no way of hearing
 * which one: they built their own context from a hardcoded default. Every
 * function now takes a **storage scope** as its first argument, so the
 * organization is the caller's answer, not storage's guess — see
 * server/storage/scope.js.
 *
 * These used to degrade to empty results when storage was uninitialized or the
 * backend had no tag support. Neither case exists any more: PostgreSQL is the
 * only backend and it implements every method, so an uninitialized adapter is a
 * boot bug and `getStorage()` says so instead of quietly returning nothing.
 */

import { getStorage } from '../adapters/index.js';
import { resolveScope } from '../scope.js';

/**
 * List all tags of the scope's organization.
 * @param {import('../scope.js').StorageScope} scope
 * @returns {Promise<Array<{id: string, name: string, count: number}>>}
 */
export async function listTags(scope) {
  const ctx = resolveScope(scope, 'listTags');
  const storage = getStorage();
  return await storage.listTags(ctx);
}

/**
 * Get tags for a specific presentation.
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} presentationId - Presentation ID
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function getTagsForPresentation(scope, presentationId) {
  const ctx = resolveScope(scope, 'getTagsForPresentation');
  const storage = getStorage();
  return await storage.getTagsForPresentation(presentationId, ctx);
}

/**
 * Get tags for multiple presentations at once (for list views).
 * @param {import('../scope.js').StorageScope} scope
 * @param {string[]} presentationIds - Array of presentation IDs
 * @returns {Promise<Map<string, Array<{id: string, name: string}>>>}
 */
export async function getTagsForPresentations(scope, presentationIds) {
  const ctx = resolveScope(scope, 'getTagsForPresentations');
  const storage = getStorage();
  return await storage.getTagsForPresentations(presentationIds, ctx);
}

/**
 * Set tags for a presentation (replaces existing tags).
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} presentationId - Presentation ID
 * @param {string[]} tagNames - Array of tag names
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function setTagsForPresentation(scope, presentationId, tagNames) {
  const ctx = resolveScope(scope, 'setTagsForPresentation');
  const storage = getStorage();
  return await storage.setTagsForPresentation(presentationId, tagNames, ctx);
}

/**
 * Create a new tag in the scope's organization.
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} name - Tag name
 * @returns {Promise<{id: string, name: string}>}
 */
export async function createTag(scope, name) {
  const ctx = resolveScope(scope, 'createTag');
  const storage = getStorage();
  return await storage.createTag(name, ctx);
}

/**
 * Delete a tag from the scope's organization.
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} tagId - Tag ID
 * @returns {Promise<boolean>}
 */
export async function deleteTag(scope, tagId) {
  const ctx = resolveScope(scope, 'deleteTag');
  const storage = getStorage();
  return await storage.deleteTag(tagId, ctx);
}

/**
 * Search tags by prefix (for autocomplete).
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} prefix - Search prefix
 * @param {number} [limit=10] - Max results
 * @returns {Promise<Array<{id: string, name: string, count: number}>>}
 */
export async function searchTags(scope, prefix, limit = 10) {
  const ctx = resolveScope(scope, 'searchTags');
  const storage = getStorage();
  return await storage.searchTags(prefix, ctx, limit);
}