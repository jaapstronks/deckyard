/**
 * Presentations storage facade.
 * Uses storage adapter when initialized, falls back to file-based storage.
 *
 * Every function here takes a **storage scope** as its first argument rather
 * than a bare `repoRoot` string: which organization the operation acts in, on
 * whose behalf, and (for the file-backed fallback) where the repository lives.
 * The facade used to answer the organization question itself, with a hardcoded
 * `getDefaultOrganizationId()`, which is why a session working in organization
 * B would still read decks out of organization A. It no longer has a default to
 * fall back to — see server/storage/scope.js for the contract and for the one
 * legitimate way to say "this operation is not organization-scoped".
 */

import { isStorageInitialized, getStorage } from './adapters/index.js';
import { resolveScope, repoRootOf } from './scope.js';
import { isCollabLiveEditsEnabled } from '../config/features.js';
import { deleteYDocState } from './presentation-ydocs.js';
import { normalizeSlides } from './presentations/slides.js';
import { normalizeI18n } from './presentations/i18n.js';
import { recordSlideLevelMerge } from '../services/activity-events.js';
import { validatePresentationSize } from '../utils/presentation-limits.js';
import { invalidatePresentationCache } from './presentation-cache.js';
import { migratePresentation } from '../../shared/slide-types/schema-version.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('presentations');

/**
 * Reduce a caller's scope to the context the storage adapters take.
 *
 * `actorEmail` may be sharpened per call (a create attributes to `ownerEmail`,
 * a write to `opts.actorEmail`) but the organization never is: it comes from
 * the scope or the call throws.
 *
 * @param {import('./scope.js').StorageScope} scope - The caller's scope.
 * @param {string} operation - Facade function name, for the error message.
 * @param {Object} [opts] - Options carrying a sharper actor.
 * @returns {Object} Context for the storage adapter.
 */
function toStorageContext(scope, operation, opts = {}) {
  const resolved = resolveScope(scope, operation, {
    // Only the single-deck read may skip the organization filter, and only for
    // a deck a public token already addressed. Everything else — listings and
    // every write — must state its organization.
    allowCrossOrganization: operation === 'getPresentation',
  });
  return {
    ...resolved,
    actorEmail: opts.actorEmail || opts.ownerEmail || resolved.actorEmail,
  };
}

/**
 * List the presentations of the scope's organization.
 * @param {import('./scope.js').StorageScope} scope
 * @returns {Promise<Array>}
 */
export async function listPresentations(scope) {
  const ctx = toStorageContext(scope, 'listPresentations');
  if (isStorageInitialized()) {
    const storage = getStorage();
    return await storage.listPresentations(ctx);
  }
  // Fall back to file-based storage
  const mod = await import('./presentations/list.js');
  return await mod.listPresentations(repoRootOf(scope));
}

/**
 * Fetch one presentation by id, within the scope's organization.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getPresentation(scope, id) {
  // The single durable read funnel: every stored deck is migrated up to the
  // current schema version in memory here, so callers (editor, exports, the
  // semantic projection) never see a legacy shape — regardless of the storage
  // backend. Reads don't write; the upgraded deck is persisted on the next
  // write. migratePresentation is idempotent, so the file fallback (which also
  // migrates in readPresentation) is unaffected.
  const ctx = toStorageContext(scope, 'getPresentation');
  if (isStorageInitialized()) {
    const storage = getStorage();
    return migratePresentation(await storage.getPresentation(id, ctx));
  }
  const mod = await import('./presentations/crud.js');
  return migratePresentation(await mod.getPresentation(repoRootOf(scope), id));
}

/**
 * Create a presentation in the scope's organization.
 * @param {import('./scope.js').StorageScope} scope
 * @param {Object} body
 * @returns {Promise<Object>}
 */
export async function createPresentation(scope, body) {
  // Validate the scope before doing any work: a caller that gave none must fail
  // here, not after preparing a deck it has nowhere to put.
  const ctx = toStorageContext(scope, 'createPresentation', { actorEmail: body?.ownerEmail });
  const repoRoot = repoRootOf(scope);
  if (isStorageInitialized()) {
    // Prepare the full presentation object (with slides, i18n, etc.) before storing
    const mod = await import('./presentations/crud.js');
    const preparedPresentation = await mod.prepareNewPresentation(repoRoot, body);

    // Validate size limits before creating
    const validation = validatePresentationSize(preparedPresentation);
    if (!validation.ok) {
      return {
        ok: false,
        reason: 'limit_exceeded',
        errors: validation.errors,
      };
    }

    const storage = getStorage();
    const result = await storage.createPresentation(preparedPresentation, ctx);

    // Attach warnings to the result if any
    if (validation.warnings) {
      result._warnings = validation.warnings;
    }
    return result;
  }
  const mod = await import('./presentations/crud.js');
  return await mod.createPresentation(repoRoot, body);
}

