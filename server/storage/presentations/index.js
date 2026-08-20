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

import crypto from 'node:crypto';
import { getDb, sql } from '../../db/client.js';
import { getOrgId } from '../../utils/context.js';
import { nowIso } from '../../utils/normalize.js';
import { resolveIdentityByEmail } from '../identity-resolver.js';
import {
  resolveDisplayNames,
  toDisplayIdentity,
  NO_DISPLAY_NAMES,
} from '../display-identity.js';
import { ConflictError } from '../../utils/errors.js';
import { mergeSlidesAtSlideLevel } from './crud/helpers.js';
import { enforceSlideWritePolicy } from './crud/enforce-slide-locks.js';
import { repoRootOf, toStorageContext } from '../scope.js';
import { isCollabLiveEditsEnabled } from '../../config/features.js';
import { deleteYDocState } from './ydocs.js';
import { normalizeSlides } from './slides.js';
import { rekeyNewDeckSlides } from './crud/rekey-new-deck.js';
import { normalizeI18n } from './i18n.js';
import { prepareNewPresentation } from './crud/factory.js';
import { assertSandboxQuotaForCreate } from './sandbox-quota.js';
import { stripIdentityForSnapshot } from './snapshot-identity.js';
import { recordSlideLevelMerge } from '../../services/activity-events.js';
import { validatePresentationSize } from '../../utils/presentation-limits.js';
import { invalidatePresentationCache } from './cache.js';
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
  return listPresentationRows(ctx);
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
  const ctx = toStorageContext(
    storageScope,
    'getPresentation',
    {},
    ALLOW_CROSS_ORG,
  );
  return migratePresentation(await getPresentationRow(id, ctx));
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
  const ctx = toStorageContext(storageScope, 'createPresentation', {
    actorEmail: body?.ownerEmail,
  });
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

  const result = await createPresentationRow(preparedPresentation, ctx);

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
  toStorageContext(storageScope, 'updatePresentation', {
    actorEmail: opts?.actorEmail,
  });
  // Server-as-collaborator seam: capture the pre-save state first. It is
  // the base the caller's write was computed against, and live-apply's
  // three-way diff needs it to leave concurrent client edits alone.
  const collabEligible =
    opts?.reason !== 'collab' && isCollabLiveEditsEnabled();
  let collabBase = null;
  if (collabEligible) {
    collabBase = await getPresentation(storageScope, id).catch(() => null);
  }

  // Merge-capable save (editor autosave with If-Match + modified-slide ids)
  // by a client more than one revision behind: snapshot the current server
  // state first (reason 'pre_merge'), so a bad merge is a one-click restore
  // in the version history. Best-effort: never blocks the save.
  const expectedRevision = Number(opts?.expectedRevision);
  if (
    Number.isFinite(expectedRevision) &&
    Array.isArray(opts?.modifiedSlideIds)
  ) {
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
      scope: storageScope,
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
        const { applyServerWriteToActiveDoc } =
          await import('../../collab/live-apply.js');
        appliedToLiveDoc = await applyServerWriteToActiveDoc(id, result, {
          base: collabBase,
        });
      } catch (err) {
        // The JSON save already succeeded; the live doc just didn't get it
        // (same gap as before step 4, for this one write). Say so loudly.
        log.error(
          `[collab] applying server write to active doc of ${id} failed; ` +
            'open editors will overwrite this save on their next store:',
          err?.message || err,
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
    actorUserId: opts?.actorUserId,
    actorEmail: opts?.actorEmail,
  });

  // Normalize slides and i18n before storing. This ensures pres.slides and
  // i18n.versions[lang].slides stay in sync.
  //
  // Only normalize slides the caller actually sent: `normalizeSlides`
  // answers `[]` for an absent list, and handing the store an invented
  // empty array would make a body that never mentioned slides (an
  // unpublish, say) erase them. The store treats `undefined` as "leave
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
      await updatePresentationRow(id, normalized, ctx, opts),
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
  return migratePresentation(
    await updatePresentationRow(id, normalized, ctx, opts),
  );
}

/**
 * Move a presentation to the trash.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} id
 * @param {Object} [opts]
 */
