/**
 * Presentations — the one place a deck is loaded for someone, and the one place
 * a deck is made, on every contract (A7.4, B519, B521).
 *
 * Every by-id deck route used to load and decide on its own: the internal
 * `withPresentationAuth` family with the session user, the public v1
 * `getPresentationWithAccess` with the key owner, MCP's
 * `loadPresentationChecked` with the session owner, and v1's DELETE with a
 * hand-rolled e-mail comparison that ignored `ownerId` (D22) and let any
 * writing key remove a deck without an `ownerEmail`. The deciders underneath
 * were the same; the loading, the order of the checks and the answers were
 * not. Now each contract resolves its own identity, calls
 * {@link loadPresentationForActor} and renders the refusal in its envelope
 * (brief `one-service-layer.md`, D252–D255).
 *
 * The answer is the same on all three contracts (D255):
 *
 *   - **404** (`NotFoundError`) — no deck with this id in the caller's scope.
 *     A deck in another organization is absent, not forbidden: the storage
 *     scope already answers `null` for it.
 *   - **403** (`ForbiddenError`) — the deck is there and the caller may not
 *     read it, or may read it but lacks the right the handling asks for.
 *
 * A deck is created in one place too ({@link createPresentation}, B521). The
 * internal route used to hand its body to storage as it came, v1 refused the
 * retired field names and an unknown `lang` on its own, MCP did neither, and
 * only the internal route left an activity row. Now what one contract refuses,
 * every contract refuses, and every create leaves the same trail.
 *
 * @module server/services/presentations
 */

import {
  getPresentation,
  createPresentation as storeNewPresentation,
} from '../storage/presentations/index.js';
import { recordSlideLibraryUsage } from '../storage/slide-library-usage.js';
import { normalizeLang } from '../../shared/i18n-utils.js';
import {
  canActorAccessPresentation,
  canActorDeletePresentation,
  canActorManageCollaborators,
  canActorCommentOnPresentation,
  canGuestComment,
} from '../utils/presentation-authz/index.js';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  throwStorageFailure,
} from '../utils/errors.js';
import { fireAndForget } from '../utils/fire-and-forget.js';
import { recordPresentationCreated } from './activity-events.js';

/**
 * @typedef {import('./actor.js').Actor} Actor
 * @typedef {import('./actor.js').ServiceIdentity} ServiceIdentity
 * @typedef {import('../storage/scope.js').StorageScope} StorageScope
 * @typedef {'read'|'write'|'delete'|'manage'|'comment'} PresentationAccess
 */

/**
 * What an actor needs for each right, and what a refusal says. Read is the
 * baseline every other right is checked on top of.
 *
 * @type {Record<PresentationAccess, { allows: (pres: Object, actor: Actor) => Promise<boolean>, refusal: string }>}
 */
const ACTOR_RIGHTS = {
  read: {
    allows: (pres, actor) => canActorAccessPresentation(pres, actor, 'read'),
    refusal: 'Access denied to this presentation',
  },
  write: {
    allows: (pres, actor) => canActorAccessPresentation(pres, actor, 'write'),
    refusal: 'You have read-only access to this presentation',
  },
  delete: {
    allows: canActorDeletePresentation,
    refusal: 'Only the presentation owner can delete it',
  },
  manage: {
    allows: canActorManageCollaborators,
    refusal:
      'Only the owner or an admin collaborator can manage this presentation',
  },
  comment: {
    allows: canActorCommentOnPresentation,
    refusal: 'You may not comment on this presentation',
  },
};

/**
 * What a share-link guest may do with a deck: read the deck their link names,
 * and comment when the link grants it. Nothing else — a guest never writes,
 * deletes or manages.
 *
 * @param {Object} pres
 * @param {import('./actor.js').GuestIdentity} identity
 * @param {PresentationAccess} access
 * @returns {boolean}
 */
function guestAllows(pres, { guest, shareLink }, access) {
  if (access === 'read') return shareLink?.presentationId === pres.id;
  if (access === 'comment') {
    return canGuestComment({ guest, shareLink, presentationId: pres.id });
  }
  return false;
}

/**
 * Why an identity may not do `access` on a deck it already holds, or `null`
 * when it may. Read is checked first for an actor, so a refusal says whether
 * the deck is unreadable or only the right is missing.
 *
 * @param {Object} pres
 * @param {ServiceIdentity} identity
 * @param {PresentationAccess} access
 * @returns {Promise<string|null>}
 */
