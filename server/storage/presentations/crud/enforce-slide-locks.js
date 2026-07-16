/**
 * Server-side slide-lock enforcement for content writes.
 *
 * Saves are whole-presentation PUTs, so enforcement first determines which
 * slides actually changed (per-id canonical compare + deletions) and then
 * rejects the write with a 423 LockedError when a changed slide is
 * author-locked (for non-authors) or concurrently locked by another user.
 *
 * Only used on the collab-live-edits-off path: with live edits on, slide
 * locks are phased out entirely and CRDT writes flow through Hocuspocus.
 */

import { LockedError, ValidationError } from '../../../utils/errors.js';
import { getSlideLocks } from '../../slide-locks.js';
import { isPresentationAuthor } from '../../../utils/presentation-authz.js';
import { isCollabLiveEditsEnabled } from '../../../config/features.js';

/**
 * Canonicalize a JSON value: sort object keys so key order never counts as
 * a content change (client and disk can serialize the same slide in a
 * different key order).
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}

/**
 * Stable signature of a slide's content for change detection.
 * - `lockedByAuthor` is excluded: the flag itself has its own guard
 *   (only authors may toggle it) and a flag change is not a content edit.
 * - `parentId` defaults to null so legacy slides written before the
 *   parentId normalization don't read as changed.
 */
function slideSignature(slide) {
  if (!slide || typeof slide !== 'object') return 'null';
  const { lockedByAuthor, ...rest } = slide;
  rest.parentId =
    typeof rest.parentId === 'string' && rest.parentId.trim()
      ? rest.parentId.trim()
      : null;
  return JSON.stringify(canonical(rest));
}

/**
 * Determine which previously existing slides had their content changed or
 * were deleted. Newly added slides can't be locked and are ignored, as are
 * pure reorders (order doesn't alter any slide's own content).
 *
 * @param {Array} previousSlides - Slides currently stored on the server
 * @param {Array} nextSlides - Slides about to be written (post-merge, normalized)
 * @returns {string[]} IDs of changed or deleted pre-existing slides
 */
export function collectContentChangedSlideIds(previousSlides, nextSlides) {
  const nextById = new Map();
  for (const s of Array.isArray(nextSlides) ? nextSlides : []) {
    if (s && typeof s.id === 'string' && s.id) nextById.set(s.id, s);
  }
  const changed = [];
  for (const prev of Array.isArray(previousSlides) ? previousSlides : []) {
    const id = prev && typeof prev.id === 'string' ? prev.id : '';
    if (!id) continue;
    const next = nextById.get(id);
    if (!next) {
      changed.push(id); // deleted
      continue;
    }
    if (slideSignature(prev) !== slideSignature(next)) changed.push(id);
  }
  return changed;
}

/**
 * Reject the write with a 423 LockedError when a changed slide is locked
 * for the acting user. Two lock kinds:
 * - author lock (`lockedByAuthor` on the stored slide): blocks non-authors
 * - concurrent slide lock (slide_locks table): blocks everyone but the holder
 *
 * @param {Object} opts
 * @param {string} opts.presentationId
 * @param {Array} opts.previousSlides - Slides currently stored on the server
 *   (canonical source for the lockedByAuthor flags; also the main diff pair
 *   against nextSlides — both hold the dominant-language buffer, since
 *   normalizeI18n realigns top-level slides to the dominant version)
 * @param {Array} opts.nextSlides - Slides about to be written
 * @param {Array} [opts.extraPairs] - Additional {previous, next} slide-array
 *   pairs to diff, e.g. the per-language i18n version buffers — edits made
 *   while another language is active only show up there.
 * @param {boolean} opts.isAuthor - Whether the actor is the presentation author
 * @param {string} opts.actorEmail - Normalized (lowercased) actor email
 * @param {Object} opts.ctx - Context with organization info (for lock lookup)
 * @param {Function} [opts.loadSlideLocks] - Injectable lock loader (tests)
 */
