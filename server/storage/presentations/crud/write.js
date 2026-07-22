/**
 * CRUD write operations - create and update presentations.
 */

import { validatePresentation } from '../../../../shared/slide-schemas.js';
import { normalizeSlides } from '../slides.js';
import { normalizeI18n } from '../i18n.js';
import { writePresentation } from '../io.js';
import { normalizePresentationScope } from '../../../utils/presentation-authz.js';
import {
  createPresentationVersion,
  listPresentationVersions,
  prunePresentationVersions,
} from '../versions.js';
import { attachSandboxMeta } from '../sandbox.js';
import { sandboxEnabled } from '../../../config/sandbox.js';
import { listThemeIds } from '../../../utils/themes.js';
import { getPresentationLock } from '../../../utils/presentation-locks.js';
import { getDefaultOrganizationId } from '../../../config/database.js';
import { normalizeEmail, nowIso } from '../../../utils/normalize.js';
import { ConflictError, ValidationError } from '../../../utils/errors.js';
import { getPresentation } from './read.js';
import { prepareNewPresentation } from './factory.js';
import { enforceSlideWritePolicy } from './enforce-slide-locks.js';
import {
  normalizeMeta,
  conflictError,
  lockedError,
  useEnforcedLocks,
  mergeSlidesAtSlideLevel,
} from './helpers.js';

/**
 * Get allowed themes for validation.
 */
async function allowedThemesForValidation(repoRoot, { include = [] } = {}) {
  const ids = await listThemeIds(repoRoot);
  const filtered = sandboxEnabled()
    ? ids.filter((id) => String(id).startsWith('sandbox-'))
    : ids;
  const set = new Set(['default', ...filtered]);
  for (const t of include) {
    const s = typeof t === 'string' ? t.trim() : '';
    if (s) set.add(s);
  }
  return Array.from(set);
}

// Reasons that bypass throttle and always create a snapshot
const UNTHROTTLED_SNAPSHOT_REASONS = new Set([
  'session_end',
  'manual',
  'restore',
  'pre_restore',
]);

// Safety net: create at most 1 autosave snapshot per 30 minutes during active editing
const AUTOSAVE_THROTTLE_MS = 30 * 60 * 1000;

/**
 * Maybe create an automatic snapshot (version) of the presentation.
 * - 'autosave' reason: throttled to 1 per 30 min (crash recovery safety net)
 * - 'session_end', 'manual', 'restore', 'pre_restore': always created
 */
async function maybeAutoSnapshot(repoRoot, pres, { actorEmail = null, reason = 'autosave' } = {}) {
  try {
    const pid = String(pres?.id || '').trim();
    if (!pid) return;

    // Only throttle autosave snapshots; other reasons always create a snapshot
    if (!UNTHROTTLED_SNAPSHOT_REASONS.has(reason)) {
      const existing = await listPresentationVersions(repoRoot, pid);
      const last = existing?.[0] || null;
      const lastCreated = last?.created ? new Date(last.created).getTime() : 0;
      if (lastCreated && Date.now() - lastCreated < AUTOSAVE_THROTTLE_MS) return;
    }

    await createPresentationVersion(repoRoot, pid, pres, {
      actorEmail,
      reason,
    });
    // Apply tiered pruning after creating snapshot
    await prunePresentationVersions(repoRoot, pid);
  } catch {
    // snapshots are best-effort; never fail saves because versioning failed
  }
}

/**
 * Create a new presentation.
 * @param {string} repoRoot - Repository root path
 * @param {Object} body - Presentation data
 * @returns {Promise<Object>} Created presentation
 */
export async function createPresentation(repoRoot, body) {
  const pres = await prepareNewPresentation(repoRoot, body);
  await writePresentation(repoRoot, pres);
  return pres;
}

/**
 * Update an existing presentation.
 * @param {string} repoRoot - Repository root path
 * @param {string} id - Presentation ID
 * @param {Object} body - Updated presentation data
 * @param {Object} opts - Options (expectedRevision, modifiedSlideIds, actorEmail, etc.)
 * @returns {Promise<Object|null>} Updated presentation or null
 */