export async function deletePresentation(storageScope, id, opts) {
  const ctx = toStorageContext(storageScope, 'deletePresentation', {
    actorEmail: opts?.actorEmail,
  });
  try {
    return await deletePresentationRow(id, ctx);
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
  return listTrashedPresentationRows(ctx);
}

/**
 * Restore a presentation out of the trash.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} id
 * @returns {Promise<{ok: true, presentation: Object}|{ok: false, reason: string}>}
 *   `not_found` when no trashed deck with that id lives in this organization.
 */
export async function restorePresentation(storageScope, id) {
  try {
    const ctx = toStorageContext(storageScope, 'restorePresentation');
    return await restorePresentationRow(id, ctx);
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
    return await permanentlyDeletePresentationRow(id, ctx);
  } finally {
    invalidatePresentationCache(id);
  }
}

/**
 * Duplicate a presentation within the storageScope's organization.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} id
 * @param {Object} [opts]
 * @returns {Promise<{ok: true, presentation: Object}|{ok: false, reason: string}>}
 *   `not_found` when the source deck is not visible in this organization.
 */
export async function duplicatePresentation(storageScope, id, opts) {
  const ctx = toStorageContext(storageScope, 'duplicatePresentation', {
    actorEmail: opts?.actorEmail,
  });
  // A duplicate mints a new deck, so it counts against the guest's sandbox
  // quota — refuse (typed 4xx) once they are at the cap. No-op outside sandbox.
  await assertSandboxQuotaForCreate(ctx, opts?.actorEmail);
  return duplicatePresentationRow(id, ctx);
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
  // Fetch each presentation and extract its first slide. (There is no batch
  // store query for this; the per-id reads below are the whole implementation.)
  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        const pres = await getPresentationRow(id, ctx);
        const first = pres?.slides?.[0];
        return [
          id,
          first
            ? { id: first.id, type: first.type, content: first.content || {} }
            : null,
        ];
      } catch {
        return [id, null];
      }
    }),
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
  return listPresentationVersionRows(presentationId, ctx);
}

/**
 * Get a single version snapshot (full presentation data included).
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} presentationId
 * @param {string} versionId
 * @returns {Promise<Object|null>}
 */
