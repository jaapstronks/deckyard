/**
 * Presentations storage facade.
 * Uses storage adapter when initialized, falls back to file-based storage.
 */

import { isStorageInitialized, getStorage } from './adapters/index.js';
import { getDefaultOrganizationId } from '../config/database.js';
import { isCollabLiveEditsEnabled } from '../config/features.js';
import { deleteYDocState } from './presentation-ydocs.js';
import { normalizeSlides } from './presentations/slides.js';
import { normalizeI18n } from './presentations/i18n.js';
import { recordSlideLevelMerge } from '../services/activity-events.js';
import { validatePresentationSize } from '../utils/presentation-limits.js';
import { invalidatePresentationCache } from './presentation-cache.js';

/**
 * Get the context for storage operations.
 * In single-tenant mode, uses default organization.
 * TODO: In multi-tenant mode, extract from request/auth.
 * @param {Object} opts - Options with optional actorEmail
 * @returns {Object} Context with organizationId
 */
function getStorageContext(opts = {}) {
  return {
    organizationId: getDefaultOrganizationId(),
    actorEmail: opts.actorEmail || opts.ownerEmail || null,
  };
}

export async function listPresentations(repoRoot) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
    return await storage.listPresentations(ctx);
  }
  // Fall back to file-based storage
  const mod = await import('./presentations/list.js');
  return await mod.listPresentations(repoRoot);
}

export async function getPresentation(repoRoot, id) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
    return await storage.getPresentation(id, ctx);
  }
  const mod = await import('./presentations/crud.js');
  return await mod.getPresentation(repoRoot, id);
}

export async function createPresentation(repoRoot, body) {
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
    const ctx = getStorageContext({ actorEmail: body?.ownerEmail });
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

export async function updatePresentation(repoRoot, id, body, opts) {
  // Server-as-collaborator seam: capture the pre-save state first. It is
  // the base the caller's write was computed against, and live-apply's
  // three-way diff needs it to leave concurrent client edits alone.
  const collabEligible = opts?.reason !== 'collab' && isCollabLiveEditsEnabled();
  let collabBase = null;
  if (collabEligible) {
    collabBase = await getPresentation(repoRoot, id).catch(() => null);
  }

  // Merge-capable save (editor autosave with If-Match + modified-slide ids)
  // by a client more than one revision behind: snapshot the current server
  // state first (reason 'pre_merge'), so a bad merge is a one-click restore
  // in the version history. File-based like every other snapshot, for both
  // storage backends. Best-effort: never blocks the save.
  const expectedRevision = Number(opts?.expectedRevision);
  if (Number.isFinite(expectedRevision) && Array.isArray(opts?.modifiedSlideIds)) {
    try {
      const current = collabBase || (await getPresentation(repoRoot, id));
      if (current && Number(current.revision) - expectedRevision > 1) {
        await createPresentationVersion(repoRoot, id, current, {
          actorEmail: opts?.actorEmail || null,
          reason: 'pre_merge',
        });
        await prunePresentationVersions(repoRoot, id);
      }
    } catch {
      // snapshots are best-effort
    }
  }

  let result;
  try {
    result = await updatePresentationUncached(repoRoot, id, body, opts);
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
        console.error(
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

async function updatePresentationUncached(repoRoot, id, body, opts) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext({ actorEmail: opts?.actorEmail });

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
  return await mod.updatePresentation(repoRoot, id, body, opts);
}

export async function deletePresentation(repoRoot, id, opts) {
  try {
    if (isStorageInitialized()) {
      const storage = getStorage();
      const ctx = getStorageContext({ actorEmail: opts?.actorEmail });
      return await storage.deletePresentation(id, ctx);
    }
    const mod = await import('./presentations/crud.js');
    return await mod.deletePresentation(repoRoot, id, opts);
  } finally {
    invalidatePresentationCache(id);
    // Trash/restore round-trips must not resurrect a stale collab doc.
    // Unconditional for the same reason as in updatePresentation.
    deleteYDocState(repoRoot, id).catch(() => {});
  }
}

export async function listTrashedPresentations(repoRoot) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
    return await storage.listTrashedPresentations(ctx);
  }
  const mod = await import('./presentations/list.js');
  return await mod.listTrashedPresentations(repoRoot);
}

export async function restorePresentation(repoRoot, id) {
  try {
    if (isStorageInitialized()) {
      const storage = getStorage();
      const ctx = getStorageContext();
      return await storage.restorePresentation(id, ctx);
    }
    const mod = await import('./presentations/crud.js');
    return await mod.restorePresentation(repoRoot, id);
  } finally {
    invalidatePresentationCache(id);
  }
}

export async function permanentlyDeletePresentation(repoRoot, id) {
  try {
    if (isStorageInitialized()) {
      const storage = getStorage();
      const ctx = getStorageContext();
      return await storage.permanentlyDeletePresentation(id, ctx);
    }
    const mod = await import('./presentations/crud.js');
    return await mod.permanentlyDeletePresentation(repoRoot, id);
  } finally {
    invalidatePresentationCache(id);
  }
}

export async function duplicatePresentation(repoRoot, id, opts) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext({ actorEmail: opts?.actorEmail });
    return await storage.duplicatePresentation(id, ctx, opts);
  }
  const mod = await import('./presentations/crud.js');
  return await mod.duplicatePresentation(repoRoot, id, opts);
}

