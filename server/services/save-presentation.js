/**
 * Save a deck — the one way a whole deck is written by someone who asked to,
 * decided and done in one place (A7.4, B608).
 *
 * Two contracts saved a deck and decided on their own. The public
 * `PUT /api/v1/presentations/:id` loaded the deck, dropped `ownerEmail` and
 * `createdBy` from the body without a word, refused another `lang`, sent a
 * theme switch to {@link changeTheme} (which loaded the deck a second time)
 * and otherwise handed the body to storage raw: a storage refusal
 * (`{ ok:false }`, a deck over the size limit) came back as a 200 with the
 * refusal for a presentation. The editor's `PUT /api/presentations/:id`
 * passed the optimistic-lock and slide-merge options, left the activity rows
 * and told the other open editors; v1 did neither. Now both contracts parse
 * and answer, and everything a save means happens here:
 *
 *   - the deck is loaded once with {@link loadPresentationForActor} at
 *     `access: 'write'` (404 absent, 403 not writable; D255);
 *   - what a save may not carry is refused before any work, with 400
 *     `invalid` + `details.field` (lesson 3): a retired field name, an owner or
 *     creator other than the deck's own (the same value echoed back from a
 *     read is not a claim and is dropped), and another `lang` (a language is
 *     added as a version through translate);
 *   - another `theme` is a theme switch, done by {@link applyThemeChange} on
 *     the deck already loaded;
 *   - the store's result goes through {@link throwStorageFailure} (D254);
 *   - and every save leaves the same trail: the activity row, the bell for a
 *     slide added, the broadcast to open editors and the deck-grid warm.
 *
 * What holds for every writer (the optimistic lock and slide-level merge,
 * slide locks, normalization, size limits) stays in the storage facade
 * (D252); the merge options are input only the editor's contract has.
 *
 * @module server/services/save-presentation
 */

import { updatePresentation } from '../storage/presentations/index.js';
import { normalizeLang } from '../../shared/i18n-utils.js';
import {
  AppError,
  NotFoundError,
  throwStorageFailure,
} from '../utils/errors.js';
import { fireAndForget } from '../utils/fire-and-forget.js';
import { createLogger } from '../utils/logger.js';
import { scheduleDeckThumbnailWarm } from '../render/deck-thumbnail-warm.js';
import {
  loadPresentationForActor,
  refuseRetiredDeckFields,
} from './presentations.js';
import { applyThemeChange } from './theme.js';
import {
  recordPresentationUpdated,
  recordSlidesAdded,
} from './activity-events.js';
import { notifyDeckActivity } from './deck-activity-notifications.js';
import {
  broadcastToPresentation,
  PresentationEventTypes,
} from './comment-events.js';

const log = createLogger('save-presentation');

/**
 * @typedef {import('./actor.js').Actor} Actor
 * @typedef {import('../storage/scope.js').StorageScope} StorageScope
 */

/**
 * Ids of slides this actor added in a save: present in the submitted deck,
 * absent from the pre-save deck, and surviving into the saved result. Diffing
 * the *submitted* slides (not the merged result) keeps a concurrent editor's
 * merge-appended slides out of this actor's "added" set, and intersecting with
 * the result drops slides the merge rejected.
 *
 * @param {Array<{id?: string}>} existingSlides - deck before the save
 * @param {Array<{id?: string}>} submittedSlides - deck the caller sent
 * @param {Array<{id?: string}>} updatedSlides - deck after the save
 * @returns {string[]} newly added slide ids (deduped, order of first appearance)
 */
export function diffAddedSlideIds(
  existingSlides,
  submittedSlides,
  updatedSlides,
) {
  const ids = (arr) =>
    (Array.isArray(arr) ? arr : []).map((s) => s?.id).filter(Boolean);
  const existingIds = new Set(ids(existingSlides));
  const updatedIds = new Set(ids(updatedSlides));
  const seen = new Set();
  const added = [];
  for (const sid of ids(submittedSlides)) {
    if (existingIds.has(sid) || !updatedIds.has(sid) || seen.has(sid)) continue;
    seen.add(sid);
    added.push(sid);
  }
  return added;
}

/**
 * @param {string} field
 * @param {string} message
 * @returns {AppError} 400 `invalid` naming the field.
 */
function invalidSave(field, message) {
  return new AppError(message, 400, { field }, 'invalid');
}

/**
 * Whether `value` names the deck's own owner: absent or `null` (a v1 read
 * redacts the address for anyone but the owner), or the stored address in any
 * case.
 */
function isOwnOwner(value, pres) {
  if (value == null) return true;
  return (
    typeof value === 'string' &&
    !!pres.ownerEmail &&
    value.toLowerCase() === String(pres.ownerEmail).toLowerCase()
  );
}

/**
 * Whether `value` names the deck's own creator: absent or `null`, or the
 * display pair a read hands out (`{ id, displayName }`, D22) with the stored id.
 */
function isOwnCreator(value, pres) {
  if (value == null) return true;
  return (
    typeof value === 'object' &&
    (value.id ?? null) === (pres.createdBy?.id ?? null)
  );
}

/**
 * Refuse what a save may not carry, before any work. A save never moves the
 * owner or the creator and never changes the deck language; a caller that
 * sends one of those back as it read it is not asking to, and the field is
 * dropped. A different value is a request the save cannot honour, so it is
 * refused instead of dropped (lesson 3).
 *
 * @param {Object} pres - The deck as loaded.
 * @param {Object} changes - The caller's body.
 * @returns {Object} The changes without the echoed read-only fields.
 * @throws {AppError} 400 `invalid`, `details.field` naming the field.
 */
