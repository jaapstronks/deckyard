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

import { crossOrganizationScope } from '../scope.js';

import crypto from 'node:crypto';
import { getDb, sql } from '../../db/client.js';
import { getOrgId } from '../../utils/context.js';
import { nowIso } from '../../utils/normalize.js';
import { normalizeEmail } from '../../../shared/email.js';
import { resolveIdentityByEmail } from '../identity-resolver.js';
import {
  resolveDisplayNames,
  toDisplayIdentity,
  NO_DISPLAY_NAMES,
} from '../display-identity.js';
import { revisionConflict } from '../../utils/errors.js';
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
import { dominantSlidesBody } from '../../services/deck-versions.js';
import { validatePresentationSize } from '../../utils/presentation-limits.js';
import { fireAndForget } from '../../utils/fire-and-forget.js';
import { countInstanceHealth, slideTypeEntries } from '../instance-health.js';
import { invalidatePresentationCache } from './cache.js';
import { __deckList } from './deck-list.js';
import { migratePresentation } from '../../../shared/slide-types/schema-version.js';
import { buildMergedSlideTypes } from '../../utils/custom-slide-type-runtime.js';
import { createLogger } from '../../utils/logger.js';
import { DEFAULT_DECK_LANG } from '../../../shared/i18n-utils.js';
import { extensionNames } from '../../../shared/extension-provenance.js';
import { translationFieldKey } from '../../../shared/translation-provenance.js';
import { settleBgTextContrast } from '../../utils/bg-image-contrast.js';
import { loadDeckTheme } from '../../utils/themes.js';
const log = createLogger('presentations');

// Only the single-deck read may skip the organization filter, and only for a
// deck a public token already addressed. Everything else — listings and every
// write — must state its organization.
const ALLOW_CROSS_ORG = { allowCrossOrganization: true };

// The 409 for a stale `If-Match` the slide-level merge was not asked for, or
// declined. Same sentence shape as the library-slide conflict.
const STALE_REVISION_MESSAGE =
  'Conflict: this presentation was updated by someone else. Reload and try again.';

function translationKeySlideId(key) {
  try {
    const address = JSON.parse(key);
    return Array.isArray(address) && address.length === 2 ? address[0] : null;
  } catch {
    return null;
  }
}

/** A stale slide save owns provenance only for the slides it actually changed. */
function mergeTranslationSources(
  serverI18n,
  clientI18n,
  modifiedSlideIds,
  activeLang,
) {
  if (!clientI18n?.versions) return clientI18n;
  const modified = new Set(modifiedSlideIds);
  const versions = { ...serverI18n?.versions, ...clientI18n.versions };
  for (const [lang, clientVersion] of Object.entries(clientI18n.versions)) {
    const serverVersion = serverI18n?.versions?.[lang];
    if (!serverVersion || !clientVersion) continue;
    if (lang !== activeLang) {
      // The client has no edits in this language. Keep the server's text and
      // records while carrying newly added slides through its structure sync.
      versions[lang] = {
        ...serverVersion,
        slides: mergeSlidesAtSlideLevel({
          serverSlides: serverVersion.slides,
          clientSlides: clientVersion.slides,
          modifiedSlideIds: [],
          clientReordered: false,
        }).slides,
      };
      continue;
    }
    const sources = { ...serverVersion.translationSources };
    for (const [key, value] of Object.entries(
      clientVersion.translationSources || {},
    )) {
      if (modified.has(translationKeySlideId(key))) sources[key] = value;
    }
    versions[lang] = { ...clientVersion };
    if (Object.keys(sources).length)
      versions[lang].translationSources = sources;
    else delete versions[lang].translationSources;
  }
  return { ...clientI18n, versions };
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
  // semantic projection) never see a legacy shape. Reads don't write; the
  // upgraded deck is persisted on the next write.
  const ctx = toStorageContext(scope, 'getPresentation', {}, ALLOW_CROSS_ORG);
  return migratePresentation(await getPresentationRow(id, ctx));
}

/**
 * Create a presentation in the scope's organization.
 * @param {import('../scope.js').StorageScope} scope
 * @param {Object} body
 * @returns {Promise<Object>}
 */