export async function getPresentationVersion(
  storageScope,
  presentationId,
  versionId,
) {
  const ctx = toStorageContext(storageScope, 'getPresentationVersion');
  return getPresentationVersionRow(presentationId, versionId, ctx);
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
export async function createPresentationVersion(
  storageScope,
  presentationId,
  pres,
  opts = {},
) {
  const ctx = toStorageContext(storageScope, 'createPresentationVersion', {
    actorEmail: opts?.actorEmail,
  });
  // Identity is the living deck's, not the snapshot's: strip it from the
  // embedded copy rather than stamping a person's address into every
  // historical row. Who *took* the snapshot is still recorded, in the
  // `created_by` column the store fills from `ctx.actorEmail`. See
  // snapshot-identity.js for why restore does not need it back.
  return createPresentationVersionRow(
    presentationId,
    stripIdentityForSnapshot(pres),
    ctx,
    {
      reason: opts?.reason,
      label: opts?.label,
    },
  );
}

/**
 * Prune old version snapshots per the retention policy.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} presentationId
 * @param {Object} [opts]
 * @param {number} [opts.keep]
 * @returns {Promise<*>}
 */
export async function prunePresentationVersions(
  storageScope,
  presentationId,
  opts = {},
) {
  const ctx = toStorageContext(storageScope, 'prunePresentationVersions');
  return prunePresentationVersionRows(presentationId, ctx, {
    keep: opts?.keep,
  });
}

// ============================================================================
// Persistence: the direct-Kysely row queries the facade above delegates to.
// ============================================================================
//
// These are module-local on purpose. They moved here verbatim from the deleted
// `withPresentations` adapter mixin (B79 / D34): the adapter class was one of
// two idioms for reaching Postgres, and the beta doctrine keeps a single one
// (direct Kysely on `getDb()`). They take a resolved `StorageContext` — the
// facade above is the one `toStorageContext(scope, …)` boundary (A7.20), so the
// storage-call convention lives on the exported functions, not on these
// primitives. `getDb()` throws on an uninitialized database exactly as the
// former adapter singleton did, so the "no silent fallback" contract is
// unchanged (this deliberately does not adopt `withDbGuard`, which would
// reintroduce silent degradation). `mapPresentationRow` is exported for the
// snapshot-identity contract test, which pins its field list.

/**
 * Serialize a JSONB value for PostgreSQL.
 * @param {any} value
 * @returns {any}
 */
function jsonb(value) {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

/**
 * Map a presentation version database row to an API object (list view).
 * @param {object} row - Database row
 * @param {import('../display-identity.js').DisplayNameLookup} [lookup] -
 *   Resolved display names; omitted derives them from the stored address.
 * @returns {object}
 */
function mapVersionRowSummary(row, lookup = NO_DISPLAY_NAMES) {
  return {
    id: row.id,
    presentationId: row.presentation_id,
    created: row.created_at,
    // Who made this snapshot is display, never a decision: nothing compares a
    // version's author. So it travels as a display pair (D22) — the stable
    // `users.id` (migration 069) and the name to render — and the e-mail that
    // seeded both stays server-side. See storage/display-identity.js.
    createdBy: toDisplayIdentity(
      row.created_by_user_id,
      row.created_by,
      lookup,
    ),
    reason: row.reason,
    label: row.label,
    revision: row.revision,
    title: row.title,
  };
}

/**
 * Map a presentation version database row to an API object (full view).
 * @param {object} row - Database row
 * @param {import('../display-identity.js').DisplayNameLookup} [lookup] -
 *   Resolved display names; omitted derives them from the stored address.
 * @returns {object}
 */
function mapVersionRowFull(row, lookup = NO_DISPLAY_NAMES) {
  return {
    ...mapVersionRowSummary(row, lookup),
    presentation: row.presentation_data,
  };
}

/**
 * Map a presentation database row to an API object.
 * @param {object} row - Database row
 * @param {import('../display-identity.js').DisplayNameLookup} [lookup] -
 *   Resolved display names; omitted derives them from the stored address.
 * @returns {object}
 */
export function mapPresentationRow(row, lookup = NO_DISPLAY_NAMES) {
  return {
    id: row.id,
    // The owning organization travels with the presentation so the
    // authorization layer can check it without a second query; see
    // isSameOrganization() in utils/presentation-authz/presentations.js.
    organizationId: row.organization_id,
    title: row.title,
    description: row.description,
    created: row.created_at,
    modified: row.modified_at,
    theme: row.theme,
    lang: row.lang,
    visibility: row.visibility,
    isViewOnly: !!row.is_view_only,
    revision: row.revision,
    // The **owner** keeps its two flat fields: the id is the key every
    // authorization decision compares (migration 063), and the address beside
    // it is one a reader who can already open the deck may have (D22).
    ownerId: row.owner_user_id || null,
    ownerEmail: row.owner_email,
    // Everyone else on a deck is *named*, not addressed: a display pair whose
    // id is still the key (`createdBy.id` is what isOwnerOrCreator compares)
    // and whose address stays server-side. See storage/display-identity.js.
    createdBy: toDisplayIdentity(
      row.created_by_user_id,
      row.created_by,
      lookup,
    ),
    updatedBy: toDisplayIdentity(
      row.updated_by_user_id,
      row.updated_by,
      lookup,
    ),
    settings: row.settings || {},
    i18n: row.i18n || {},
    slides: row.slides || [],
    notionSourcePageId: row.notion_source_page_id,
    sandbox: row.sandbox,
    published: row.published,
    trashedAt: row.trashed_at,
    trashedBy: toDisplayIdentity(
      row.trashed_by_user_id,
      row.trashed_by,
      lookup,
    ),
  };
}

/**
 * List all presentations accessible by the context.
 * @param {object} ctx - Storage context
 */
async function listPresentationRows(ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  const rows = await db
    .selectFrom('presentations')
    .select([
      'id',
      'title',
      'modified_at as modified',
      'created_at as created',
      'theme',
      // The owner keeps both fields (key + an address the reader may have);
      // the creator is a display pair below. See storage/display-identity.js.
      'owner_user_id as ownerId',
      'owner_email as ownerEmail',
      'created_by_user_id as createdById',
      'created_by as createdBy',
      'updated_by_user_id as updatedById',
      'updated_by as updatedBy',
      'visibility',
      'is_view_only as isViewOnly',
      'revision',
      'i18n',
      'slides',
    ])
    .where('organization_id', '=', orgId)
    .where('trashed_at', 'is', null)
    .orderBy('modified_at', 'desc')
    // Full organization-scoped set. B79 inherited applyPagination()'s default
    // 100-row cap as a literal .limit(100), silently dropping the tail for orgs
    // with >100 decks; B85 removed it. Consumers treat this as the complete list
    // (public-api paginates over it in-memory, search scans it, MCP filters it,
    // bulk-export backs it up), so a hard cap corrupted their totals and dropped
    // data. DB-level pagination is a future deliberate feature, not this cap.
    // See docs/reference/storage-layer.md § List reads.
    .execute();

  // One batched name lookup for the whole page rather than one per card:
  // a 200-deck organization would otherwise issue 200 identical queries.
  const displayNames = await resolveDisplayNames(
    rows.flatMap((row) => [
      { id: row.updatedById, email: row.updatedBy },
      { id: row.createdById, email: row.createdBy },
    ]),
  );

  return rows.map((row) => {
    const slides = Array.isArray(row.slides) ? row.slides : [];
    const firstSlide = slides[0] || null;
    const i18n = row.i18n && typeof row.i18n === 'object' ? row.i18n : null;
    const dominant = i18n?.dominant || null;

    return {
      id: row.id,
      title: row.title,
      modified: row.modified,
      created: row.created,
      theme: row.theme,
      ownerId: row.ownerId || null,
      ownerEmail: row.ownerEmail,
      createdBy: toDisplayIdentity(
        row.createdById,
        row.createdBy,
        displayNames,
      ),
      updatedBy: toDisplayIdentity(
        row.updatedById,
        row.updatedBy,
        displayNames,
      ),
      visibility: row.visibility,
      isViewOnly: !!row.isViewOnly,
      revision: row.revision,
      i18n: i18n
        ? {
            dominant,
            hasNl: !!i18n.versions?.nl,
            hasEnGb: !!i18n.versions?.['en-GB'],
            otherLang:
              dominant === 'nl' ? 'en-GB' : dominant === 'en-GB' ? 'nl' : null,
          }
        : null,
      hasSlides: !!firstSlide,
    };
  });
}

/**
 * Fetch one presentation.
 *
 * The organization filter is skipped only when the context declares
 * `crossOrganization` (see server/storage/scope.js): a published deck, an
 * embed or a share link resolves a globally unique token first and looks
 * the deck up by the id that token yielded, so the token is the
 * authorization and an organization filter would only break those links on
 * a multi-organization instance. Every other read stays scoped.
 * @param {string} id
 * @param {object} ctx - Storage context
 */
async function getPresentationRow(id, ctx) {
  const db = getDb();

  let query = db.selectFrom('presentations').selectAll().where('id', '=', id);
  if (!ctx?.crossOrganization) {
    query = query.where('organization_id', '=', getOrgId(ctx));
  }

  const row = await query.executeTakeFirst();

  if (!row) return null;
  return mapPresentationRow(row, await displayNamesFor(row));
}

/**
 * Resolve the display names one presentation row needs.
 *
 * Only the last writer travels as a display pair today; owner and creator are
 * still compared, so they keep their (id, email) stamps. Kept as one helper so
 * every single-row read path resolves the same set — the memo in
 * storage/display-identity.js makes the repeat calls free.
 *
 * @param {object} row - A raw `presentations` row.
 * @returns {Promise<import('../display-identity.js').DisplayNameLookup>}
 */
async function displayNamesFor(row) {
  return resolveDisplayNames([
    { id: row?.updated_by_user_id, email: row?.updated_by },
    { id: row?.created_by_user_id, email: row?.created_by },
    { id: row?.trashed_by_user_id, email: row?.trashed_by },
  ]);
}

/**
 * @param {object} data
 * @param {object} ctx - Storage context
 */
async function createPresentationRow(data, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);
  const timestamp = nowIso();

  const id = data.id || crypto.randomUUID();
  const ownerEmail = data.ownerEmail || ctx?.actorEmail || null;

  // Dual-key (T10 PR 3): stamp the stable user_id beside each email column.
  // At create the owner is also the creator and last writer, so all three
  // email columns hold `ownerEmail` and all three id columns resolve from
  // it — one lookup. A known user maps to their users.id; an owner with no
  // users row resolves `external` and stays NULL (the pinned legacy path).
  // Reads still key on the email; this only populates the columns a later
  // PR moves the ownership reads onto.
  const ownerResolution = await resolveIdentityByEmail(ownerEmail);
  const ownerUserId = ownerResolution?.userId ?? null;

  const row = await db
    .insertInto('presentations')
    .values({
      id,
      organization_id: orgId,
      owner_email: ownerEmail,
      created_by: ownerEmail,
      updated_by: ownerEmail,
      owner_user_id: ownerUserId,
      created_by_user_id: ownerUserId,
      updated_by_user_id: ownerUserId,
      title: data.title || 'Untitled',
      description: data.description || null,
      theme: data.theme || 'default',
      lang: data.lang || 'nl',
      visibility: 'private',
      revision: 1,
      settings: jsonb(data.settings || {}),
      i18n: jsonb(data.i18n || {}),
      slides: jsonb(data.slides || []),
      notion_source_page_id: data.notionSourcePageId || null,
      sandbox: jsonb(data.sandbox),
      created_at: timestamp,
      modified_at: timestamp,
    })
    .returningAll()
    .executeTakeFirst();

  return mapPresentationRow(row, await displayNamesFor(row));
}

/**
 * @param {string} id
 * @param {object} data
 * @param {object} ctx - Storage context
 * @param {object} [opts]
 */
async function updatePresentationRow(id, data, ctx, opts = {}) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  // Read the stored state once: the optimistic-locking check and the
  // slide-lock policy below both diff against it.
  const existing = await getPresentationRow(id, ctx);
  if (!existing) return null;

  // Check for optimistic locking
  let mergeInfo = null;
  if (opts?.expectedRevision != null) {
    if (existing.revision !== opts.expectedRevision) {
      // Attempt slide-level merge when client provides modifiedSlideIds
      const modifiedSlideIds = Array.isArray(opts?.modifiedSlideIds)
        ? opts.modifiedSlideIds
        : null;
      if (modifiedSlideIds && modifiedSlideIds.length >= 0) {
        const revisionGap =
          Number(existing.revision) - Number(opts.expectedRevision);
        const clientReordered = opts?.clientReordered ?? null;
        const mergeResult = mergeSlidesAtSlideLevel({
          serverSlides: existing.slides,
          clientSlides: data.slides,
          modifiedSlideIds,
          baseFingerprints: opts?.slideBaseFingerprints || null,
          revisionGap,
          clientReordered,
        });
        if (mergeResult.merged && mergeResult.conflicts.length === 0) {
          mergeInfo = {
            revisionGap,
            modifiedSlideIds,
            appendedSlideIds: mergeResult.appendedSlideIds || [],
            clientReordered,
          };
          data = { ...data, slides: mergeResult.slides };
          // Keep the active-language buffer in step with the merged
          // slides. The editor loads that buffer, so storing the
          // client's stale copy here would undo the merge on the next
          // load. (File-mode gets this for free: normalizeI18n runs
          // after the merge there.)
          const activeLang = data?.i18n?.active;
          if (activeLang && data?.i18n?.versions?.[activeLang]) {
            data = {
              ...data,
              i18n: {
                ...data.i18n,
                versions: {
                  ...data.i18n.versions,
                  [activeLang]: {
                    ...data.i18n.versions[activeLang],
                    slides: mergeResult.slides,
                  },
                },
              },
            };
          }
        } else if (mergeResult.conflicts.length > 0) {
          throw new ConflictError(
            'Conflict: the same slides were modified by multiple users.',
            {
              id: existing.id,
              revision: existing.revision,
              modified: existing.modified,
              updatedBy: existing.updatedBy || null,
              conflictingSlides: mergeResult.conflicts,
            },
          );
        } else {
          throw new ConflictError('Presentation was updated by someone else', {
            id: existing.id,
            revision: existing.revision,
            modified: existing.modified,
          });
        }
      } else {
        throw new ConflictError('Presentation was updated by someone else', {
          id: existing.id,
          revision: existing.revision,
          modified: existing.modified,
        });
      }
    }
  }

  // Slide-lock policy (shared with the file-mode CRUD path): only
  // authors may toggle lockedByAuthor, and content edits/deletes on
  // locked slides are rejected with 423. Runs after the slide-level
  // merge above so stale client copies of other users' slides don't
  // read as edits.
  await enforceSlideWritePolicy({
    existing,
    nextSlides: data.slides,
    nextI18nVersions: data?.i18n?.versions || null,
    user: opts?.user || null,
    actorUserId: ctx?.actorUserId || null,
    bypassLockCheck: !!opts?.bypassLockCheck,
    ctx,
  });

  // Partial writes: a caller may speak about only part of the document.
  // The public API's slide handlers pass `{ slides }` and nothing else, so
  // only the columns a caller actually named may reach the UPDATE.
  //
  // The rule, and it is the same one for every column below:
  //   - value `undefined` (key absent, or explicitly not stated) -> the
  //     column is left out of the SET clause entirely, so the stored value
  //     survives;
  //   - value `null` -> written as NULL, because a caller that says `null`
  //     is asking for the column to be cleared.
  //
  // This used to be built unconditionally, and the two halves disagreed:
  // Kysely drops an `undefined` from a SET clause, so `title` survived a
  // partial write, while `jsonb(undefined)` turned the same absence into an
  // explicit `null` and wiped `settings`, `i18n`, `published` and
  // `description`. One partial `POST /api/v1/presentations/:id/slides`
  // emptied a production deck's whole i18n object that way.
  // Dual-key (T10 PR 3 + transfer-gap fix): the update path stamps the
  // "last writer", filling `updated_by_user_id` from the very same actor it
  // writes to `updated_by` — the two keys move together or the per-row
  // backfill verification (brief volgorde-punt 4) becomes impossible. It
  // never rewrites `created_by`/`created_by_user_id` (those are create-only),
  // and on the ordinary editor save it leaves `owner_email`/`owner_user_id`
  // alone as well. Only the ownership-transfer route opts in via
  // `allowOwnerChange` (below), and there the paired owner keys move in this
  // same statement.
  // The pair moves together or not at all. A write with no actor at all
  // (the anonymous notes-companion save) leaves `updated_by` untouched —
  // Kysely drops an `undefined` from the SET clause — so stamping
  // `updated_by_user_id` anyway would null the id half while the email half
  // kept the previous writer, which is exactly the divergence the dual-key
  // invariant exists to prevent.
  // `data.updatedBy` is a *display pair* on the way out (D22) and was never a
  // meaningful thing to send in, so only a bare address is honoured here — a
  // caller that echoes a whole presentation back must not stamp an object into
  // a varchar column.
  const updatedByEmail =
    ctx?.actorEmail ||
    (typeof data.updatedBy === 'string' ? data.updatedBy : null);
  const updateData = {
    modified_at: nowIso(),
    revision: sql`revision + 1`,
  };
  if (updatedByEmail) {
    const updatedByResolution = await resolveIdentityByEmail(updatedByEmail);
    updateData.updated_by = updatedByEmail;
    updateData.updated_by_user_id = updatedByResolution?.userId ?? null;
  }
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.settings !== undefined) updateData.settings = jsonb(data.settings);
  if (data.i18n !== undefined) updateData.i18n = jsonb(data.i18n);
  if (data.slides !== undefined) updateData.slides = jsonb(data.slides);
  if (data.published !== undefined)
    updateData.published = jsonb(data.published);

  if (opts?.allowVisibilityChange && data.visibility) {
    updateData.visibility = data.visibility;
  }

  // Ownership transfer is the one write that rewrites `owner_email`, and it
  // is gated exactly like `allowVisibilityChange`: only the ownership route opts
  // in via `allowOwnerChange`, so a regular editor save (which never carries
  // the flag, and whose body may omit `ownerEmail` entirely) can never move
  // the owner. Because the transfer is the *only* mover of `owner_email` in
  // Postgres mode, this fixes the pre-existing gap where a transfer silently
  // dropped the new owner (brief § PR 3). The dual-key invariant holds by
  // construction: `owner_email` and `owner_user_id` are set from a single
  // resolution of the same address, so the paired keys can never diverge —
  // a known owner writes their `users.id`, an external owner writes NULL.
  if (opts?.allowOwnerChange && data.ownerEmail) {
    const ownerResolution = await resolveIdentityByEmail(data.ownerEmail);
    if (ownerResolution) {
      updateData.owner_email = ownerResolution.value;
      updateData.owner_user_id = ownerResolution.userId ?? null;
    }
  }

  // Theme is hard-locked on the shared write path; only an explicit,
  // permission-checked switch (the /change-theme route) opts in via
  // allowThemeChange, mirroring the allowVisibilityChange escape hatch above.
  if (opts?.allowThemeChange && data.theme) {
    updateData.theme = data.theme;
  }

  // Only the /visibility route passes allowViewOnlyChange; regular editor saves
  // must not touch the stored flag (their body may omit it entirely).
  if (opts?.allowViewOnlyChange && typeof data.isViewOnly === 'boolean') {
    updateData.is_view_only = data.isViewOnly;
  }

  const row = await db
    .updateTable('presentations')
    .set(updateData)
    .where('id', '=', id)
    .where('organization_id', '=', orgId)
    .returningAll()
    .executeTakeFirst();

  if (!row) return null;
  const out = mapPresentationRow(row, await displayNamesFor(row));
  // Response-only audit metadata (never stored); the facade logs it to
  // activity_events.
  if (mergeInfo) out._slideMerge = mergeInfo;
  return out;
}