function assertSavableChanges(pres, changes) {
  refuseRetiredDeckFields(changes);
  if (!isOwnOwner(changes.ownerEmail, pres)) {
    throw invalidSave(
      'ownerEmail',
      'ownerEmail cannot be changed by a save: transfer ownership instead',
    );
  }
  if (!isOwnCreator(changes.createdBy, pres)) {
    throw invalidSave('createdBy', 'createdBy cannot be changed');
  }
  if (
    changes.lang !== undefined &&
    changes.lang !== pres.lang &&
    normalizeLang(changes.lang) !== pres.lang
  ) {
    throw invalidSave(
      'lang',
      'lang cannot be changed: add a language version with POST /presentations/{id}/translate',
    );
  }
  const { ownerEmail: _owner, createdBy: _creator, ...savable } = changes;
  return savable;
}

/**
 * The trail every save leaves, whoever asked: the activity row (a slide-add
 * for any visibility, since it is the collaborator-awareness signal; a plain
 * update only for an organization-visible deck, to keep the feed quiet), the
 * bell for the deck's people when slides were added, the broadcast that lets
 * open editors know, and the deck-grid raster warm when slide 1 changed.
 */
function leaveSaveTrail(scope, actor, { before, submitted, after, merge }) {
  if (actor?.email) {
    const submittedSlides = Array.isArray(submitted?.slides)
      ? submitted.slides
      : after.slides;
    const addedSlideIds = diffAddedSlideIds(
      before.slides,
      submittedSlides,
      after.slides,
    );
    if (addedSlideIds.length > 0) {
      fireAndForget(
        recordSlidesAdded({
          presentation: after,
          actor,
          slideIds: addedSlideIds,
          scope,
        }),
        'record slides-added activity',
      );
      // Coalesced per actor within the debounce window; the actor never
      // notifies themselves.
      fireAndForget(
        notifyDeckActivity({
          presentation: after,
          actor,
          slideCount: addedSlideIds.length,
          scope,
        }),
        'deck-activity notification fan-out',
      );
    } else if (after.visibility === 'organization') {
      fireAndForget(
        recordPresentationUpdated({
          presentation: after,
          actor,
          changes: { titleChanged: before.title !== after.title },
          scope,
        }),
        'record presentation-updated activity',
      );
    }
  }

  try {
    broadcastToPresentation(after.id, PresentationEventTypes.UPDATED, {
      revision: after.revision,
      modifiedSlideIds: merge.modifiedSlideIds || [],
      // Who saved, as the only key that identifies anyone: the receiving
      // editor compares it against its own user to skip its own saves
      // (shared/identity-match.js). No display name, no address (D22).
      actorId: actor?.id || null,
    });
  } catch (err) {
    // SSE is best-effort: a failed broadcast never fails the save.
    log.warn('save broadcast failed:', err?.message || err);
  }

  scheduleDeckThumbnailWarm({ scope, before, after });
}

/**
 * Save a deck for an actor, on every contract.
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {{ actor: Actor }} identity - The saving actor (D253).
 * @param {Object} input
 * @param {string} input.presentationId
 * @param {Object} input.changes - The deck fields to write (a PUT body).
 * @param {number} [input.expectedRevision] - The revision the caller's copy is
 *   based on (the editor's `If-Match`); absent, the write is not
 *   revision-checked.
 * @param {string[]|null} [input.modifiedSlideIds] - Slides the caller changed,
 *   for the slide-level merge when the revision has moved on.
 * @param {Object<string,string>|null} [input.slideBaseFingerprints] - Base
 *   fingerprint per modified slide (shared/slide-fingerprint.js).
 * @param {boolean|null} [input.clientReordered] - Whether the caller reordered
 *   slides since its base; `false` keeps the stored order in a merge.
 * @returns {Promise<Object>} The deck as stored after the save.
 * @throws {NotFoundError} No deck with this id in this scope.
 * @throws {import('../utils/errors.js').ForbiddenError} The actor may not write the deck.
 * @throws {AppError} 400 `invalid` naming a refused field; a storage refusal
 *   (409 `conflict` on a stale revision, 423 on a locked slide, 409
 *   `limit_exceeded` over the size limit).
 */
export async function savePresentation(
  scope,
  identity,
  {
    presentationId,
    changes,
    expectedRevision,
    modifiedSlideIds = null,
    slideBaseFingerprints = null,
    clientReordered = null,
  },
) {
  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'write',
  });
  const savable = assertSavableChanges(pres, changes || {});
  const { actor } = identity;

  let updated;
  // Another `theme` is a theme switch, with the one path a switch has; the
  // same theme echoed back is a plain save.
  if (savable.theme !== undefined && savable.theme !== pres.theme) {
    updated = await applyThemeChange(scope, identity, pres, {
      theme: savable.theme,
      changes: savable,
    });
  } else {
    updated = await updatePresentation(scope, pres.id, savable, {
      expectedRevision,
      actorEmail: actor?.email || null,
      user: actor || null,
      modifiedSlideIds,
      slideBaseFingerprints,
      clientReordered,
    });
    if (!updated) throw new NotFoundError('Presentation not found');
    if (updated.ok === false) {
      throwStorageFailure(
        updated,
        updated.errors
          ?.map((error) => error.message)
          .filter(Boolean)
          .join('; ') || undefined,
      );
    }
  }

  leaveSaveTrail(scope, actor, {
    before: pres,
    submitted: savable,
    after: updated,
    merge: { modifiedSlideIds },
  });
  return updated;
}
