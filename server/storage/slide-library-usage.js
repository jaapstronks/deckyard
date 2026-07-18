/**
 * Per-user slide-library usage storage facade.
 * Uses the storage adapter when initialized, falls back to file-based storage.
 *
 * "Usage" = the current user picked a library slide or collection as a starting
 * point for a deck (compose or insert-into-existing). It powers the Home
 * building-blocks shelf's "new to you" badge: a team item the user has never
 * used is flagged; the flag clears after first use. Records references only.
 */

import { isStorageInitialized, getStorage } from './adapters/index.js';
import { getDefaultOrganizationId } from '../config/database.js';

function getStorageContext(opts = {}) {
  return {
    organizationId: getDefaultOrganizationId(),
    actorEmail: opts.actorEmail || opts.userEmail || null,
  };
}

/**
 * Execute pgFn against the storage adapter when initialized, else fileFn.
 * @param {(storage: object) => Promise<any>} pgFn
 * @param {(mod: object) => Promise<any>} fileFn
 * @returns {Promise<any>}
 */
async function withStorageFallback(pgFn, fileFn) {
  if (isStorageInitialized()) {
    return pgFn(getStorage());
  }
  const mod = await import('./slide-library-usage-file.js');
  return fileFn(mod);
}

/**
 * List the current user's usage records (set of used {itemType, itemId}).
 * @param {string} repoRoot
 * @param {string} userEmail
 * @returns {Promise<{ items: Array<object> }>}
 */
export async function listSlideLibraryUsage(repoRoot, userEmail) {
  const email = String(userEmail || '').trim().toLowerCase();
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ userEmail: email });
      const items = await storage.listSlideLibraryUsage(email, ctx);
      return { items: Array.isArray(items) ? items : [] };
    },
    (mod) => mod.listSlideLibraryUsage(repoRoot, email)
  );
}

/**
 * Record usage of one or more library items for a user.
 * @param {string} repoRoot
 * @param {string} userEmail
 * @param {Array<{ type: 'slide'|'collection', id: string }>} items
 * @returns {Promise<{ ok: boolean, recorded: number }>}
 */
export async function recordSlideLibraryUsage(repoRoot, userEmail, items) {
  const email = String(userEmail || '').trim().toLowerCase();
  if (!email) return { ok: true, recorded: 0 };
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ userEmail: email });
      const recorded = await storage.recordSlideLibraryUsage(email, items, ctx);
      return { ok: true, recorded: Number(recorded) || 0 };
    },
    (mod) => mod.recordSlideLibraryUsage(repoRoot, email, items)
  );
}