/**
 * @param {string} id
 * @param {object} ctx - Storage context
 */
async function deletePresentationRow(id, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  // Soft delete: set trashed_at and trashed_by instead of deleting.
  // Dual-key (T10 PR F2): stamp the id beside trashed_by from one
  // resolution of the same address, so the trash-visibility / restore
  // authz reads can match on the stable id. An actor with no users row
  // resolves `external` and stays NULL (the pinned legacy path).
  const trashedByEmail = ctx?.actorEmail || null;
  const trashedByResolution = trashedByEmail
    ? await resolveIdentityByEmail(trashedByEmail)
    : null;
  const result = await db
    .updateTable('presentations')
    .set({
      trashed_at: nowIso(),
      trashed_by: trashedByEmail,
      trashed_by_user_id: trashedByResolution?.userId ?? null,
    })
    .where('id', '=', id)
    .where('organization_id', '=', orgId)
    .where('trashed_at', 'is', null) // Only trash if not already trashed
    .executeTakeFirst();

  return result.numUpdatedRows > 0;
}

/**
 * List all trashed presentations.
 * @param {object} ctx - Storage context
 */
async function listTrashedPresentationRows(ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  const rows = await db
    .selectFrom('presentations')
    .select([
      'id',
      'title',
      'modified_at as modified',
      'created_at as created',
      'trashed_at as trashedAt',
      'trashed_by as trashedBy',
      'trashed_by_user_id as trashedById',
      'theme',
      'owner_user_id as ownerId',
      'owner_email as ownerEmail',
      'created_by_user_id as createdById',
      'created_by as createdBy',
      'updated_by_user_id as updatedById',
      'updated_by as updatedBy',
      'visibility',
      'revision',
      'i18n',
      'slides',
    ])
    .where('organization_id', '=', orgId)
    .where('trashed_at', 'is not', null)
    .orderBy('trashed_at', 'desc')
    // Full organization-scoped trash set; B85 removed the inherited 100-row cap
    // (see listPresentationRows above and docs/reference/storage-layer.md
    // § List reads).
    .execute();

  const displayNames = await resolveDisplayNames(
    rows.flatMap((row) => [
      { id: row.updatedById, email: row.updatedBy },
      { id: row.createdById, email: row.createdBy },
      { id: row.trashedById, email: row.trashedBy },
    ]),
  );

  return rows.map((row) => {
    const slides = Array.isArray(row.slides) ? row.slides : [];
    const firstSlide = slides[0] || null;
    const i18n = row.i18n && typeof row.i18n === 'object' ? row.i18n : null;
    const dominant = i18n?.dominant || null;

    return {
      id: row.id,
      title: row.title,
      modified: row.modified,
      created: row.created,
      trashedAt: row.trashedAt,
      trashedBy: toDisplayIdentity(
        row.trashedById,
        row.trashedBy,
        displayNames,
      ),
      theme: row.theme,
      ownerId: row.ownerId || null,
      ownerEmail: row.ownerEmail,
      createdBy: toDisplayIdentity(
        row.createdById,
        row.createdBy,
        displayNames,
      ),
      updatedBy: toDisplayIdentity(
        row.updatedById,
        row.updatedBy,
        displayNames,
      ),
      visibility: row.visibility,
      revision: row.revision,
      i18n: i18n
        ? {
            dominant,
            hasNl: !!i18n.versions?.nl,
            hasEnGb: !!i18n.versions?.['en-GB'],
            otherLang:
              dominant === 'nl' ? 'en-GB' : dominant === 'en-GB' ? 'nl' : null,
          }
        : null,
      hasSlides: !!firstSlide,
    };
  });
}

