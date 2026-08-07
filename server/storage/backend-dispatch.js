/**
 * Shared storageScope-to-context reduction for the storage facades.
 *
 * Every facade under `server/storage/` reduces its caller's storageScope to the
 * context the storage adapter takes before touching storage. This module is
 * the single home for that reduction; the DB-vs-file dispatch that used to
 * live next to it went with the file backend's removal, so the facades now
 * call the adapter (`getStorage()`) directly.
 *
 * @module server/storage/backend-dispatch
 */

import { resolveScope } from './scope.js';

/**
 * Reduce a caller's storageScope to the context the storage adapters take.
 *
 * The organization is never invented — it comes from the storageScope or the call
 * throws (see {@link module:server/storage/scope.resolveScope}). Only the actor
 * may be sharpened per call: a personal-collection op names its `userEmail`, a
 * create attributes to `ownerEmail`, a write to `actorEmail`. At most one of
 * those is ever set on a given call, so the precedence below is a pick, not a
 * priority fight.
 *
 * @param {import('./scope.js').StorageScope} storageScope - The caller's storageScope.
 * @param {string} operation - Facade function name, for the error message.
 * @param {{actorEmail?: string, userEmail?: string, ownerEmail?: string}} [opts]
 *   A sharper actor for this call.
 * @param {{allowCrossOrganization?: boolean}} [resolveOpts] - Passed through to
 *   resolveScope; set `allowCrossOrganization` for a read addressed by a public
 *   token.
 * @returns {Object} Context for the storage adapter.
 */
export function toStorageContext(storageScope, operation, opts = {}, resolveOpts) {
  const resolved = resolveScope(storageScope, operation, resolveOpts);
  return {
    ...resolved,
    actorEmail:
      opts.actorEmail || opts.userEmail || opts.ownerEmail || resolved.actorEmail,
  };
}
