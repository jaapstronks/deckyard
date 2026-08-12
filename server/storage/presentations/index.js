/**
 * Presentations storage facade.
 *
 * Every function here takes a **storage scope** as its first argument rather
 * than a bare `repoRoot` string: which organization the operation acts in, and
 * on whose behalf. The facade used to answer the organization question itself,
 * with a hardcoded `getDefaultOrganizationId()`, which is why a session working
 * in organization B would still read decks out of organization A. It no longer
 * has a default to fall back to — see server/storage/scope.js for the contract
 * and for the one legitimate way to say "this operation is not
 * organization-scoped".
 */

import { getStorage } from '../adapters/index.js';
import { repoRootOf } from '../scope.js';
import { toStorageContext } from '../backend-dispatch.js';
import { isCollabLiveEditsEnabled } from '../../config/features.js';
import { deleteYDocState } from '../presentation-ydocs.js';
import { normalizeSlides } from './slides.js';
import { normalizeI18n } from './i18n.js';
import { prepareNewPresentation } from './crud/factory.js';
import { assertSandboxQuotaForCreate } from './sandbox-quota.js';
import { stripIdentityForSnapshot } from './snapshot-identity.js';
import { recordSlideLevelMerge } from '../../services/activity-events.js';
import { validatePresentationSize } from '../../utils/presentation-limits.js';
import { invalidatePresentationCache } from '../presentation-cache.js';
import { migratePresentation } from '../../../shared/slide-types/schema-version.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('presentations');

// Only the single-deck read may skip the organization filter, and only for a
// deck a public token already addressed. Everything else — listings and every
// write — must state its organization.
const ALLOW_CROSS_ORG = { allowCrossOrganization: true };

/**
 * List the presentations of the storageScope's organization.
 * @param {import('../scope.js').StorageScope} storageScope
 * @returns {Promise<Array>}
 */
export async function listPresentations(storageScope) {
  const ctx = toStorageContext(storageScope, 'listPresentations');
  const storage = getStorage();
  return storage.listPresentations(ctx);
}

/**
 * Fetch one presentation by id, within the storageScope's organization.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getPresentation(storageScope, id) {
  // The single durable read funnel: every stored deck is migrated up to the
  // current schema version in memory here, so callers (editor, exports, the
  // semantic projection) never see a legacy shape. Reads don't write; the
  // upgraded deck is persisted on the next write.
  const ctx = toStorageContext(storageScope, 'getPresentation', {}, ALLOW_CROSS_ORG);
  const storage = getStorage();
  return migratePresentation(await storage.getPresentation(id, ctx));
}

/**
 * Create a presentation in the storageScope's organization.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {Object} body
 * @returns {Promise<Object>}
 */