export async function claimPresentationOwnership(repoRoot, id, opts) {
  try {
    if (isStorageInitialized()) {
      const storage = getStorage();
      const ctx = getStorageContext({ actorEmail: opts?.ownerEmail });
      return await storage.claimPresentationOwnership(id, ctx, opts);
    }
    const mod = await import('./presentations/crud.js');
    return await mod.claimPresentationOwnership(repoRoot, id, opts);
  } finally {
    invalidatePresentationCache(id);
  }
}

/**
 * Batch-fetch first slides for multiple presentations.
 * Returns a Map of presentationId -> firstSlide object.
 * This avoids N+1 queries when loading shared presentations.
 * @param {string} repoRoot - Repository root path
 * @param {string[]} ids - Array of presentation IDs
 * @returns {Promise<Map<string, Object>>} Map of id -> firstSlide
 */
export async function getFirstSlidesForIds(repoRoot, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return new Map();
  }

  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
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
  return await mod.getFirstSlidesForIds(repoRoot, ids);
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
// The (repoRoot, presentationId, ...) signature is kept so existing call
// sites only swap their import path, never their arguments. When storage is
// not initialized (some scripts/tests) we fall back to the file module, same
// as the presentation CRUD helpers above.

/**
 * List version snapshots for a presentation (newest first).
 * @param {string} repoRoot
 * @param {string} presentationId
 * @returns {Promise<Array>}
 */
export async function listPresentationVersions(repoRoot, presentationId) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
    return await storage.listPresentationVersions(presentationId, ctx);
  }
  const mod = await import('./presentations/versions.js');
  return await mod.listPresentationVersions(repoRoot, presentationId);
}

/**
 * Get a single version snapshot (full presentation data included).
 * @param {string} repoRoot
 * @param {string} presentationId
 * @param {string} versionId
 * @returns {Promise<Object|null>}
 */
export async function getPresentationVersion(repoRoot, presentationId, versionId) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
    return await storage.getPresentationVersion(presentationId, versionId, ctx);
  }
  const mod = await import('./presentations/versions.js');
  return await mod.getPresentationVersion(repoRoot, presentationId, versionId);
}

/**
 * Create a version snapshot of a presentation.
 * @param {string} repoRoot
 * @param {string} presentationId
 * @param {Object} pres - Full presentation object to snapshot
 * @param {Object} [opts]
 * @param {string|null} [opts.actorEmail]
 * @param {string} [opts.reason]
 * @param {string} [opts.label]
 * @returns {Promise<Object|null>}
 */
export async function createPresentationVersion(repoRoot, presentationId, pres, opts = {}) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext({ actorEmail: opts?.actorEmail });
    return await storage.createPresentationVersion(presentationId, pres, ctx, {
      reason: opts?.reason,
      label: opts?.label,
    });
  }
  const mod = await import('./presentations/versions.js');
  return await mod.createPresentationVersion(repoRoot, presentationId, pres, opts);
}

/**
 * Prune old version snapshots per the retention policy.
 * @param {string} repoRoot
 * @param {string} presentationId
 * @param {Object} [opts]
 * @param {number} [opts.keep]
 * @returns {Promise<*>}
 */
export async function prunePresentationVersions(repoRoot, presentationId, opts = {}) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
    return await storage.prunePresentationVersions(presentationId, ctx, {
      keep: opts?.keep,
    });
  }
  const mod = await import('./presentations/versions.js');
  return await mod.prunePresentationVersions(repoRoot, presentationId, opts);
}