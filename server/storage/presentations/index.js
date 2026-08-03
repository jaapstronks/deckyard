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

import { isStorageInitialized, getStorage } from '../adapters/index.js';
import { repoRootOf } from '../scope.js';
import { createStorageDispatch, toStorageContext } from '../backend-dispatch.js';
import { isCollabLiveEditsEnabled } from '../../config/features.js';
import { deleteYDocState } from '../presentation-ydocs.js';
import { normalizeSlides } from './slides.js';
import { normalizeI18n } from './i18n.js';
import { assertSandboxQuotaForCreate } from './sandbox-quota.js';
import { recordSlideLevelMerge } from '../../services/activity-events.js';
import { validatePresentationSize } from '../../utils/presentation-limits.js';
import { invalidatePresentationCache } from '../presentation-cache.js';
import { migratePresentation } from '../../../shared/slide-types/schema-version.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('presentations');

// The presentations facade dispatches to three file-backend modules depending
// on the operation: list/trash reads, CRUD, and version history. One bound
// dispatcher each, all sharing the DB-vs-file logic in backend-dispatch.js.
const withList = createStorageDispatch(() => import('./list.js'));
const withCrud = createStorageDispatch(() => import('./crud/index.js'));
const withVersions = createStorageDispatch(() => import('./versions.js'));

// Only the single-deck read may skip the organization filter, and only for a
// deck a public token already addressed. Everything else — listings and every
// write — must state its organization.
const ALLOW_CROSS_ORG = { allowCrossOrganization: true };

/**
 * List the presentations of the scope's organization.
 * @param {import('../scope.js').StorageScope} scope
 * @returns {Promise<Array>}
 */
export async function listPresentations(scope) {
  const ctx = toStorageContext(scope, 'listPresentations');
  return withList(
    scope,
    'listPresentations',
    (storage) => storage.listPresentations(ctx),
    (mod) => mod.listPresentations(repoRootOf(scope))
  );
}

/**
 * Fetch one presentation by id, within the scope's organization.
 * @param {import('../scope.js').StorageScope} scope
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
  const ctx = toStorageContext(scope, 'getPresentation', {}, ALLOW_CROSS_ORG);
  return withCrud(
    scope,
    'getPresentation',
    async (storage) => migratePresentation(await storage.getPresentation(id, ctx)),
    async (mod) => migratePresentation(await mod.getPresentation(repoRootOf(scope), id)),
    ALLOW_CROSS_ORG
  );
}

/**
 * Create a presentation in the scope's organization.
 * @param {import('../scope.js').StorageScope} scope
 * @param {Object} body
 * @returns {Promise<Object>}
 */