/**
 * Update a presentation within the scope's organization.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} id
 * @param {Object} body
 * @param {Object} [opts]
 * @returns {Promise<Object>}
 */
export async function updatePresentation(scope, id, body, opts) {
  // Validate up front: the pre-save reads below would otherwise be the first
  // thing to notice a caller that stated no organization.
  toStorageContext(scope, 'updatePresentation', { actorEmail: opts?.actorEmail });
  const repoRoot = repoRootOf(scope);
  // Server-as-collaborator seam: capture the pre-save state first. It is
  // the base the caller's write was computed against, and live-apply's
  // three-way diff needs it to leave concurrent client edits alone.
  const collabEligible = opts?.reason !== 'collab' && isCollabLiveEditsEnabled();
  let collabBase = null;
  if (collabEligible) {
    collabBase = await getPresentation(scope, id).catch(() => null);
  }

  // Merge-capable save (editor autosave with If-Match + modified-slide ids)
  // by a client more than one revision behind: snapshot the current server
  // state first (reason 'pre_merge'), so a bad merge is a one-click restore
  // in the version history. File-based like every other snapshot, for both
  // storage backends. Best-effort: never blocks the save.
  const expectedRevision = Number(opts?.expectedRevision);
  if (Number.isFinite(expectedRevision) && Array.isArray(opts?.modifiedSlideIds)) {
    try {
      const current = collabBase || (await getPresentation(scope, id));
      if (current && Number(current.revision) - expectedRevision > 1) {
        await createPresentationVersion(scope, id, current, {
          actorEmail: opts?.actorEmail || null,
          reason: 'pre_merge',
        });
        await prunePresentationVersions(scope, id);
      }
    } catch {
      // snapshots are best-effort
    }
  }

  let result;
  try {
    result = await updatePresentationUncached(scope, id, body, opts);
  } finally {
    invalidatePresentationCache(id);
  }
  // Audit every performed slide-level merge (see the write paths, which
  // attach `_slideMerge` to the result). Fire-and-forget; the activity store
  // degrades to a no-op without a database.
  if (result && result.ok !== false && result._slideMerge && opts?.actorEmail) {
    void recordSlideLevelMerge({
      presentation: result,
      actorEmail: opts.actorEmail,
      merge: result._slideMerge,
    }).catch(() => {});
  }
  // Any successful mutation (editor save, public API, MCP tool) refreshes
  // live presenting clients. Fire-and-forget: a no-op without a live session.
  if (result && result.ok !== false) {
    import('./present-sessions/sse.js')
      .then((m) => m.notifyDeckUpdatedForPresentation(repoRoot, id))
      .catch(() => {});
    // Collab live edits, server-as-collaborator seam (ADR 001 §6): when the
    // deck's collab doc is actively loaded, apply this just-stored save to
    // the live doc so it reaches open editors instead of being overwritten
    // by the next debounced collab store. Saves that came FROM the doc
    // (reason 'collab') never loop back into it.
    let appliedToLiveDoc = false;
    if (collabEligible) {
      try {
        const { applyServerWriteToActiveDoc } = await import('../collab/live-apply.js');
        appliedToLiveDoc = await applyServerWriteToActiveDoc(id, result, { base: collabBase });
      } catch (err) {
        // The JSON save already succeeded; the live doc just didn't get it
        // (same gap as before step 4, for this one write). Say so loudly.
        log.error(
          `[collab] applying server write to active doc of ${id} failed; ` +
            'open editors will overwrite this save on their next store:',
          err?.message || err
        );
      }
    }
    // A save that did NOT reach the collab doc makes any stored (cold)
    // Y.Doc binary stale — invalidate it so the next collab open
    // re-bootstraps from this fresh JSON instead of resurrecting old
    // content. Saves originating from or applied to the doc keep their
    // binary. Unconditional (not gated on COLLAB_LIVE_EDITS): a binary
    // written while the flag was on must not survive saves made while it is
    // off, or re-enabling the flag would resurrect stale state. No-op when
    // no binary exists.
    if (opts?.reason !== 'collab' && !appliedToLiveDoc) {
      deleteYDocState(repoRoot, id).catch(() => {});
    }
  }
  return result;
}