async function refusal(pres, identity, access) {
  const right = ACTOR_RIGHTS[access];
  if (!right) throw new Error(`Unknown presentation access: ${access}`);
  if ('guest' in identity) {
    return guestAllows(pres, identity, access) ? null : right.refusal;
  }
  const { actor } = identity;
  if (!(await ACTOR_RIGHTS.read.allows(pres, actor))) {
    return ACTOR_RIGHTS.read.refusal;
  }
  if (access !== 'read' && !(await right.allows(pres, actor))) {
    return right.refusal;
  }
  return null;
}

/**
 * Load a deck by id for someone who wants to do something with it.
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {ServiceIdentity} identity - `{ actor }`, or `{ guest, shareLink }`
 *   for a share-link guest (internal contract only, D253).
 * @param {string} presentationId
 * @param {Object} [options]
 * @param {PresentationAccess} [options.access='read'] - The right the handling
 *   needs.
 * @returns {Promise<Object>} The presentation.
 * @throws {NotFoundError} No deck with this id in this scope.
 * @throws {ForbiddenError} The deck is there, the right is not.
 */
export async function loadPresentationForActor(
  scope,
  identity,
  presentationId,
  { access = 'read' } = {},
) {
  if (!ACTOR_RIGHTS[access]) {
    throw new Error(`Unknown presentation access: ${access}`);
  }
  const pres = presentationId
    ? await getPresentation(scope, presentationId)
    : null;
  if (!pres) throw new NotFoundError('Presentation not found');

  const refused = await refusal(pres, identity, access);
  if (refused) throw new ForbiddenError(refused);
  return pres;
}

/**
 * Whether an identity may do `access` on a deck that
 * {@link loadPresentationForActor} already handed out — the same decision, as
 * a boolean, for a handling that degrades instead of refusing (the collab
 * socket opens read-only). A handling that starts from an id asks the loader
 * itself, so no route loads a deck beside it (D289).
 *
 * @param {Object} pres
 * @param {ServiceIdentity} identity
 * @param {PresentationAccess} [access='read']
 * @returns {Promise<boolean>}
 */
export async function mayOnPresentation(pres, identity, access = 'read') {
  if (!pres || typeof pres !== 'object') return false;
  return (await refusal(pres, identity, access)) === null;
}

/** Retired spelling → the one name the deck field has (B446). */
const RETIRED_DECK_FIELDS = Object.freeze({
  themeId: 'theme',
  language: 'lang',
});

/**
 * Refuse input that names a deck field by a retired spelling: `theme` and
 * `lang` are the names on every surface (B446), and the old ones are refused
 * with the name to use, never accepted beside it.
 *
 * @param {Object} input - The parsed request body or tool arguments.
 * @throws {AppError} 400 `invalid`, `details` = `{ field, use }`.
 */
export function refuseRetiredDeckFields(input) {
  for (const [retired, canonical] of Object.entries(RETIRED_DECK_FIELDS)) {
    if (input && Object.hasOwn(input, retired)) {
      throw new AppError(
        `Unknown field "${retired}": use "${canonical}"`,
        400,
        { field: retired, use: canonical },
        'invalid',
      );
    }
  }
}

/**
 * Refuse a `lang` that is not a supported deck language. An unsupported tag
 * used to fall back to the default language without a word.
 *
 * @param {Object} input
 * @throws {AppError} 400 `invalid`, `details.field` = `lang`.
 */
function refuseUnsupportedLang(input) {
  if (input?.lang === undefined || normalizeLang(input.lang)) return;
  throw new AppError(
    `Unsupported lang: ${JSON.stringify(input.lang)}`,
    400,
    { field: 'lang' },
    'invalid',
  );
}

/**
 * Refuse an `ownerEmail` in a create: the owner of a new deck is the actor who
 * makes it, on every contract. v1 and the internal route overwrote the field
 * without a word; MCP let a session hand its deck to any address.
 *
 * @param {Object} input
 * @throws {AppError} 400 `invalid`, `details.field` = `ownerEmail`.
 */