/**
 * Restore a presentation from trash.
 * @param {string} id - Presentation ID
 * @param {object} ctx - Storage context
 */
async function restorePresentationRow(id, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  const row = await db
    .updateTable('presentations')
    .set({
      trashed_at: null,
      trashed_by: null,
      // Clear both halves of the dual key together (T10 PR F2), so a
      // restored deck carries no stale trasher id.
      trashed_by_user_id: null,
    })
    .where('id', '=', id)
    .where('organization_id', '=', orgId)
    .where('trashed_at', 'is not', null) // Only restore if trashed
    .returningAll()
    .executeTakeFirst();

  if (!row) return { ok: false, reason: 'not_found' };
  return {
    ok: true,
    presentation: mapPresentationRow(row, await displayNamesFor(row)),
  };
}

/**
 * Permanently delete a presentation (bypass trash).
 * @param {string} id - Presentation ID
 * @param {object} ctx - Storage context
 */
async function permanentlyDeletePresentationRow(id, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  const result = await db
    .deleteFrom('presentations')
    .where('id', '=', id)
    .where('organization_id', '=', orgId)
    .executeTakeFirst();

  return result.numDeletedRows > 0;
}

/**
 * @param {string} id
 * @param {object} ctx - Storage context
 * @returns {Promise<{ok: true, presentation: Object}|{ok: false, reason: string}>}
 */