export async function updatePresentation(repoRoot, id, body, opts = {}) {
  const existing = await getPresentation(repoRoot, id);
  if (!existing) return null;
  normalizeMeta(existing);

  const expectedRevisionRaw = opts?.expectedRevision;
  const expectedRevision =
    expectedRevisionRaw == null ? null : Number(expectedRevisionRaw);
  const hasRevisionConflict =
    expectedRevision != null &&
    Number.isFinite(expectedRevision) &&
    Number(existing.revision) !== expectedRevision;

  // Slide-level merge: when there's a conflict and client provides modifiedSlideIds,
  // try to merge non-overlapping changes instead of failing
  let mergedSlides = null;
  let mergeInfo = null;
  if (hasRevisionConflict) {
    const modifiedSlideIds = Array.isArray(opts?.modifiedSlideIds) ? opts.modifiedSlideIds : null;
    if (modifiedSlideIds && modifiedSlideIds.length >= 0) {
      // Attempt slide-level merge
      const revisionGap = Number(existing.revision) - expectedRevision;
      const clientReordered = opts?.clientReordered ?? null;
      const mergeResult = mergeSlidesAtSlideLevel({
        serverSlides: existing.slides,
        clientSlides: body.slides,
        modifiedSlideIds,
        baseFingerprints: opts?.slideBaseFingerprints || null,
        revisionGap,
        clientReordered,
      });
      if (mergeResult.merged && mergeResult.conflicts.length === 0) {
        mergedSlides = mergeResult.slides;
        mergeInfo = {
          revisionGap,
          modifiedSlideIds,
          appendedSlideIds: mergeResult.appendedSlideIds || [],
          clientReordered,
        };
      } else if (mergeResult.conflicts.length > 0) {
        // There are true conflicts - throw error with details
        throw new ConflictError(
          'Conflict: the same slides were modified by multiple users.',
          {
            id: existing?.id,
            revision: existing?.revision,
            modified: existing?.modified,
            updatedBy: existing?.updatedBy || null,
            conflictingSlides: mergeResult.conflicts,
          }
        );
      }
    }
    // If no modifiedSlideIds provided, fall back to traditional conflict
    if (!mergedSlides) {
      throw conflictError(existing);
    }
  }

  // Lock enforcement: when USE_DB_LOCKS is enabled, check if another user holds the lock.
  // Skip lock check if bypassLockCheck is set (used for internal operations like restores).
  if (useEnforcedLocks() && !opts?.bypassLockCheck) {
    const actorEmail = normalizeEmail(opts?.actorEmail);
    const ctx = { organizationId: getDefaultOrganizationId() };
    const lock = await getPresentationLock(id, ctx);
    if (lock && lock.holderEmail && lock.holderEmail !== actorEmail) {
      throw lockedError(lock);
    }
  }

  // We accept the full document from client, but enforce id + timestamps server-side.
  const now = nowIso();
  const candidate = {
    ...body,
    id: existing.id,
    created: existing.created,
    modified: now,
    ownerEmail: existing.ownerEmail || null,
    // Themes are chosen at creation/import time and are hard-locked on the
    // shared write path to avoid environment-wide or accidental theme switching.
    // Only an explicit, permission-checked switch (the /change-theme route)
    // opts in via allowThemeChange, mirroring the allowScopeChange escape hatch.
    theme: opts?.allowThemeChange && body?.theme ? body.theme : existing.theme,
  };
  // Preserve sandbox metadata if present (and compute it for sandbox-created docs that predate the field).
  if (existing?.sandbox && typeof existing.sandbox === 'object')
    candidate.sandbox = existing.sandbox;
  attachSandboxMeta(candidate);

  // Collaboration metadata (Phase 1)
  const allowScopeChange = !!opts?.allowScopeChange;
  candidate.scope = allowScopeChange
    ? normalizePresentationScope(candidate.scope)
    : normalizePresentationScope(existing.scope);
  candidate.createdBy = existing.createdBy || existing.ownerEmail || null;
  candidate.updatedBy = normalizeEmail(opts?.actorEmail) || existing.updatedBy || existing.ownerEmail || null;
  const prevRev = Number(existing.revision) || 1;
  candidate.revision = prevRev + 1;

  // Normalize slides and i18n versions (if present).
  // Use merged slides if we performed a slide-level merge
  candidate.slides = normalizeSlides(mergedSlides || candidate.slides);
  normalizeI18n(candidate);

  // Slide-lock policy (shared with the Postgres adapter): only authors may
  // toggle lockedByAuthor, and content edits/deletes on locked slides are
  // rejected with 423. Runs after merge + normalization so per-slide diffs
  // compare like with like. Saves are whole-presentation PUTs, so the
  // policy module diffs per slide to find what actually changed.
  await enforceSlideWritePolicy({
    existing,
    nextSlides: candidate.slides,
    nextI18nVersions: candidate?.i18n?.versions || null,
    user: opts?.user || null,
    actorEmail: normalizeEmail(opts?.actorEmail),
    bypassLockCheck: !!opts?.bypassLockCheck,
    ctx: { organizationId: getDefaultOrganizationId() },
  });

  const v = validatePresentation(candidate, {
    allowedThemes: await allowedThemesForValidation(repoRoot, {
      include: [candidate?.theme],
    }),
  });
  if (!v.ok) {
    throw new ValidationError(`Validation failed: ${v.errors.join('; ')}`);
  }

  await writePresentation(repoRoot, candidate);
  await maybeAutoSnapshot(repoRoot, candidate, {
    actorEmail: normalizeEmail(opts?.actorEmail),
    reason: opts?.reason || (opts?.restoreFromVersionId ? 'restore' : 'autosave'),
  });
  const out = normalizeMeta(candidate);
  // Response-only audit metadata (attached after the write, so it is never
  // persisted): the facade logs it to activity_events.
  if (mergeInfo) out._slideMerge = mergeInfo;
  return out;
}