function refuseOwnerOverride(input) {
  if (input && Object.hasOwn(input, 'ownerEmail')) {
    throw new AppError(
      'Unknown field "ownerEmail": a new deck is owned by whoever creates it',
      400,
      { field: 'ownerEmail' },
      'invalid',
    );
  }
}

/**
 * Refuse what a create may not carry: a retired field name, an unsupported
 * `lang`, an `ownerEmail`. {@link createPresentation} runs it first; an
 * adapter that does expensive work before the create (an AI generation) runs
 * it before that work, so a refused body costs nothing.
 *
 * @param {Object|null|undefined} input
 * @throws {AppError} 400 `invalid`, naming the field.
 */
export function assertCreatableDeckInput(input) {
  if (!input) return;
  refuseRetiredDeckFields(input);
  refuseUnsupportedLang(input);
  refuseOwnerOverride(input);
}

/**
 * The slide-library usage a compose-from-library create carries: each source
 * slide id plus (when the deck started from a saved collection) the collection
 * id. Both become "used by you", clearing the Home shelf's "new to you" badge.
 *
 * @param {Object} input
 * @returns {Array<{ type: 'slide'|'collection', id: string }>}
 */
function usageRefsOf(input) {
  const refs = [];
  const ids = Array.isArray(input?.sourceLibraryItemIds)
    ? input.sourceLibraryItemIds
    : [];
  for (const raw of ids) {
    const id = String(raw || '').trim();
    if (id) refs.push({ type: 'slide', id });
  }
  const collectionId =
    typeof input?.sourceCollectionId === 'string'
      ? input.sourceCollectionId.trim()
      : '';
  if (collectionId) refs.push({ type: 'collection', id: collectionId });
  return refs;
}

/**
 * Create a deck for an actor, on every contract.
 *
 * The rules of the handling live here, once: the retired field names, an
 * unsupported `lang` and an `ownerEmail` are refused; the actor owns the deck;
 * the storage result goes through {@link throwStorageFailure} (D254); and the
 * activity row and the slide-library usage are recorded whoever asked. What
 * holds for *every* writer (theme check, slide normalization, sandbox quota,
 * size limits) stays in the storage facade (D252). Validating an agent's slide
 * payload strictly or with fixes is an MCP input step before this call, not a
 * rule of the handling.
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {{ actor: Actor }} identity - The creating actor (D253).
 * @param {Object} input - The deck to create: `title`, `theme`, `lang`,
 *   `slides`, `settings`, … as storage's factory reads them, plus
 *   `sourceLibraryItemIds` / `sourceCollectionId` for a compose from the
 *   slide library.
 * @returns {Promise<Object>} The created presentation.
 * @throws {AppError} 400 `invalid`: a refused field.
 * @throws {AppError} A storage refusal (theme, quota, size).
 */
export async function createPresentation(scope, { actor }, input = {}) {
  assertCreatableDeckInput(input);

  const { sourceLibraryItemIds, sourceCollectionId, ...deck } = input;
  const created = await storeNewPresentation(scope, {
    ...deck,
    ownerEmail: actor?.email || null,
  });
  if (created?.ok === false) {
    throwStorageFailure(
      created,
      created.errors?.map((e) => e.message).join(' ') || undefined,
    );
  }

  if (actor?.email) {
    fireAndForget(
      recordPresentationCreated({ presentation: created, actor, scope }),
      'record presentation-created activity',
    );
    // Badge tracking must never fail a create.
    const usageRefs = usageRefsOf({ sourceLibraryItemIds, sourceCollectionId });
    if (usageRefs.length) {
      fireAndForget(
        recordSlideLibraryUsage(scope, actor.email, usageRefs),
        'slide-library usage tracking',
      );
    }
  }
  return created;
}

/**
 * A deck's two timestamps under their published names. Storage projects the
 * columns as `created`/`modified`; v1 and MCP publish `createdAt`/`updatedAt`,
 * the names `openapi.yaml` promises and every other v1 resource uses (B448).
 * The rename happens here, once, for both machine contracts, so no response
 * carries both spellings or reads the published name off a storage object
 * that never had it.
 *
 * @param {{created?: string|Date, modified?: string|Date}} pres
 * @returns {{createdAt: string|Date|null, updatedAt: string|Date|null}}
 */
export function publicDeckTimestamps(pres) {
  return {
    createdAt: pres?.created || null,
    updatedAt: pres?.modified || null,
  };
}
