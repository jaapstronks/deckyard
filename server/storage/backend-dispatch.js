/**
 * The one place the storage facades decide *which backend runs*.
 *
 * Every facade under `server/storage/` answers the same question per method:
 * "is the storage adapter initialized (Postgres, or the file adapter behind it)?
 * If so, call it; if not, lazily load the pure-JS file module and call that."
 * That dispatch used to be copy-pasted — a per-file `withStorageFallback` in
 * three facades and an inline `if (isStorageInitialized()) … else await import(…)`
 * in four more. This module is the single home for it.
 *
 * Two exports:
 *
 * - {@link toStorageContext} reduces a caller's scope to the context the storage
 *   adapters take, sharpening the actor when a create/write names a subject.
 * - {@link createStorageDispatch} binds the dispatch to one file module and hands
 *   back a `withStorageFallback(scope, operation, pgFn, fileFn)` that reads
 *   exactly like the per-file helpers it replaces.
 *
 * The dispatch stays lazy — the file module is only imported when the adapter is
 * not initialized — so a Postgres-mode instance never pulls the file subtree into
 * its module graph. The three genuine cycle-breakers in `presentations.js`
 * (`present-sessions/sse.js`, `../collab/live-apply.js`, and the
 * `presentation-cache.js` ↔ facade pair) are a different smell and deliberately
 * keep their own dynamic `import()`; they do not go through here.
 *
 * @module server/storage/backend-dispatch
 */

import { isStorageInitialized, getStorage } from './adapters/index.js';
import { resolveScope } from './scope.js';

/**
 * Reduce a caller's scope to the context the storage adapters take.
 *
 * The organization is never invented — it comes from the scope or the call
 * throws (see {@link module:server/storage/scope.resolveScope}). Only the actor
 * may be sharpened per call: a personal-collection op names its `userEmail`, a
 * create attributes to `ownerEmail`, a write to `actorEmail`. At most one of
 * those is ever set on a given call, so the precedence below is a pick, not a
 * priority fight.
 *
 * @param {import('./scope.js').StorageScope} scope - The caller's scope.
 * @param {string} operation - Facade function name, for the error message.
 * @param {{actorEmail?: string, userEmail?: string, ownerEmail?: string}} [opts]
 *   A sharper actor for this call.
 * @param {{allowCrossOrganization?: boolean}} [resolveOpts] - Passed through to
 *   resolveScope; set `allowCrossOrganization` for a read addressed by a public
 *   token.
 * @returns {Object} Context for the storage adapter.
 */
export function toStorageContext(scope, operation, opts = {}, resolveOpts) {
  const resolved = resolveScope(scope, operation, resolveOpts);
  return {
    ...resolved,
    actorEmail:
      opts.actorEmail || opts.userEmail || opts.ownerEmail || resolved.actorEmail,
  };
}

/**
 * Bind the DB-vs-file dispatch to one file module.
 *
 * @param {() => Promise<object>} loadFileModule - A thunk that lazily imports the
 *   facade's file-backend module, e.g. `() => import('./collections-file.js')`.
 *   Kept as a thunk so the module is only loaded on the file-backed path.
 * @returns {(
 *   scope: import('./scope.js').StorageScope,
 *   operation: string,
 *   pgFn: (storage: object) => Promise<any>,
 *   fileFn: (mod: object) => Promise<any>,
 *   resolveOpts?: {allowCrossOrganization?: boolean}
 * ) => Promise<any>} A `withStorageFallback` bound to that module.
 */
export function createStorageDispatch(loadFileModule) {
  /**
   * Execute pgFn against the storage adapter when initialized, else fileFn
   * against the lazily-loaded file module.
   *
   * The scope is validated *before* either backend runs, so a missed call site
   * fails on the file-backed path too rather than slipping past the file-mode
   * test suite. `resolveOpts` reaches this validation and — via the caller's own
   * {@link toStorageContext} — the adapter context, so both agree on whether a
   * cross-organization read is allowed.
   */
  return async function withStorageFallback(scope, operation, pgFn, fileFn, resolveOpts) {
    resolveScope(scope, operation, resolveOpts);
    if (isStorageInitialized()) {
      return pgFn(getStorage());
    }
    const mod = await loadFileModule();
    return fileFn(mod);
  };
}
