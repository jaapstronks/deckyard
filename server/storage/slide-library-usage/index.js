/**
 * Per-user slide-library usage storage facade.
 *
 * "Usage" = the current user picked a library slide or collection as a starting
 * point for a deck (compose or insert-into-existing). It powers the Home
 * building-blocks shelf's "new to you" badge: a team item the user has never
 * used is flagged; the flag clears after first use. Records references only.
 *
 * Both functions take a **storage scope** rather than a bare `repoRoot`, so the
 * organization comes from the caller instead of a hardcoded default — see
 * server/storage/scope.js.
 */

import { getStorage } from '../adapters/index.js';
import { toStorageContext } from '../backend-dispatch.js';

/**
 * List the current user's usage records (set of used {itemType, itemId}).
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} userEmail
 * @returns {Promise<{ items: Array<object> }>}
 */
export async function listSlideLibraryUsage(storageScope, userEmail) {
  const email = String(userEmail || '').trim().toLowerCase();
  const ctx = toStorageContext(storageScope, 'listSlideLibraryUsage', { userEmail: email });
  const storage = getStorage();
  const items = await storage.listSlideLibraryUsage(email, ctx);
  return { items: Array.isArray(items) ? items : [] };
}

/**
 * Record usage of one or more library items for a user.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} userEmail
 * @param {Array<{ type: 'slide'|'collection', id: string }>} items
 * @returns {Promise<{ ok: boolean, recorded: number }>}
 */
export async function recordSlideLibraryUsage(storageScope, userEmail, items) {
  const email = String(userEmail || '').trim().toLowerCase();
  if (!email) return { ok: true, recorded: 0 };
  const ctx = toStorageContext(storageScope, 'recordSlideLibraryUsage', { userEmail: email });
  const storage = getStorage();
  const recorded = await storage.recordSlideLibraryUsage(email, items, ctx);
  return { ok: true, recorded: Number(recorded) || 0 };
}