async function updatePresentationUncached(scope, id, body, opts) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = toStorageContext(scope, 'updatePresentation', {
      actorEmail: opts?.actorEmail,
    });

    // Normalize slides and i18n before storing (mirrors crud.js behavior).
    // This ensures pres.slides and i18n.versions[lang].slides stay in sync.
    const normalized = { ...body };
    normalized.slides = normalizeSlides(normalized.slides);
    normalizeI18n(normalized);

    // Validate size limits before updating (unless bypassed)
    if (!opts?.skipLimitCheck) {
      const validation = validatePresentationSize(normalized);
      if (!validation.ok) {
        return {
          ok: false,
          reason: 'limit_exceeded',
          errors: validation.errors,
        };
      }

      const result = await storage.updatePresentation(id, normalized, ctx, opts);

      // Attach warnings to the result if any
      if (validation.warnings && result && typeof result === 'object') {
        result._warnings = validation.warnings;
      }
      return result;
    }

    return await storage.updatePresentation(id, normalized, ctx, opts);
  }
  const mod = await import('./presentations/crud.js');
  return await mod.updatePresentation(repoRootOf(scope), id, body, opts);
}

/**
 * Move a presentation to the trash.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} id
 * @param {Object} [opts]
 */
export async function deletePresentation(scope, id, opts) {
  const ctx = toStorageContext(scope, 'deletePresentation', { actorEmail: opts?.actorEmail });
  try {
    if (isStorageInitialized()) {
      const storage = getStorage();
      return await storage.deletePresentation(id, ctx);
    }
    const mod = await import('./presentations/crud.js');
    return await mod.deletePresentation(repoRootOf(scope), id, opts);
  } finally {
    invalidatePresentationCache(id);
    // Trash/restore round-trips must not resurrect a stale collab doc.
    // Unconditional for the same reason as in updatePresentation.
    deleteYDocState(repoRootOf(scope), id).catch(() => {});
  }
}

/**
 * List trashed presentations of the scope's organization.
 * @param {import('./scope.js').StorageScope} scope
 */
export async function listTrashedPresentations(scope) {
  const ctx = toStorageContext(scope, 'listTrashedPresentations');
  if (isStorageInitialized()) {
    const storage = getStorage();
    return await storage.listTrashedPresentations(ctx);
  }
  const mod = await import('./presentations/list.js');
  return await mod.listTrashedPresentations(repoRootOf(scope));
}

/**
 * Restore a presentation out of the trash.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} id
 */
export async function restorePresentation(scope, id) {
  try {
    const ctx = toStorageContext(scope, 'restorePresentation');
    if (isStorageInitialized()) {
      const storage = getStorage();
      return await storage.restorePresentation(id, ctx);
    }
    const mod = await import('./presentations/crud.js');
    return await mod.restorePresentation(repoRootOf(scope), id);
  } finally {
    invalidatePresentationCache(id);
  }
}

/**
 * Permanently delete a trashed presentation.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} id
 */
export async function permanentlyDeletePresentation(scope, id) {
  try {
    const ctx = toStorageContext(scope, 'permanentlyDeletePresentation');
    if (isStorageInitialized()) {
      const storage = getStorage();
      return await storage.permanentlyDeletePresentation(id, ctx);
    }
    const mod = await import('./presentations/crud.js');
    return await mod.permanentlyDeletePresentation(repoRootOf(scope), id);
  } finally {
    invalidatePresentationCache(id);
  }
}

/**
 * Duplicate a presentation within the scope's organization.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} id
 * @param {Object} [opts]
 */
export async function duplicatePresentation(scope, id, opts) {
  const ctx = toStorageContext(scope, 'duplicatePresentation', {
    actorEmail: opts?.actorEmail,
  });
  if (isStorageInitialized()) {
    const storage = getStorage();
    return await storage.duplicatePresentation(id, ctx, opts);
  }
  const mod = await import('./presentations/crud.js');
  return await mod.duplicatePresentation(repoRootOf(scope), id, opts);
}

