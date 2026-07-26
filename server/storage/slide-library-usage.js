/**
 * Per-user slide-library usage storage facade.
 * Uses the storage adapter when initialized, falls back to file-based storage.
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

import { isStorageInitialized, getStorage } from './adapters/index.js';
import { resolveScope, repoRootOf } from './scope.js';

/**
 * Reduce a caller's scope to the context the storage adapters take.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} operation - Facade function name, for the error message.
 * @param {Object} [opts] - Options carrying a sharper actor.
 * @returns {Object} Context for the storage adapter.
 */
function toStorageContext(scope, operation, opts = {}) {
  const resolved = resolveScope(scope, operation);
  return {
    ...resolved,
    actorEmail: opts.actorEmail || opts.userEmail || resolved.actorEmail,
  };
}

/**
 * Execute pgFn against the storage adapter when initialized, else fileFn.
 * @param {import('./scope.js').StorageScope} scope - The caller's scope.
 * @param {string} operation - Facade function name, for the error message.
 * @param {(storage: object) => Promise<any>} pgFn
 * @param {(mod: object) => Promise<any>} fileFn
 * @returns {Promise<any>}
 */
async function withStorageFallback(scope, operation, pgFn, fileFn) {
  // Validate the scope before either backend runs, so a missed call site fails
  // on the file-backed path too rather than slipping past the file-mode suite.
  resolveScope(scope, operation);
  if (isStorageInitialized()) {
    return pgFn(getStorage());
  }
  const mod = await import('./slide-library-usage-file.js');
  return fileFn(mod);
}

/**
 * List the current user's usage records (set of used {itemType, itemId}).
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} userEmail
 * @returns {Promise<{ items: Array<object> }>}
 */
export async function listSlideLibraryUsage(scope, userEmail) {
  const email = String(userEmail || '').trim().toLowerCase();
  return withStorageFallback(
    scope,
    'listSlideLibraryUsage',
    async (storage) => {
      const ctx = toStorageContext(scope, 'listSlideLibraryUsage', { userEmail: email });
      const items = await storage.listSlideLibraryUsage(email, ctx);
      return { items: Array.isArray(items) ? items : [] };
    },
    (mod) => mod.listSlideLibraryUsage(repoRootOf(scope), email)
  );
}

/**
 * Record usage of one or more library items for a user.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} userEmail
 * @param {Array<{ type: 'slide'|'collection', id: string }>} items
 * @returns {Promise<{ ok: boolean, recorded: number }>}
 */
export async function recordSlideLibraryUsage(scope, userEmail, items) {
  const email = String(userEmail || '').trim().toLowerCase();
  if (!email) return { ok: true, recorded: 0 };
  return withStorageFallback(
    scope,
    'recordSlideLibraryUsage',
    async (storage) => {
      const ctx = toStorageContext(scope, 'recordSlideLibraryUsage', { userEmail: email });
      const recorded = await storage.recordSlideLibraryUsage(email, items, ctx);
      return { ok: true, recorded: Number(recorded) || 0 };
    },
    (mod) => mod.recordSlideLibraryUsage(repoRootOf(scope), email, items)
  );
}
