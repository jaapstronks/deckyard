/**
 * Tags storage facade.
 * Uses storage adapter when initialized.
 */

import { isStorageInitialized, getStorage } from './adapters/index.js';
import { getDefaultOrganizationId } from '../config/database.js';

/**
 * Get the context for storage operations.
 * @param {Object} opts - Options with optional actorEmail
 * @returns {Object} Context with organizationId
 */
function getStorageContext(opts = {}) {
  return {
    organizationId: getDefaultOrganizationId(),
    actorEmail: opts.actorEmail || null,
  };
}

/**
 * List all tags for the organization.
 * @returns {Promise<Array<{id: string, name: string, count: number}>>}
 */
export async function listTags() {
  if (!isStorageInitialized()) {
    return [];
  }
  const storage = getStorage();
  const ctx = getStorageContext();
  return await storage.listTags(ctx);
}

/**
 * Get tags for a specific presentation.
 * @param {string} presentationId - Presentation ID
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function getTagsForPresentation(presentationId) {
  if (!isStorageInitialized()) {
    return [];
  }
  const storage = getStorage();
  const ctx = getStorageContext();
  return await storage.getTagsForPresentation(presentationId, ctx);
}

/**
 * Get tags for multiple presentations at once (for list views).
 * @param {string[]} presentationIds - Array of presentation IDs
 * @returns {Promise<Map<string, Array<{id: string, name: string}>>>}
 */
export async function getTagsForPresentations(presentationIds) {
  if (!isStorageInitialized()) {
    return new Map();
  }
  const storage = getStorage();
  const ctx = getStorageContext();
  return await storage.getTagsForPresentations(presentationIds, ctx);
}

/**
 * Set tags for a presentation (replaces existing tags).
 * @param {string} presentationId - Presentation ID
 * @param {string[]} tagNames - Array of tag names
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function setTagsForPresentation(presentationId, tagNames) {
  if (!isStorageInitialized()) {
    return [];
  }
  const storage = getStorage();
  const ctx = getStorageContext();
  return await storage.setTagsForPresentation(presentationId, tagNames, ctx);
}

/**
 * Create a new tag.
 * @param {string} name - Tag name
 * @returns {Promise<{id: string, name: string}>}
 */
export async function createTag(name) {
  if (!isStorageInitialized()) {
    const err = new Error('Storage not initialized');
    err.statusCode = 500;
    throw err;
  }
  const storage = getStorage();
  const ctx = getStorageContext();
  return await storage.createTag(name, ctx);
}

/**
 * Delete a tag.
 * @param {string} tagId - Tag ID
 * @returns {Promise<boolean>}
 */
export async function deleteTag(tagId) {
  if (!isStorageInitialized()) {
    return false;
  }
  const storage = getStorage();
  const ctx = getStorageContext();
  return await storage.deleteTag(tagId, ctx);
}

/**
 * Search tags by prefix (for autocomplete).
 * @param {string} prefix - Search prefix
 * @param {number} [limit=10] - Max results
 * @returns {Promise<Array<{id: string, name: string, count: number}>>}
 */
export async function searchTags(prefix, limit = 10) {
  if (!isStorageInitialized()) {
    return [];
  }
  const storage = getStorage();
  const ctx = getStorageContext();
  return await storage.searchTags(prefix, ctx, limit);
}