export async function createPresentation(scope, body) {
  // Validate the scope before doing any work: a caller that gave none must fail
  // here, not after preparing a deck it has nowhere to put.
  const ctx = toStorageContext(scope, 'createPresentation', {
    actorEmail: body?.ownerEmail,
  });
  const repoRoot = repoRootOf(scope);
  // Sandbox: refuse the mint (typed 4xx) once the guest is at their storage
  // quota, before preparing anything. Enforced here in the facade; no-op
  // outside sandbox mode.
  await assertSandboxQuotaForCreate(ctx, body?.ownerEmail);

  // Prepare the full presentation object (with slides, i18n, etc.) before storing.
  // A create may carry slides (library insert, import, agent payload), and those
  // pass the same write seam, so it gets the same organization registry an
  // update does — see the note on `slideTypes` below.
  const preparedPresentation = await prepareNewPresentation(repoRoot, body, {
    slideTypes: await buildMergedSlideTypes(scope),
    storageScope: scope,
  });

  // Text colour over a background image is settled before the deck is
  // stored, so a deck that never meets the editor (MCP, import, AI) presents
  // with a readable title (B627).
  await settleBgTextContrast(preparedPresentation, {
    repoRoot,
    loadTheme: () => loadDeckTheme(repoRoot, preparedPresentation.theme, scope),
  });

  // Validate size limits before creating
  const validation = validatePresentationSize(preparedPresentation);
  if (!validation.ok) {
    return {
      ok: false,
      reason: 'limit_exceeded',
      errors: validation.errors,
    };
  }

  // The create answers the shape a read answers, like updatePresentation: a
  // payload in a pre-fold shape (an agent writing text-blocks' numbered rows)
  // is stored as sent and folded on every read, so the response folds too.
  const result = migratePresentation(
    await createPresentationRow(preparedPresentation, ctx),
  );

  // Attach warnings to the result if any
  if (validation.warnings) {
    result._warnings = validation.warnings;
  }
  return result;
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
  toStorageContext(scope, 'updatePresentation', {
    actorEmail: opts?.actorEmail,
  });
  // Server-as-collaborator seam: capture the pre-save state first. It is
  // the base the caller's write was computed against, and live-apply's
  // three-way diff needs it to leave concurrent client edits alone.
  const collabEligible =
    opts?.reason !== 'collab' && isCollabLiveEditsEnabled();
  let collabBase = null;
  if (collabEligible) {
    collabBase = await getPresentation(scope, id).catch(() => null);
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

  const write = await withDominantVersion(scope, id, body, collabBase);

  let result;
  try {
    result = await updatePresentationUncached(scope, id, write, opts);
  } finally {
    invalidatePresentationCache(id);
  }
  // Audit every performed slide-level merge (see the write paths, which
  // attach `_slideMerge` to the result). Fire-and-forget; the activity store
  // degrades to a no-op without a database.
  if (result && result.ok !== false && result._slideMerge && opts?.actorEmail) {
    fireAndForget(
      recordSlideLevelMerge({
        presentation: result,
        actorEmail: opts.actorEmail,
        merge: result._slideMerge,
        scope,
      }),
      'slide-level merge audit',
    );
  }
  // Any successful mutation (editor save, public API, MCP tool) refreshes
  // live presenting clients. Fire-and-forget: a no-op without a live session.
  if (result && result.ok !== false) {
    // A write that carried slides authored the types it stored (D247); one
    // that only renamed or re-shared the deck authored nothing.
    if (body?.slides !== undefined || body?.i18n) {
      countInstanceHealth(slideTypeEntries('slide_type.authored', result));
    }
    fireAndForget(
      import('../live-sessions/index.js').then((m) =>
        m.notifyDeckUpdatedForPresentation(scope, id),
      ),
      'live-session deck refresh after save',
    );
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
      fireAndForget(
        deleteYDocState(scope, id),
        'collab Y.Doc invalidation after save',
      );
    }
  }
  return result;
}

