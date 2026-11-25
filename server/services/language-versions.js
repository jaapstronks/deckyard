/**
 * Remove a language version from a deck (DY-874).
 *
 * Adding a version is a switch in the editor's language menu; taking one away
 * is this operation, the same one for every caller. It refuses the source
 * version (`i18n.dominant`): that is the version the deck is written in and the
 * one every other version is measured from, so removing it would leave the deck
 * without a language. Move the source first ("Make this the source version")
 * when that is what the author wants.
 *
 * The version history is the safety net. The deck as it was is stored as a
 * version snapshot before anything is written, and a snapshot that cannot be
 * stored stops the removal: a destructive write without its way back is not
 * made. Restoring that snapshot brings every language version back, because a
 * snapshot is the whole deck.
 *
 * A deck open in a collab session hears it like any other server write: the
 * store applies it to the live document (the three-way diff in
 * `applyPresentationToDoc` drops a language the write no longer carries), so
 * every open editor loses the version too.
 */

import {
  createPresentationVersion,
  prunePresentationVersions,
  updatePresentation,
} from '../storage/presentations/index.js';
import { normalizeLang } from '../../shared/i18n-utils.js';
import {
  AppError,
  NotFoundError,
  throwStorageFailure,
} from '../utils/errors.js';
import { fireAndForget } from '../utils/fire-and-forget.js';
import { alignToActiveVersion } from './deck-versions.js';
import { loadPresentationForActor } from './presentations.js';

/**
 * @typedef {import('./actor.js').Actor} Actor
 * @typedef {import('../storage/scope.js').StorageScope} StorageScope
 */

/** The snapshot reason the version history names this backup by. */
export const LANGUAGE_REMOVAL_REASON = 'pre_language_removal';

function invalidRemoval(message) {
  return new AppError(message, 400, { field: 'lang' }, 'invalid');
}

/**
 * Remove one language version from a deck.
 *
 * @param {StorageScope} scope
 * @param {{ actor: Actor }} identity
 * @param {{ presentationId: string, lang: * }} input
 * @returns {Promise<{ lang: string, presentation: Object, versionId: string|null }>}
 *   The removed language, the deck as stored and the backup snapshot's id.
 * @throws {NotFoundError} No deck with this id in this scope.
 * @throws {import('../utils/errors.js').ForbiddenError} The actor may not write the deck.
 * @throws {AppError} 400 `invalid` (field `lang`): an unknown language, one the
 *   deck has no version of, or its source version; a storage refusal.
 */
export async function removeLanguageVersion(
  scope,
  identity,
  { presentationId, lang },
) {
  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'write',
  });
  const target = normalizeLang(lang);
  if (!target) {
    throw invalidRemoval(`Unknown language ${JSON.stringify(lang)}.`);
  }
  const versions =
    pres.i18n?.versions && typeof pres.i18n.versions === 'object'
      ? pres.i18n.versions
      : {};
  if (!versions[target]) {
    throw invalidRemoval(`This presentation has no ${target} version.`);
  }
  if (target === pres.i18n.dominant) {
    throw invalidRemoval(
      'The source version cannot be removed. Make another version the source first.',
    );
  }

  const snapshot = await createPresentationVersion(scope, pres.id, pres, {
    actorEmail: identity.actor?.email || null,
    reason: LANGUAGE_REMOVAL_REASON,
    label: `before removing ${target}`,
  });
  if (!snapshot) throw new NotFoundError('Presentation not found');
  fireAndForget(
    prunePresentationVersions(scope, pres.id),
    'version-history prune after a language-removal backup',
  );

  const next = structuredClone(pres);
  delete next.i18n.versions[target];
  if (next.i18n.translation && typeof next.i18n.translation === 'object')
    delete next.i18n.translation[target];
  if (next.i18n.active === target) next.i18n.active = next.i18n.dominant;

  const updated = await updatePresentation(
    scope,
    pres.id,
    alignToActiveVersion(next),
    {
      actorEmail: identity.actor?.email || null,
      user: identity.actor || null,
      expectedRevision: pres.revision,
    },
  );
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
  return { lang: target, presentation: updated, versionId: snapshot.id };
}