async function duplicatePresentationRow(id, ctx) {
  const existing = await getPresentationRow(id, ctx);
  if (!existing) return { ok: false, reason: 'not_found' };

  // One new id per *source* slide id, shared by every language version of it
  // (they are one slide) and used to re-point a nested slide at its copied
  // parent — a `parentId` left pointing at the original deck's slide is how the
  // copy used to come out flat.
  const slideIdMap = new Map();
  const newIdFor = (oldId) => {
    if (!slideIdMap.has(oldId)) slideIdMap.set(oldId, crypto.randomUUID());
    return slideIdMap.get(oldId);
  };
  const mapSlides = (slides) => {
    const list = Array.isArray(slides) ? slides : [];
    // Claim an id for every slide first: a child may precede its parent.
    for (const s of list) if (s?.id) newIdFor(s.id);
    // The mapped id is claimed once per list: language versions of one slide
    // share it (they are one slide), a repeated id *within* a list is corrupt
    // data that must not come out as two slides under one id.
    const claimed = new Set();
    return list.map((s) => {
      const mapped = s?.id && !claimed.has(s.id) ? slideIdMap.get(s.id) : null;
      if (s?.id) claimed.add(s.id);
      return {
        ...s,
        id: mapped || crypto.randomUUID(),
        parentId: (s?.parentId && slideIdMap.get(s.parentId)) || null,
        // Deep-copied: the rekey pass writes into it, and the row we read from
        // is not ours to change.
        content:
          s?.content && typeof s.content === 'object'
            ? structuredClone(s.content)
            : {},
      };
    });
  };

  const newSlides = mapSlides(existing.slides);
  const newI18n = existing.i18n ? { ...existing.i18n } : {};
  if (newI18n.versions) {
    for (const [lang, version] of Object.entries(newI18n.versions)) {
      if (version?.slides) {
        newI18n.versions[lang] = {
          ...version,
          slides: mapSlides(version.slides),
        };
      }
    }
  }

  const lang = existing.i18n?.dominant || existing.lang || 'nl';
  const prefix = lang === 'en-GB' ? 'Copy of ' : 'Kopie van ';
  const newTitle = prefix + existing.title;

  // Mint the copy's id here rather than leaving it to the insert: the slides
  // are rekeyed against it (a follow-invite slide's QR code has to point at the
  // copy, not at the deck it was copied from).
  const duplicate = rekeyNewDeckSlides({
    id: crypto.randomUUID(),
    title: newTitle,
    theme: existing.theme,
    lang: existing.lang,
    settings: existing.settings,
    i18n: newI18n,
    slides: newSlides,
  });

  const created = await createPresentationRow(duplicate, ctx);
  return { ok: true, presentation: created };
}