/**
 * A write body that names the deck's top-level `title`/`slides` but no `i18n`,
 * extended with the language versions so the dominant one carries the write
 * (B740).
 *
 * The top level of a deck is a projection of its dominant version: every read
 * answers it that way, and `normalizeI18n` re-projects it on every write that
 * carries `i18n`. A body without `i18n` (a PUT from a script or agent, the
 * notes companion's `{ slides }`) used to skip that step and store new
 * top-level slides beside the old `versions[dominant]`. Whatever reads the
 * versions (the editor, the collab bootstrap) then showed the old deck and
 * wrote it back. Without `i18n` the body is unambiguous, which is why this can
 * live in the seam where D320 (6) could not: the top level is the dominant
 * buffer, so `dominantSlidesBody` writes it there and keeps `active`.
 *
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} id
 * @param {Object} body - The caller's write body.
 * @param {Object|null} stored - The deck as stored, when already loaded.
 * @returns {Promise<Object>} The body to store.
 */
async function withDominantVersion(scope, id, body, stored) {
  if (!body || typeof body !== 'object' || body.i18n !== undefined) return body;
  if (body.slides === undefined && typeof body.title !== 'string') return body;
  const pres = stored || (await getPresentation(scope, id).catch(() => null));
  if (!pres?.i18n?.versions) return body;
  const title = typeof body.title === 'string' ? body.title : pres.title;
  const slides = body.slides !== undefined ? body.slides : pres.slides;
  return { ...body, ...dominantSlidesBody({ ...pres, title }, slides) };
}