export async function createPresentation(storageScope, body) {
  // Validate the storageScope before doing any work: a caller that gave none must fail
  // here, not after preparing a deck it has nowhere to put.
  const ctx = toStorageContext(storageScope, 'createPresentation', { actorEmail: body?.ownerEmail });
  const repoRoot = repoRootOf(storageScope);
  // Sandbox: refuse the mint (typed 4xx) once the guest is at their storage
  // quota, before preparing anything. Enforced here in the facade; no-op
  // outside sandbox mode.
  await assertSandboxQuotaForCreate(ctx, body?.ownerEmail);

  // Prepare the full presentation object (with slides, i18n, etc.) before storing
  const preparedPresentation = await prepareNewPresentation(repoRoot, body);

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

/**
 * Update a presentation within the storageScope's organization.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} id
 * @param {Object} body
 * @param {Object} [opts]
 * @returns {Promise<Object>}
 */
export async function updatePresentation(storageScope, id, body, opts) {
  // Validate up front: the pre-save reads below would otherwise be the first
  // thing to notice a caller that stated no organization.
  toStorageContext(storageScope, 'updatePresentation', { actorEmail: opts?.actorEmail });
  // Server-as-collaborator seam: capture the pre-save state first. It is
  // the base the caller's write was computed against, and live-apply's
  // three-way diff needs it to leave concurrent client edits alone.
  const collabEligible = opts?.reason !== 'collab' && isCollabLiveEditsEnabled();
  let collabBase = null;
  if (collabEligible) {
    collabBase = await getPresentation(storageScope, id).catch(() => null);
  }

  // Merge-capable save (editor autosave with If-Match + modified-slide ids)
  // by a client more than one revision behind: snapshot the current server
  // state first (reason 'pre_merge'), so a bad merge is a one-click restore
  // in the version history. Best-effort: never blocks the save.
  const expectedRevision = Number(opts?.expectedRevision);
  if (Number.isFinite(expectedRevision) && Array.isArray(opts?.modifiedSlideIds)) {
    try {
      const current = collabBase || (await getPresentation(storageScope, id));
      if (current && Number(current.revision) - expectedRevision > 1) {
        await createPresentationVersion(storageScope, id, current, {
          actorEmail: opts?.actorEmail || null,
          reason: 'pre_merge',
        });
        await prunePresentationVersions(storageScope, id);
      }
    } catch {
      // snapshots are best-effort
    }
  }

  let result;
  try {
    result = await updatePresentationUncached(storageScope, id, body, opts);
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
    import('../live-sessions/sse.js')
      .then((m) => m.notifyDeckUpdatedForPresentation(storageScope, id))
      .catch(() => {});
    // Collab live edits, server-as-collaborator seam (ADR 001 §6): when the
    // deck's collab doc is actively loaded, apply this just-stored save to
    // the live doc so it reaches open editors instead of being overwritten
    // by the next debounced collab store. Saves that came FROM the doc
    // (reason 'collab') never loop back into it.
    let appliedToLiveDoc = false;
    if (collabEligible) {
      try {
        const { applyServerWriteToActiveDoc } = await import('../../collab/live-apply.js');
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
      deleteYDocState(storageScope, id).catch(() => {});
    }
  }
  return result;
}

async function updatePresentationUncached(storageScope, id, body, opts) {
  const ctx = toStorageContext(storageScope, 'updatePresentation', {
    actorEmail: opts?.actorEmail,
  });
  const storage = getStorage();

  // Normalize slides and i18n before storing. This ensures pres.slides and
  // i18n.versions[lang].slides stay in sync.
  //
  // Only normalize slides the caller actually sent: `normalizeSlides`
  // answers `[]` for an absent list, and handing the adapter an invented
  // empty array would make a body that never mentioned slides (an
  // unpublish, say) erase them. The adapter treats `undefined` as "leave
  // this column alone", so the key has to stay absent to get there.
  const normalized = { ...body };
  if (normalized.slides !== undefined) {
    normalized.slides = normalizeSlides(normalized.slides);
  }
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

    const result = migratePresentation(
      await storage.updatePresentation(id, normalized, ctx, opts)
    );

    // Attach warnings to the result if any
    if (validation.warnings && result && typeof result === 'object') {
      result._warnings = validation.warnings;
    }
    return result;
  }

  // The write funnel answers the same shape as the read funnel: the stored
  // row carries no schemaVersion column, so the mapped result is stamped here
  // exactly like getPresentation stamps its reads. Without this, consumers
  // comparing a write result against a read (the collab live-apply guard)
  // see a permanent schemaVersion difference and never converge.
  return migratePresentation(await storage.updatePresentation(id, normalized, ctx, opts));
}

/**
 * Move a presentation to the trash.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} id
 * @param {Object} [opts]
 */
export async function deletePresentation(storageScope, id, opts) {
  const ctx = toStorageContext(storageScope, 'deletePresentation', { actorEmail: opts?.actorEmail });
  const storage = getStorage();
  try {
    return await storage.deletePresentation(id, ctx);
  } finally {
    invalidatePresentationCache(id);
    // Trash/restore round-trips must not resurrect a stale collab doc.
    // Unconditional for the same reason as in updatePresentation.
    deleteYDocState(storageScope, id).catch(() => {});
  }
}

/**
 * List trashed presentations of the storageScope's organization.
 * @param {import('../scope.js').StorageScope} storageScope
 */
export async function listTrashedPresentations(storageScope) {
  const ctx = toStorageContext(storageScope, 'listTrashedPresentations');
  const storage = getStorage();
  return storage.listTrashedPresentations(ctx);
}

/**
 * Restore a presentation out of the trash.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} id
 */
export async function restorePresentation(storageScope, id) {
  try {
    const ctx = toStorageContext(storageScope, 'restorePresentation');
    const storage = getStorage();
    return await storage.restorePresentation(id, ctx);
  } finally {
    invalidatePresentationCache(id);
  }
}

/**
 * Permanently delete a trashed presentation.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} id
 */
export async function permanentlyDeletePresentation(storageScope, id) {
  try {
    const ctx = toStorageContext(storageScope, 'permanentlyDeletePresentation');
    const storage = getStorage();
    return await storage.permanentlyDeletePresentation(id, ctx);
  } finally {
    invalidatePresentationCache(id);
  }
}

/**
 * Duplicate a presentation within the storageScope's organization.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} id
 * @param {Object} [opts]
 */
export async function duplicatePresentation(storageScope, id, opts) {
  const ctx = toStorageContext(storageScope, 'duplicatePresentation', {
    actorEmail: opts?.actorEmail,
  });
  // A duplicate mints a new deck, so it counts against the guest's sandbox
  // quota — refuse (typed 4xx) once they are at the cap. No-op outside sandbox.
  await assertSandboxQuotaForCreate(ctx, opts?.actorEmail);
  const storage = getStorage();
  return storage.duplicatePresentation(id, ctx, opts);
}

/**
 * Batch-fetch first slides for multiple presentations.
 * Returns a Map of presentationId -> firstSlide object.
 * This avoids N+1 queries when loading shared presentations.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string[]} ids - Array of presentation IDs
 * @returns {Promise<Map<string, Object>>} Map of id -> firstSlide
 */
export async function getFirstSlidesForIds(storageScope, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return new Map();
  }

  const ctx = toStorageContext(storageScope, 'getFirstSlidesForIds');
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

// ============================================================
// PRESENTATION VERSIONS (version history)
// ============================================================
//
// Version snapshots route through the storage adapter, exactly like every
// other persisted entity: they land in the `presentation_versions` table, so
// version history rides along with the regular DB backups instead of living on
// a disk that a redeploy wipes.
//
// The (storageScope, presentationId, ...) signature matches the CRUD helpers above:
// snapshots live in the same organization as the deck they snapshot, so they
// take the same storageScope.

/**
 * List version snapshots for a presentation (newest first).
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} presentationId
 * @returns {Promise<Array>}
 */
export async function listPresentationVersions(storageScope, presentationId) {
  const ctx = toStorageContext(storageScope, 'listPresentationVersions');
  const storage = getStorage();
  return storage.listPresentationVersions(presentationId, ctx);
}

/**
 * Get a single version snapshot (full presentation data included).
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} presentationId
 * @param {string} versionId
 * @returns {Promise<Object|null>}
 */
export async function getPresentationVersion(storageScope, presentationId, versionId) {
  const ctx = toStorageContext(storageScope, 'getPresentationVersion');
  const storage = getStorage();
  return storage.getPresentationVersion(presentationId, versionId, ctx);
}

/**
 * Create a version snapshot of a presentation.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} presentationId
 * @param {Object} pres - Full presentation object to snapshot
 * @param {Object} [opts]
 * @param {string|null} [opts.actorEmail]
 * @param {string} [opts.reason]
 * @param {string} [opts.label]
 * @returns {Promise<Object|null>}
 */
export async function createPresentationVersion(storageScope, presentationId, pres, opts = {}) {
  const ctx = toStorageContext(storageScope, 'createPresentationVersion', {
    actorEmail: opts?.actorEmail,
  });
  const storage = getStorage();
  // Identity is the living deck's, not the snapshot's: strip it from the
  // embedded copy rather than stamping a person's address into every
  // historical row. Who *took* the snapshot is still recorded, in the
  // `created_by` column the adapter fills from `ctx.actorEmail`. See
  // snapshot-identity.js for why restore does not need it back.
  return storage.createPresentationVersion(presentationId, stripIdentityForSnapshot(pres), ctx, {
    reason: opts?.reason,
    label: opts?.label,
  });
}

/**
 * Prune old version snapshots per the retention policy.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} presentationId
 * @param {Object} [opts]
 * @param {number} [opts.keep]
 * @returns {Promise<*>}
 */
export async function prunePresentationVersions(storageScope, presentationId, opts = {}) {
  const ctx = toStorageContext(storageScope, 'prunePresentationVersions');
  const storage = getStorage();
  return storage.prunePresentationVersions(presentationId, ctx, {
    keep: opts?.keep,
  });
}