export async function enforceSlideLocks({
  presentationId,
  previousSlides,
  nextSlides,
  extraPairs = [],
  isAuthor,
  actorEmail,
  ctx,
  loadSlideLocks = getSlideLocks,
} = {}) {
  const changed = new Set(collectContentChangedSlideIds(previousSlides, nextSlides));
  for (const { previous, next } of extraPairs) {
    for (const id of collectContentChangedSlideIds(previous, next)) changed.add(id);
  }
  const changedIds = Array.from(changed);
  if (!changedIds.length) return;

  if (!isAuthor) {
    const prevById = new Map(
      (previousSlides || [])
        .filter((s) => s && typeof s.id === 'string' && s.id)
        .map((s) => [s.id, s])
    );
    for (const slideId of changedIds) {
      if (prevById.get(slideId)?.lockedByAuthor) {
        throw new LockedError('This slide is locked by the presentation author.', {
          slideId,
          lockKind: 'author',
        });
      }
    }
  }

  // Concurrent slide locks live in the database; without one (file mode)
  // getSlideLocks returns {} and this check is a no-op.
  const locks = await loadSlideLocks(presentationId, ctx);
  const email = typeof actorEmail === 'string' ? actorEmail.toLowerCase() : '';
  for (const slideId of changedIds) {
    const lock = locks?.[slideId];
    if (lock?.holderEmail && lock.holderEmail !== email) {
      const holder = lock.holderName || lock.holderEmail;
      throw new LockedError(`This slide is being edited by ${holder}.`, {
        slideId,
        lockKind: 'concurrent',
        holderEmail: lock.holderEmail,
        holderName: lock.holderName || null,
      });
    }
  }
}

/**
 * Full slide-write policy, shared by the file-mode CRUD path and the
 * Postgres adapter so both storage backends enforce the same rules:
 * 1. only authors (or admins) may toggle lockedByAuthor on a slide, and
 * 2. content edits/deletes on locked slides are rejected (423) — skipped
 *    for internal writes (bypassLockCheck) and when collab live edits are
 *    on (locks are phased out on that path).
 *
 * Call this AFTER any slide-level merge: pre-merge client payloads can
 * carry stale copies of slides other users changed, which would read as
 * edits the actor never made.
 *
 * @param {Object} opts
 * @param {Object} opts.existing - Stored presentation (slides, i18n, owner fields)
 * @param {Array} opts.nextSlides - Normalized slides about to be written (post-merge)
 * @param {Object} [opts.nextI18nVersions] - Candidate i18n.versions (normalized)
 * @param {Object} [opts.user] - Acting user ({ email, isAdmin }) when known
 * @param {string} [opts.actorEmail] - Acting user email (fallback identity)
 * @param {boolean} [opts.bypassLockCheck] - Internal write, skip enforcement
 * @param {Object} opts.ctx - Context with organization info (for lock lookup)
 * @param {Function} [opts.loadSlideLocks] - Injectable lock loader (tests)
 * @returns {Promise<{isAuthor: boolean}>}
 */
export async function enforceSlideWritePolicy({
  existing,
  nextSlides,
  nextI18nVersions = null,
  user = null,
  actorEmail = '',
  bypassLockCheck = false,
  ctx,
  loadSlideLocks = getSlideLocks,
} = {}) {
  const effectiveUser = user || (actorEmail ? { email: actorEmail } : null);
  const isAuthor =
    isPresentationAuthor({ user: effectiveUser, pres: existing }) ||
    !!effectiveUser?.isAdmin;

  // Author lock validation: only authors can change lockedByAuthor on
  // slides. Checked on the canonical (dominant-buffer) slides only: a flag
  // tampered into a non-dominant language buffer can't become canonical
  // without passing through this pair (a dominant switch realigns top-level
  // slides to that buffer, so the mismatch surfaces here), and enforcement
  // below always reads the flags from the stored canonical slides.
  if (!isAuthor && Array.isArray(nextSlides)) {
    const existingSlides = existing?.slides || [];
    const existingLockMap = new Map(existingSlides.map((s) => [s.id, !!s.lockedByAuthor]));
    for (const slide of nextSlides) {
      const existingLock = existingLockMap.get(slide.id) || false;
      if (existingLock !== !!slide.lockedByAuthor) {
        throw new ValidationError('Only the presentation author can lock or unlock slides.');
      }
    }
  }

  if (bypassLockCheck || isCollabLiveEditsEnabled()) return { isAuthor };

  // Top-level slides always hold the dominant-language buffer on both sides
  // (normalizeI18n realigns them), so that pair is stable across language
  // switches. Edits made while another language is active only show up in
  // that language's i18n version buffer, so diff those too. A brand-new
  // language version has no stored baseline (every slide is new by
  // construction) and is skipped.
  const extraPairs = [];
  const existingVersions = existing?.i18n?.versions || {};
  for (const [lang, nextVersion] of Object.entries(nextI18nVersions || {})) {
    const prevSlides = existingVersions?.[lang]?.slides;
    if (
      Array.isArray(prevSlides) &&
      prevSlides.length &&
      Array.isArray(nextVersion?.slides)
    ) {
      extraPairs.push({ previous: prevSlides, next: nextVersion.slides });
    }
  }

  await enforceSlideLocks({
    presentationId: existing.id,
    previousSlides: existing?.slides || [],
    nextSlides,
    extraPairs,
    isAuthor,
    actorEmail: typeof actorEmail === 'string' ? actorEmail.toLowerCase() : '',
    ctx,
    loadSlideLocks,
  });
  return { isAuthor };
}