async function updatePresentationUncached(scope, id, body, opts) {
  const ctx = toStorageContext(scope, 'updatePresentation', {
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
  // Which slide types count as registered is an organization question: the
  // org's published DB-backed custom types (`custom-<slug>`) are as valid as a
  // core one, and cannot live in the process-wide registry. The seam takes the
  // map as an argument, so the facade — which knows the organization — builds
  // it here, with the same builder every server-side read path uses. Costs one
  // indexed SELECT, and only on a write that actually carries slides (B129).
  const touchesSlides = normalized.slides !== undefined || !!normalized.i18n;
  const slideTypes = touchesSlides
    ? await buildMergedSlideTypes(scope)
    : undefined;
  if (normalized.slides !== undefined) {
    // `id` rather than `body.id`: the deck being written is the one the route
    // addressed, and a `presentation-id` instance key caches exactly that.
    normalized.slides = normalizeSlides(normalized.slides, {
      presentationId: id,
      slideTypes,
    });
  }
  normalizeI18n(normalized, { slideTypes });

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
      await updatePresentationRow(id, normalized, ctx, opts, {
        repoRoot: repoRootOf(scope),
        storageScope: scope,
      }),
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
    await updatePresentationRow(id, normalized, ctx, opts, {
      repoRoot: repoRootOf(scope),
      storageScope: scope,
    }),
  );
}

/**
 * Move a presentation to the trash.
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} id
 * @param {Object} [opts]
 */
export async function deletePresentation(scope, id, opts) {
  const ctx = toStorageContext(scope, 'deletePresentation', {
    actorEmail: opts?.actorEmail,
  });
  try {
    return await deletePresentationRow(id, ctx);
  } finally {
    invalidatePresentationCache(id);
    // Trash/restore round-trips must not resurrect a stale collab doc.
    // Unconditional for the same reason as in updatePresentation.
    fireAndForget(
      deleteYDocState(scope, id),
      'collab Y.Doc invalidation after delete',
    );
  }
}

/**
 * Restore a presentation out of the trash.
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} id
 * @returns {Promise<{ok: true, presentation: Object}|{ok: false, reason: string}>}
 *   `not_found` when no trashed deck with that id lives in this organization.
 */
export async function restorePresentation(scope, id) {
  try {
    const ctx = toStorageContext(scope, 'restorePresentation');
    return await restorePresentationRow(id, ctx);
  } finally {
    invalidatePresentationCache(id);
  }
}

/**
 * Delete the database record of a trashed presentation. Dependants ride the
 * `ON DELETE CASCADE` foreign keys; the deck's rasters do not, which is why
 * this is the *record* half only. Callers want
 * `server/services/permanent-delete.js#permanentlyDeletePresentation`.
 *
 * Only a deck that is in the trash can be erased. With `trashedBefore` the
 * DELETE additionally requires `trashed_at <= trashedBefore`, so a deck
 * restored and trashed again after a caller picked it keeps its fresh window.
 *
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} id
 * @param {Object} [options]
 * @param {string} [options.trashedBefore] - ISO timestamp; only delete a deck
 *   trashed at or before it.
 * @returns {Promise<{ok: true}|{ok: false, reason: string}>}
 *   `not_found` when no deck with that id lives in this organization,
 *   `not_trashed` when it does but is not in the trash, `not_due` when it is
 *   trashed but after `trashedBefore`.
 */
export async function deletePresentationRecord(
  scope,
  id,
  { trashedBefore } = {},
) {
  try {
    const ctx = toStorageContext(scope, 'deletePresentationRecord');
    return await deletePresentationRecordRow(id, ctx, { trashedBefore });
  } finally {
    invalidatePresentationCache(id);
  }
}

/**
 * List the decks trashed at or before `cutoffIso`, for the retention sweep.
 * Returns the organization alongside each id: the sweep reads across
 * organizations because retention is instance configuration, but every purge
 * it then performs is scoped to the organization the deck came from.
 *
 * @param {import('../scope.js').StorageScope} scope - A cross-organization scope.
 * @param {string} cutoffIso - ISO timestamp; decks trashed at or before it are due.
 * @returns {Promise<Array<{id: string, organizationId: string, title: string}>>}
 */
export async function listTrashedPresentationsBefore(scope, cutoffIso) {
  const ctx = toStorageContext(
    scope,
    'listTrashedPresentationsBefore',
    {},
    { allowCrossOrganization: true },
  );
  return listTrashedPresentationRowsBefore(cutoffIso, ctx);
}

/**
 * Duplicate a presentation within the scope's organization.
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} id
 * @param {Object} [opts]
 * @returns {Promise<{ok: true, presentation: Object}|{ok: false, reason: string}>}
 *   `not_found` when the source deck is not visible in this organization.
 */
export async function duplicatePresentation(scope, id, opts) {
  const ctx = toStorageContext(scope, 'duplicatePresentation', {
    actorEmail: opts?.actorEmail,
  });
  // A duplicate mints a new deck, so it counts against the guest's sandbox
  // quota — refuse (typed 4xx) once they are at the cap. No-op outside sandbox.
  await assertSandboxQuotaForCreate(ctx, opts?.actorEmail);
  return duplicatePresentationRow(id, ctx);
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
// The (scope, presentationId, ...) signature matches the CRUD helpers above:
// snapshots live in the same organization as the deck they snapshot, so they
// take the same scope.

/**
 * List version snapshots for a presentation (newest first).
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} presentationId
 * @returns {Promise<Array>}
 */
export async function listPresentationVersions(scope, presentationId) {
  const ctx = toStorageContext(scope, 'listPresentationVersions');
  return listPresentationVersionRows(presentationId, ctx);
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
  return getPresentationVersionRow(presentationId, versionId, ctx);
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
export async function createPresentationVersion(
  scope,
  presentationId,
  pres,
  opts = {},
) {
  const ctx = toStorageContext(scope, 'createPresentationVersion', {
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
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} presentationId
 * @param {Object} [opts]
 * @param {number} [opts.keep]
 * @returns {Promise<*>}
 */
export async function prunePresentationVersions(
  scope,
  presentationId,
  opts = {},
) {
  const ctx = toStorageContext(scope, 'prunePresentationVersions');
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
 *
 * A snapshot is a stored deck like any other, so it leaves storage through the
 * same funnel as `getPresentation`: preview, compare and restore all read the
 * shape this build renders. A snapshot taken before a fold (the numbered
 * text-blocks rows, B452) would otherwise reach a renderer that no longer
 * reads the old shape.
 * @param {object} row - Database row
 * @param {import('../display-identity.js').DisplayNameLookup} [lookup] -
 *   Resolved display names; omitted derives them from the stored address.
 * @returns {object}
 */
export function mapVersionRowFull(row, lookup = NO_DISPLAY_NAMES) {
  return {
    ...mapVersionRowSummary(row, lookup),
    presentation: migratePresentation(row.presentation_data),
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
    extensions: row.extensions || [],
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
  return resolveDisplayNames(
    crossOrganizationScope(
      null,
      'global identity display and stable user identifier lookup',
    ),
    [
      { id: row?.updated_by_user_id, email: row?.updated_by },
      { id: row?.created_by_user_id, email: row?.created_by },
      { id: row?.trashed_by_user_id, email: row?.trashed_by },
    ],
  );
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
  // D200: `owner_email` (and the creator/last-writer stamps beside it) is
  // normalised here, on write, so every read compares it bare.
  const ownerEmail = normalizeEmail(data.ownerEmail || ctx?.actorEmail);

  // Dual-key (T10 PR 3): stamp the stable user_id beside each email column.
  // At create the owner is also the creator and last writer, so all three
  // email columns hold `ownerEmail` and all three id columns resolve from
  // it — one lookup. A known user maps to their users.id; an owner with no
  // users row resolves `external` and stays NULL (the pinned legacy path).
  // Reads still key on the email; this only populates the columns a later
  // PR moves the ownership reads onto.
  const ownerResolution = await resolveIdentityByEmail(ctx, ownerEmail);
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
      extensions: jsonb(extensionNames(data.extensions ?? [])),
      lang: data.lang || DEFAULT_DECK_LANG,
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

  const created = mapPresentationRow(row, await displayNamesFor(row));
  // Every new deck — a create, an import, a duplicate — is written here, so
  // this is where a new deck's types are counted as authored (D247).
  countInstanceHealth(slideTypeEntries('slide_type.authored', created));
  return created;
}

/**
 * @param {string} id
 * @param {object} data
 * @param {object} ctx - Storage context
 * @param {object} [opts]
 * @param {{ repoRoot?: string|null, storageScope?: Object }} [seam] - what the
 *   facade knows that the row write does not: where the installation's files
 *   are and the caller's scope, for settling background contrast (B627).
 *   Without it nothing is settled.
 */
async function updatePresentationRow(id, data, ctx, opts = {}, seam = {}) {
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
        const activeLang = data?.i18n?.active;
        if (
          activeLang &&
          existing.i18n?.active &&
          activeLang !== existing.i18n.active
        ) {
          throw revisionConflict(STALE_REVISION_MESSAGE, existing);
        }
        if (
          (data.title !== undefined && data.title !== existing.title) ||
          (activeLang &&
            data.i18n?.versions?.[activeLang]?.title !==
              existing.i18n?.versions?.[activeLang]?.title)
        ) {
          throw revisionConflict(STALE_REVISION_MESSAGE, existing);
        }
        const revisionGap =
          Number(existing.revision) - Number(opts.expectedRevision);
        const clientReordered = opts?.clientReordered ?? null;
        const mergeResult = mergeSlidesAtSlideLevel({
          serverSlides:
            existing.i18n?.versions?.[activeLang]?.slides || existing.slides,
          clientSlides:
            data.i18n?.versions?.[activeLang]?.slides || data.slides,
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
          const i18n = mergeTranslationSources(
            existing.i18n,
            data.i18n,
            modifiedSlideIds,
            activeLang,
          );
          if (i18n?.versions?.[activeLang]) {
            i18n.versions[activeLang] = {
              ...i18n.versions[activeLang],
              slides: mergeResult.slides,
            };
          }
          data = {
            ...data,
            slides:
              i18n?.versions?.[i18n.dominant]?.slides || mergeResult.slides,
            i18n,
          };
        } else if (mergeResult.conflicts.length > 0) {
          throw revisionConflict(
            'Conflict: the same slides were modified by multiple users.',
            existing,
            { conflictingSlides: mergeResult.conflicts },
          );
        } else {
          throw revisionConflict(STALE_REVISION_MESSAGE, existing);
        }
      } else {
        throw revisionConflict(STALE_REVISION_MESSAGE, existing);
      }
    }
  }

  // Slide-lock policy (shared with the file-mode CRUD path): only
  // authors may toggle lockedByAuthor, and content edits/deletes on
  // locked slides are rejected with 423. Runs after the slide-level
  // merge above so stale client copies of other users' slides don't
  // read as edits.
  await enforceSlideWritePolicy(seam.storageScope, {
    existing,
    nextSlides: data.slides,
    nextI18nVersions: data?.i18n?.versions || null,
    user: opts?.user || null,
    actorUserId: ctx?.actorUserId || null,
    bypassLockCheck: !!opts?.bypassLockCheck,
  });

  // Text colour over a background image (B627). After the lock policy, not
  // before: the verdict is derived from the image, not authored, and must
  // not read as an edit of a slide someone else holds or the author locked.
  // A save that came from the collab doc is the editor's own, which measures
  // in the browser; settling it here would only fork the JSON from the doc.
  if ((data.slides !== undefined || data.i18n) && opts?.reason !== 'collab') {
    const themeId =
      (opts?.allowThemeChange && data.theme) || existing.theme || null;
    await settleBgTextContrast(data, {
      repoRoot: seam.repoRoot ?? null,
      loadTheme: () =>
        loadDeckTheme(seam.repoRoot, themeId, seam.storageScope ?? ctx),
    });
  }

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
    const updatedByResolution = await resolveIdentityByEmail(
      ctx,
      updatedByEmail,
    );
    updateData.updated_by = normalizeEmail(updatedByEmail);
    updateData.updated_by_user_id = updatedByResolution?.userId ?? null;
  }
  if (data.title !== undefined) updateData.title = data.title;
  if (data.extensions !== undefined)
    updateData.extensions = jsonb(extensionNames(data.extensions));
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
    const ownerResolution = await resolveIdentityByEmail(ctx, data.ownerEmail);
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
  const trashedByEmail = normalizeEmail(ctx?.actorEmail);
  const trashedByResolution = trashedByEmail
    ? await resolveIdentityByEmail(ctx, trashedByEmail)
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
 * Delete the record of a trashed presentation. Every condition the caller
 * relies on lives in the DELETE itself, so no state read before it can go
 * stale: the row goes only while it is still trashed and, when the caller
 * names a `trashedBefore`, still trashed no later than that. The follow-up
 * read runs on the failing path only, to name which condition refused.
 * @param {string} id - Presentation ID
 * @param {object} ctx - Storage context
 * @param {Object} [options]
 * @param {string} [options.trashedBefore] - ISO timestamp; only delete a deck
 *   trashed at or before it.
 * @returns {Promise<{ok: true}|{ok: false, reason: string}>}
 */
async function deletePresentationRecordRow(id, ctx, { trashedBefore } = {}) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  let deletion = db
    .deleteFrom('presentations')
    .where('id', '=', id)
    .where('organization_id', '=', orgId)
    .where('trashed_at', 'is not', null);
  if (trashedBefore) {
    deletion = deletion.where('trashed_at', '<=', trashedBefore);
  }

  const result = await deletion.executeTakeFirst();
  if (result.numDeletedRows > 0) return { ok: true };

  const existing = await db
    .selectFrom('presentations')
    .select(['id', 'trashed_at'])
    .where('id', '=', id)
    .where('organization_id', '=', orgId)
    .executeTakeFirst();

  if (!existing) return { ok: false, reason: 'not_found' };
  if (!existing.trashed_at) return { ok: false, reason: 'not_trashed' };
  return { ok: false, reason: 'not_due' };
}

/**
 * Decks trashed at or before `cutoffIso`, across every organization — the
 * retention sweep's candidate list. Deliberately unscoped as a *read*: the
 * retention window is instance configuration, not an organization's setting.
 * Each id comes back with its organization so the purge that follows is
 * organization-scoped again (server/storage/scope.js § cross-organization).
 * @param {string} cutoffIso - ISO timestamp
 * @param {object} _ctx - Storage context (cross-organization)
 * @returns {Promise<Array<{id: string, organizationId: string, title: string}>>}
 */
async function listTrashedPresentationRowsBefore(cutoffIso, _ctx) {
  const db = getDb();

  const rows = await db
    .selectFrom('presentations')
    .select(['id', 'organization_id as organizationId', 'title'])
    .where('trashed_at', 'is not', null)
    .where('trashed_at', '<=', cutoffIso)
    .orderBy('trashed_at', 'asc')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    title: typeof row.title === 'string' ? row.title : '',
  }));
}

/**
 * @param {string} id
 * @param {object} ctx - Storage context
 * @returns {Promise<{ok: true, presentation: Object}|{ok: false, reason: string}>}
 */
async function duplicatePresentationRow(id, ctx) {
  // A copy is a read followed by a new write: use the same canonical shape
  // a normal deck read answers, including every language version (B800).
  const existing = migratePresentation(await getPresentationRow(id, ctx));
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
  const newI18n = existing.i18n ? structuredClone(existing.i18n) : {};
  if (newI18n.versions) {
    for (const [lang, version] of Object.entries(newI18n.versions)) {
      if (version?.slides) {
        const slides = mapSlides(version.slides);
        const translationSources = {};
        for (const [key, source] of Object.entries(
          version.translationSources || {},
        )) {
          const oldId = translationKeySlideId(key);
          if (oldId === null) {
            translationSources[key] = source;
          } else if (slideIdMap.has(oldId)) {
            const [, path] = JSON.parse(key);
            translationSources[
              translationFieldKey(slideIdMap.get(oldId), path)
            ] = source;
          }
        }
        newI18n.versions[lang] = {
          ...version,
          slides,
          ...(version.translationSources ? { translationSources } : {}),
        };
      }
    }
  }

  // The copy is named a copy in every language version, not only top-level:
  // the top level is a projection of the dominant version, so the first save
  // re-derived it from an unprefixed version title and the copy got its
  // source's name back (B816). Each version keeps its own title, prefixed in
  // its own language; a version without a title of its own stays without.
  const copyPrefix = (lang) => (lang === 'en-GB' ? 'Copy of ' : 'Kopie van ');
  const lang = existing.i18n?.dominant || existing.lang || DEFAULT_DECK_LANG;
  const newTitle = copyPrefix(lang) + existing.title;
  for (const [versionLang, version] of Object.entries(newI18n.versions || {})) {
    if (typeof version?.title === 'string' && version.title) {
      newI18n.versions[versionLang] = {
        ...version,
        title: copyPrefix(versionLang) + version.title,
      };
    }
  }

  // Mint the copy's id here rather than leaving it to the insert: the slides
  // are rekeyed against it (a follow-invite slide's QR code has to point at the
  // copy, not at the deck it was copied from).
  const duplicate = rekeyNewDeckSlides({
    id: crypto.randomUUID(),
    title: newTitle,
    theme: existing.theme,
    extensions: existing.extensions,
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
    // (see listPresentationRows in ./deck-list.js and
    // docs/reference/storage-layer.md § List reads). bulk-export walks this
    // per deck, so a cap truncated the backup of any deck with >100 saved
    // versions.
    .execute();

  const displayNames = await resolveDisplayNames(
    ctx,
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
  return resolveDisplayNames(
    crossOrganizationScope(
      null,
      'global identity display and stable user identifier lookup',
    ),
    [{ id: row?.created_by_user_id, email: row?.created_by }],
  );
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
  const createdByEmail = normalizeEmail(ctx?.actorEmail);
  const createdByResolution = createdByEmail
    ? await resolveIdentityByEmail(ctx, createdByEmail)
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
// The `__` prefix marks it internal/test-only, like `__setTestDb`;
// production code calls the exported facade.
export const __store = {
  getPresentationRow,
  listPresentationRows: __deckList.listPresentationRows,
  createPresentationRow,
  updatePresentationRow,
};

export { listDecks, listPresentations } from './deck-list.js';

export { listTrashedDecks } from './trash-list.js';

export { getYDocState, setYDocState } from './ydocs.js';

export { getSandboxTotalBytes, sandboxMaxTotalBytes } from './sandbox-quota.js';

export { getPresentationCached } from './cache.js';

export { updateSlideNotes } from './slide-notes.js';

export { clearPublishedOgImageUrl } from './published-preview.js';

export {
  createComment,
  getComment,
  resolveComment,
  markThreadsRead,
  getOpenCommentCount,
  getCommentCountsBySlide,
  getCommentAuthorEmail,
  getThreadParticipants,
  listComments,
  listRecentCommentsOnDecks,
  updateComment,
  deleteComment,
  reopenComment,
  dismissComment,
} from './comments.js';

export {
  getSubscription,
  setSubscription,
  SUBSCRIPTION_LEVELS,
  listSubscriptions,
} from './subscriptions.js';

export { transferPresentationOwnership } from './ownership.js';

export {
  normalizeLang,
  refuseNonCanonicalVersionKeys,
  TRANSLATION_LANGS,
} from './i18n.js';

export {
  getPublishedPresentationIds,
  getCollaboratorCounts,
} from './list-metadata.js';
export { getPopularPresentationRows } from './list-metadata.js';