export async function createPresentation(scope, body) {
  // Kept as an explicit dispatch rather than routed through withCrud: the DB
  // branch also loads crud.js (for prepareNewPresentation), so its import is not
  // a file-backend fallback and could not move into a fileFn. Consolidating the
  // dispatch here would relocate that import, not remove it.
  //
  // Validate the scope before doing any work: a caller that gave none must fail
  // here, not after preparing a deck it has nowhere to put.
  const ctx = toStorageContext(scope, 'createPresentation', { actorEmail: body?.ownerEmail });
  const repoRoot = repoRootOf(scope);
  // Sandbox: refuse the mint (typed 4xx) once the guest is at their storage
  // quota, before preparing anything. Enforced here in the facade so it covers
  // every backend; no-op outside sandbox mode.
  await assertSandboxQuotaForCreate(ctx, body?.ownerEmail);
  if (isStorageInitialized()) {
    // Prepare the full presentation object (with slides, i18n, etc.) before storing
    const mod = await import('./crud/index.js');
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
  const mod = await import('./crud/index.js');
  return await mod.createPresentation(repoRoot, body);
}

/**
 * Update a presentation within the scope's organization.
 * @param {import('../scope.js').StorageScope} scope
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
    import('../present-sessions/sse.js')
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
      deleteYDocState(scope, id).catch(() => {});
    }
  }
  return result;
}

function updatePresentationUncached(scope, id, body, opts) {
  return withCrud(
    scope,
    'updatePresentation',
    async (storage) => {
      const ctx = toStorageContext(scope, 'updatePresentation', {
        actorEmail: opts?.actorEmail,
      });

      // Normalize slides and i18n before storing (mirrors crud.js behavior).
      // This ensures pres.slides and i18n.versions[lang].slides stay in sync.
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

        const result = await storage.updatePresentation(id, normalized, ctx, opts);

        // Attach warnings to the result if any
        if (validation.warnings && result && typeof result === 'object') {
          result._warnings = validation.warnings;
        }
        return result;
      }

      return await storage.updatePresentation(id, normalized, ctx, opts);
    },
    async (mod) => {
      // The file write path still queries the database for locks, so it needs
      // the organization this write acts in — see lockContext() in crud/write.js.
      const { organizationId } = toStorageContext(scope, 'updatePresentation', {
        actorEmail: opts?.actorEmail,
      });
      return await mod.updatePresentation(repoRootOf(scope), id, body, {
        ...opts,
        organizationId,
      });
    }
  );
}

/**
 * Move a presentation to the trash.
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} id
 * @param {Object} [opts]
 */
export async function deletePresentation(scope, id, opts) {
  const ctx = toStorageContext(scope, 'deletePresentation', { actorEmail: opts?.actorEmail });
  try {
    return await withCrud(
      scope,
      'deletePresentation',
      (storage) => storage.deletePresentation(id, ctx),
      (mod) => mod.deletePresentation(repoRootOf(scope), id, opts)
    );
  } finally {
    invalidatePresentationCache(id);
    // Trash/restore round-trips must not resurrect a stale collab doc.
    // Unconditional for the same reason as in updatePresentation.
    deleteYDocState(scope, id).catch(() => {});
  }
}

/**
 * List trashed presentations of the scope's organization.
 * @param {import('../scope.js').StorageScope} scope
 */
export async function listTrashedPresentations(scope) {
  const ctx = toStorageContext(scope, 'listTrashedPresentations');
  return withList(
    scope,
    'listTrashedPresentations',
    (storage) => storage.listTrashedPresentations(ctx),
    (mod) => mod.listTrashedPresentations(repoRootOf(scope))
  );
}

/**
 * Restore a presentation out of the trash.
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} id
 */
export async function restorePresentation(scope, id) {
  try {
    const ctx = toStorageContext(scope, 'restorePresentation');
    return await withCrud(
      scope,
      'restorePresentation',
      (storage) => storage.restorePresentation(id, ctx),
      (mod) => mod.restorePresentation(repoRootOf(scope), id)
    );
  } finally {
    invalidatePresentationCache(id);
  }
}

/**
 * Permanently delete a trashed presentation.
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} id
 */
export async function permanentlyDeletePresentation(scope, id) {
  try {
    const ctx = toStorageContext(scope, 'permanentlyDeletePresentation');
    return await withCrud(
      scope,
      'permanentlyDeletePresentation',
      (storage) => storage.permanentlyDeletePresentation(id, ctx),
      // The file module unpublishes through the (organization-scoped) published
      // facade, so it needs the organization — see crud/delete.js.
      (mod) => mod.permanentlyDeletePresentation(repoRootOf(scope), id, {
        organizationId: ctx.organizationId,
      })
    );
  } finally {
    invalidatePresentationCache(id);
  }
}

/**
 * Duplicate a presentation within the scope's organization.
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} id
 * @param {Object} [opts]
 */
export async function duplicatePresentation(scope, id, opts) {
  const ctx = toStorageContext(scope, 'duplicatePresentation', {
    actorEmail: opts?.actorEmail,
  });
  // A duplicate mints a new deck, so it counts against the guest's sandbox
  // quota — refuse (typed 4xx) once they are at the cap. No-op outside sandbox.
  await assertSandboxQuotaForCreate(ctx, opts?.actorEmail);
  return withCrud(
    scope,
    'duplicatePresentation',
    (storage) => storage.duplicatePresentation(id, ctx, opts),
    (mod) => mod.duplicatePresentation(repoRootOf(scope), id, opts)
  );
}

/**
 * Batch-fetch first slides for multiple presentations.
 * Returns a Map of presentationId -> firstSlide object.
 * This avoids N+1 queries when loading shared presentations.
 * @param {import('../scope.js').StorageScope} scope
 * @param {string[]} ids - Array of presentation IDs
 * @returns {Promise<Map<string, Object>>} Map of id -> firstSlide
 */
export async function getFirstSlidesForIds(scope, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return new Map();
  }

  const ctx = toStorageContext(scope, 'getFirstSlidesForIds');
  return withCrud(
    scope,
    'getFirstSlidesForIds',
    async (storage) => {
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
    },
    // File-based storage: batch read JSON files
    (mod) => mod.getFirstSlidesForIds(repoRootOf(scope), ids)
  );
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
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} presentationId
 * @returns {Promise<Array>}
 */
export async function listPresentationVersions(scope, presentationId) {
  const ctx = toStorageContext(scope, 'listPresentationVersions');
  return withVersions(
    scope,
    'listPresentationVersions',
    (storage) => storage.listPresentationVersions(presentationId, ctx),
    (mod) => mod.listPresentationVersions(repoRootOf(scope), presentationId)
  );
}

/**
 * Get a single version snapshot (full presentation data included).
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} presentationId
 * @param {string} versionId
 * @returns {Promise<Object|null>}
 */
export async function getPresentationVersion(scope, presentationId, versionId) {
  const ctx = toStorageContext(scope, 'getPresentationVersion');
  return withVersions(
    scope,
    'getPresentationVersion',
    (storage) => storage.getPresentationVersion(presentationId, versionId, ctx),
    (mod) => mod.getPresentationVersion(repoRootOf(scope), presentationId, versionId)
  );
}

/**
 * Create a version snapshot of a presentation.
 * @param {import('../scope.js').StorageScope} scope
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
  return withVersions(
    scope,
    'createPresentationVersion',
    (storage) => storage.createPresentationVersion(presentationId, pres, ctx, {
      reason: opts?.reason,
      label: opts?.label,
    }),
    (mod) => mod.createPresentationVersion(repoRootOf(scope), presentationId, pres, opts)
  );
}

/**
 * Prune old version snapshots per the retention policy.
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} presentationId
 * @param {Object} [opts]
 * @param {number} [opts.keep]
 * @returns {Promise<*>}
 */
export async function prunePresentationVersions(scope, presentationId, opts = {}) {
  const ctx = toStorageContext(scope, 'prunePresentationVersions');
  return withVersions(
    scope,
    'prunePresentationVersions',
    (storage) => storage.prunePresentationVersions(presentationId, ctx, {
      keep: opts?.keep,
    }),
    (mod) => mod.prunePresentationVersions(repoRootOf(scope), presentationId, opts)
  );
}