/**
 * List version snapshots for a presentation (newest first).
 * @param {string} presentationId
 * @param {object} ctx - Storage context
 */
async function listPresentationVersionRows(presentationId, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  const rows = await db
    .selectFrom('presentation_versions')
    .select([
      'id',
      'presentation_id',
      'created_at',
      'created_by',
      'created_by_user_id',
      'reason',
      'label',
      'revision',
      'title',
    ])
    .where('presentation_id', '=', presentationId)
    .where('organization_id', '=', orgId)
    .orderBy('created_at', 'desc')
    // Full version history for the deck; B85 removed the inherited 100-row cap
    // (see listPresentationRows above and docs/reference/storage-layer.md
    // § List reads). bulk-export walks this per deck, so a cap truncated the
    // backup of any deck with >100 saved versions.
    .execute();

  const displayNames = await resolveDisplayNames(
    rows.map((row) => ({ id: row.created_by_user_id, email: row.created_by })),
  );
  return rows.map((row) => mapVersionRowSummary(row, displayNames));
}

/**
 * Get a single version snapshot (full presentation data included).
 * @param {string} presentationId
 * @param {string} versionId
 * @param {object} ctx - Storage context
 */
async function getPresentationVersionRow(presentationId, versionId, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  const row = await db
    .selectFrom('presentation_versions')
    .selectAll()
    .where('id', '=', versionId)
    .where('presentation_id', '=', presentationId)
    .where('organization_id', '=', orgId)
    .executeTakeFirst();

  if (!row) return null;
  return mapVersionRowFull(row, await versionDisplayNames(row));
}