/**
 * Batch-fetch first slides for multiple presentations.
 * Returns a Map of presentationId -> firstSlide object.
 * This avoids N+1 queries when loading shared presentations.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string[]} ids - Array of presentation IDs
 * @returns {Promise<Map<string, Object>>} Map of id -> firstSlide
 */
export async function getFirstSlidesForIds(scope, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return new Map();
  }

  const ctx = toStorageContext(scope, 'getFirstSlidesForIds');
  if (isStorageInitialized()) {
    const storage = getStorage();
    // If storage adapter supports batch first slides, use it
    if (typeof storage.getFirstSlidesForIds === 'function') {
      return await storage.getFirstSlidesForIds(ids, ctx);
    }
    // Fallback: fetch each presentation and extract first slide
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const pres = await storage.getPresentation(id, ctx);
          const first = pres?.slides?.[0];
          return [id, first ? { id: first.id, type: first.type, content: first.content || {} } : null];
        } catch {
          return [id, null];
        }
      })
    );
    return new Map(results);
  }

  // File-based storage: batch read JSON files
  const mod = await import('./presentations/crud.js');
  return await mod.getFirstSlidesForIds(repoRootOf(scope), ids);
}

// ============================================================
// PRESENTATION VERSIONS (version history)
// ============================================================
//
// Version snapshots route through the storage adapter, exactly like every
// other persisted entity. In file mode the adapter delegates to the file
// module (server/data/presentation-versions/*.json), so behavior is
// identical to importing that module directly. In Postgres mode they land
// in the `presentation_versions` table, so version history rides along with
// the regular DB backups instead of living on a disk that a redeploy wipes.
//
// The (scope, presentationId, ...) signature matches the CRUD helpers above:
// snapshots live in the same organization as the deck they snapshot, so they
// take the same scope. When storage is not initialized (some scripts/tests) we
// fall back to the file module.

/**
 * List version snapshots for a presentation (newest first).
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} presentationId
 * @returns {Promise<Array>}
 */
export async function listPresentationVersions(scope, presentationId) {
  const ctx = toStorageContext(scope, 'listPresentationVersions');
  if (isStorageInitialized()) {
    const storage = getStorage();
    return await storage.listPresentationVersions(presentationId, ctx);
  }
  const mod = await import('./presentations/versions.js');
  return await mod.listPresentationVersions(repoRootOf(scope), presentationId);
}

/**
 * Get a single version snapshot (full presentation data included).
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} presentationId
 * @param {string} versionId
 * @returns {Promise<Object|null>}
 */
export async function getPresentationVersion(scope, presentationId, versionId) {
  const ctx = toStorageContext(scope, 'getPresentationVersion');
  if (isStorageInitialized()) {
    const storage = getStorage();
    return await storage.getPresentationVersion(presentationId, versionId, ctx);
  }
  const mod = await import('./presentations/versions.js');
  return await mod.getPresentationVersion(repoRootOf(scope), presentationId, versionId);
}

/**
 * Create a version snapshot of a presentation.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} presentationId
 * @param {Object} pres - Full presentation object to snapshot
 * @param {Object} [opts]
 * @param {string|null} [opts.actorEmail]
 * @param {string} [opts.reason]
 * @param {string} [opts.label]
 * @returns {Promise<Object|null>}
 */
export async function createPresentationVersion(scope, presentationId, pres, opts = {}) {
  const ctx = toStorageContext(scope, 'createPresentationVersion', {
    actorEmail: opts?.actorEmail,
  });
  if (isStorageInitialized()) {
    const storage = getStorage();
    return await storage.createPresentationVersion(presentationId, pres, ctx, {
      reason: opts?.reason,
      label: opts?.label,
    });
  }
  const mod = await import('./presentations/versions.js');
  return await mod.createPresentationVersion(repoRootOf(scope), presentationId, pres, opts);
}

/**
 * Prune old version snapshots per the retention policy.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} presentationId
 * @param {Object} [opts]
 * @param {number} [opts.keep]
 * @returns {Promise<*>}
 */
export async function prunePresentationVersions(scope, presentationId, opts = {}) {
  const ctx = toStorageContext(scope, 'prunePresentationVersions');
  if (isStorageInitialized()) {
    const storage = getStorage();
    return await storage.prunePresentationVersions(presentationId, ctx, {
      keep: opts?.keep,
    });
  }
  const mod = await import('./presentations/versions.js');
  return await mod.prunePresentationVersions(repoRootOf(scope), presentationId, opts);
}