/**
 * Resolve the display name one version row needs.
 * @param {object} row - A raw `presentation_versions` row.
 * @returns {Promise<import('../display-identity.js').DisplayNameLookup>}
 */
async function versionDisplayNames(row) {
  return resolveDisplayNames([
    { id: row?.created_by_user_id, email: row?.created_by },
  ]);
}

/**
 * Create a version snapshot of a presentation.
 * @param {string} presentationId
 * @param {object} snapshot - Full presentation object to snapshot
 * @param {object} ctx - Storage context
 * @param {object} [opts]
 */
async function createPresentationVersionRow(
  presentationId,
  snapshot,
  ctx,
  opts = {},
) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  // Dual-key (T10 PR F1): stamp the stable user_id beside created_by from a
  // single resolution of the same address, so the two halves can never
  // drift (the invariant verifyIdentityConsistency checks). A known actor
  // maps to their users.id; an actor with no users row resolves `external`
  // and stays NULL (the pinned legacy path). Nothing keys authz on this audit
  // column — the version list renders `{ id, displayName }` from it (D22).
  const createdByEmail = ctx?.actorEmail || null;
  const createdByResolution = createdByEmail
    ? await resolveIdentityByEmail(createdByEmail)
    : null;

  const row = await db
    .insertInto('presentation_versions')
    .values({
      presentation_id: presentationId,
      organization_id: orgId,
      created_by: createdByEmail,
      created_by_user_id: createdByResolution?.userId ?? null,
      reason: opts?.reason || 'snapshot',
      label: opts?.label || null,
      revision: snapshot.revision,
      title: snapshot.title,
      presentation_data: jsonb(snapshot),
    })
    .returningAll()
    .executeTakeFirst();

  return mapVersionRowFull(row, await versionDisplayNames(row));
}

/**
 * Prune old version snapshots per the retention policy.
 * @param {string} presentationId
 * @param {object} ctx - Storage context
 * @param {object} [opts]
 * @param {number} [opts.keep]
 */
async function prunePresentationVersionRows(presentationId, ctx, opts = {}) {
  const db = getDb();
  const orgId = getOrgId(ctx);
  const keep = opts?.keep || 50;

  const toKeep = await db
    .selectFrom('presentation_versions')
    .select('id')
    .where('presentation_id', '=', presentationId)
    .where('organization_id', '=', orgId)
    .orderBy('created_at', 'desc')
    .limit(keep)
    .execute();

  const keepIds = toKeep.map((r) => r.id);
  if (keepIds.length === 0) return 0;

  const result = await db
    .deleteFrom('presentation_versions')
    .where('presentation_id', '=', presentationId)
    .where('organization_id', '=', orgId)
    .where('id', 'not in', keepIds)
    .executeTakeFirst();

  return Number(result.numDeletedRows) || 0;
}

// ─── white-box test seam ─────────────────────────────────────────────────────
//
// The persistence primitives above are module-local because they take a
// resolved StorageContext, not a StorageScope — the facade is the single
// `toStorageContext(scope, …)` boundary (A7.20), and these sit below it, exactly
// as the adapter class methods they replaced did (class methods were never part
// of the scope-first consumer contract either). A handful of unit tests pin
// store-layer behaviour the heavier facade path cannot express in isolation —
// organization-scoping of the raw queries, and the undefined-vs-null partial
// UPDATE rule — so those primitives are reachable here as one internal bundle.
// The `__` prefix marks it internal/test-only, like `__setTestDb` /
// `__resetStorageForTests`; production code calls the exported facade.
export const __store = {
  getPresentationRow,
  listPresentationRows,
  createPresentationRow,
  updatePresentationRow,
};
