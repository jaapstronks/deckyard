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
 * So is a copy ({@link duplicatePresentation}, B570). The internal route and
 * v1 loaded the source and decided on their own, MCP handed storage an
 * `ownerEmail` it never read, v1 answered a vanished source with a 500, and no
 * contract left an activity row for the deck it had just made.
 *
 * So is moving a deck to the trash ({@link deletePresentation}, B571). The
 * internal route read a `message` from the body that storage never stored and
 * was the only contract to leave an activity row; MCP answered `deleted: true`
 * for a deck that was already in the trash.
 *
 * And a list of decks is one ({@link listPresentationsForActor}, B607). Home,
 * search, v1 and MCP each read the organization's rows and decided who sees
 * what on their own; MCP compared a bare address and missed the creator and
 * every organization-visible deck, and an unknown filter value read as none.
 * Since B820 the predicate is SQL, and v1 and MCP read a page of it on the
 * list-page contract ({@link listPresentationPage}).
 *
 * @module server/services/presentations
 */

import {
  getPresentation,
  listDecks,
  createPresentation as storeNewPresentation,
  duplicatePresentation as storeDuplicate,
  deletePresentation as storeTrash,
  restorePresentation as storeRestore,
} from '../storage/presentations/index.js';
import { recordSlideLibraryUsage } from '../storage/slide-library-usage.js';
import { DEFAULT_DECK_LANG, normalizeLang } from '../../shared/i18n-utils.js';
import {
  presentationCommentsEnabled,
  resolveActorUserId,
  canActorAccessPresentation,
  canActorDeletePresentation,
  canActorManageCollaborators,
  canActorCommentOnPresentation,
  canActorResolveComment,
  canRestorePresentation,
  canActorTransferOwnership,
  canGuestComment,
} from '../utils/presentation-authz/index.js';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  throwStorageFailure,
} from '../utils/errors.js';
import { fireAndForget } from '../utils/fire-and-forget.js';
import {
  metadataMatchLocations,
  normalizeForSearch,
  slideMatchLocation,
} from './deck-search.js';
import {
  recordPresentationCreated,
  recordPresentationDeleted,
} from './activity-events.js';
import { assertValidNewDeckSlides } from './slide-field-validation.js';
import { listPageResult, parseListPage } from './list-page.js';
import { actorIdentity } from '../../shared/identity-match.js';
import { buildMergedSlideTypes } from '../utils/custom-slide-type-runtime.js';

/**
 * @typedef {import('./actor.js').Actor} Actor
 * @typedef {import('./actor.js').ServiceIdentity} ServiceIdentity
 * @typedef {import('../storage/scope.js').StorageScope} StorageScope
 * @typedef {'read'|'write'|'delete'|'manage'|'transfer'|'comment'|'readComments'|'moderate'} PresentationAccess
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
  // Hand the deck to someone else: the owner stamp alone (D43, B573), with
  // the actor's id resolved like every other ownership-scoped right here.
  transfer: {
    allows: canActorTransferOwnership,
    refusal: 'Only the presentation owner can transfer ownership',
  },
  readComments: {
    allows: async (pres) => presentationCommentsEnabled(pres),
    refusal: 'Comments are off on sandbox example decks',
  },
  comment: {
    allows: canActorCommentOnPresentation,
    refusal: 'You may not comment on this presentation',
  },
  // Resolve, reopen or dismiss a comment (B569).
  moderate: {
    allows: canActorResolveComment,
    refusal: 'Only the presentation owner can change comment status',
  },
};

/**
 * What a share-link guest may do with a deck: read the deck their link names,
 * and comment when the link grants it. Nothing else — a guest never writes,
 * deletes, manages or moderates.
 *
 * @param {Object} pres
 * @param {import('./actor.js').GuestIdentity} identity
 * @param {PresentationAccess} access
 * @returns {boolean}
 */
function guestAllows(pres, { guest, shareLink }, access) {
  if (access === 'read' || access === 'readComments')
    return shareLink?.presentationId === pres.id;
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
  if (
    ['readComments', 'comment', 'moderate'].includes(access) &&
    !presentationCommentsEnabled(pres)
  )
    return ACTOR_RIGHTS.readComments.refusal;
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

/**
 * Which decks a list includes by source (`ownership`, the register word in
 * docs/reference/vocabulary.md):
 *
 *   - `collection` — the decks the actor owns or made, plus every
 *     organization-visible deck: what Home and the v1 list show;
 *   - `owned` — only the decks the actor owns or made;
 *   - `shared` — the decks shared with the actor through a collaborator row;
 *   - `all` — `collection` and `shared` together: every deck the actor can
 *     open.
 *
 * The auth-off operator (`unrestricted`) owns no row but may open every deck,
 * so `owned`, `collection` and `all` list them all.
 */
export const DECK_LIST_OWNERSHIPS = Object.freeze([
  'collection',
  'owned',
  'shared',
  'all',
]);

/** A refusal of one list input, named in `details.field` (les 3, B575). */
function invalidListInput(field, message) {
  return new AppError(message, 400, { field }, 'invalid');
}

/**
 * Refuse a list input outside the vocabulary before any deck is read. An
 * unknown value is never read as "no filter" (les 3).
 *
 * @param {Object} input
 * @returns {{ ownership: string, viewOnly?: boolean, query: string|null, deep: boolean }}
 */
function parseListInput(input) {
  const { ownership = 'collection', viewOnly, q, deep } = input ?? {};
  if (!DECK_LIST_OWNERSHIPS.includes(ownership)) {
    throw invalidListInput(
      'ownership',
      `Invalid ownership (${DECK_LIST_OWNERSHIPS.join('|')})`,
    );
  }
  if (viewOnly !== undefined && typeof viewOnly !== 'boolean') {
    throw invalidListInput('viewOnly', 'Invalid viewOnly (true|false)');
  }
  if (deep !== undefined && typeof deep !== 'boolean') {
    throw invalidListInput('deep', 'Invalid deep (true|false)');
  }
  let query = null;
  if (q !== undefined) {
    query = typeof q === 'string' ? normalizeForSearch(q.trim()) : '';
    if (query.length < 2) {
      throw invalidListInput(
        'q',
        'Search query (q) must be at least 2 characters',
      );
    }
  }
  return { ownership, viewOnly, query, deep: deep === true };
}

/**
 * The reader a deck list filters on. The list predicate keys on `users.id`
 * (D22); MCP's actor carries only its address, so resolve it once for the
 * whole list, as the by-id deciders do per deck.
 *
 * @param {Actor} [actor]
 * @returns {Promise<import('../../shared/identity-match.js').ActorIdentity>}
 */
async function listReader(actor) {
  const reader = actorIdentity(actor);
  if (!reader.userId && reader.email && !reader.unrestricted) {
    reader.userId = (await resolveActorUserId(actor)) || null;
  }
  return reader;
}

/** Newest first: last change, then creation. */
function byModifiedDesc(a, b) {
  const time = (p) => new Date(p.modified || p.created || 0).getTime() || 0;
  return time(b) - time(a);
}

/**
 * Where a deck matches a search query, or `null` when it does not. Metadata
 * always; slide text only on a deep search, and only when the metadata did not
 * match already. A deck that cannot be loaded for its slides does not match.
 */
async function searchMatch(scope, pres, query, deep) {
  const locations = metadataMatchLocations(pres, query);
  if (locations.length > 0) return locations;
  if (!deep) return null;
  try {
    const full = await getPresentation(scope, pres.id);
    const slide = slideMatchLocation(full, query);
    return slide ? [slide] : null;
  } catch {
    return null;
  }
}

/**
 * The whole list of decks an actor sees, or the decks of it that match a
 * search (B607). Who sees what is one SQL predicate (`listDecks` in
 * server/storage/presentations/deck-list.js, B820), the same rule as
 * `belongsInCollection` (presentation-authz) for one deck; the filters have
 * one vocabulary, and a value outside it is refused.
 *
 * This is the unpaged form, for the internal lists that still show every deck
 * at once (Home, shared-with-me, search; B821 moves them onto the list-page
 * contract) and for the comment service's deck set (B824). A page of decks is
 * {@link listPresentationPage}.
 *
 * The rows come back as storage projects them; each contract keeps its own
 * projection.
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {{ actor: Actor }} identity
 * @param {Object} [input]
 * @param {'collection'|'owned'|'shared'|'all'} [input.ownership='collection']
 *   Which decks by source ({@link DECK_LIST_OWNERSHIPS}).
 * @param {boolean} [input.viewOnly] - Only view-only decks (`true`) or only
 *   decks that are not (`false`).
 * @param {string} [input.q] - Search query, at least 2 characters; matches
 *   title, description and owner address. Each listed deck then carries
 *   `_matchLocations`, and title matches sort first.
 * @param {boolean} [input.deep=false] - With `q`: also search slide text.
 * @returns {Promise<{ presentations: Object[] }>} The decks, newest change
 *   first (title matches first on a search).
 * @throws {AppError} 400 `invalid`, `details.field` naming the refused input.
 */
export async function listPresentationsForActor(
  scope,
  { actor } = {},
  input = {},
) {
  const { ownership, viewOnly, query, deep } = parseListInput(input);
  const { items: decks } = await listDecks(scope, {
    reader: await listReader(actor),
    ownership,
    viewOnly,
  });
  if (!query) return { presentations: decks };

  // Search is a result set in relevance order, not a list page: it reads the
  // listed decks and matches them here (brief db-level-pagination.md § Out of
  // scope).
  const matched = [];
  for (const pres of decks) {
    const locations = await searchMatch(scope, pres, query, deep);
    if (locations) matched.push({ ...pres, _matchLocations: locations });
  }
  const inTitle = (pres) => pres._matchLocations.includes('title');
  return {
    presentations: matched.sort(
      (a, b) => inTitle(b) - inTitle(a) || byModifiedDesc(a, b),
    ),
  };
}

/**
 * One page of the decks an actor sees, on the list-page contract (D358, B820):
 * `GET /api/v1/presentations` and MCP `list_presentations`. The predicate is
 * the one {@link listPresentationsForActor} uses, applied in the query, so
 * every page but the last is full; the order is `(modified desc, id desc)`.
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {{ actor: Actor }} identity
 * @param {Object} [input]
 * @param {'collection'|'owned'|'shared'|'all'} [input.ownership='collection']
 * @param {boolean} [input.viewOnly]
 * @param {number|string} [input.limit] - 1..100, default 50.
 * @param {string} [input.cursor] - `nextCursor` of the previous page, made
 *   under the same `ownership` and `viewOnly`.
 * @returns {Promise<{ presentations: Object[], nextCursor: string|null }>}
 * @throws {AppError} 400 `invalid` naming `ownership`, `viewOnly`, `limit`,
 *   `cursor` or a refused `offset` (`details.use: 'cursor'`).
 */
export async function listPresentationPage(scope, { actor } = {}, input = {}) {
  const { ownership, viewOnly } = parseListInput({
    ownership: input?.ownership,
    viewOnly: input?.viewOnly,
  });
  const page = parseListPage(input, {
    sortKey: 'modified_desc',
    filters: { ownership, viewOnly },
  });
  const result = await listDecks(
    scope,
    { reader: await listReader(actor), ownership, viewOnly },
    { limit: page.limit, after: page.after },
  );
  return listPageResult('presentations', result, page);
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
 * The language versions a create's provided slides become, as storage's
 * factory composes them: a slide's `contentByLang[lang]` where it has one,
 * its `content` otherwise, with the deck's language always among them. A
 * malformed `contentByLang` (or language value) reads as absent here, so the
 * factory's shape refusal is the one the caller sees.
 *
 * @param {Array<Object>} slides
 * @param {string} dominant
 * @returns {Array<{lang: string, slides: Array<Object>}>}
 */
function versionsOfProvidedSlides(slides, dominant) {
  const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const byLang = (s) =>
    isObject(s?.contentByLang)
      ? Object.fromEntries(
          Object.entries(s.contentByLang).filter(([, v]) => isObject(v)),
        )
      : {};
  const langs = new Set([dominant]);
  for (const s of slides) for (const l of Object.keys(byLang(s))) langs.add(l);
  return [...langs].map((lang) => ({
    lang,
    slides: slides.map((s) => ({
      ...s,
      content: byLang(s)[lang] ?? s?.content,
    })),
  }));
}

/**
 * A create that carries slides is held to the declared field rules a save is
 * (B315, B693): the editor would refuse the same value, so the create does.
 *
 * @param {StorageScope} scope
 * @param {Object} input
 * @throws {AppError} 400 `invalid`, naming the slide and the field.
 */
async function assertValidProvidedSlides(scope, input) {
  if (!Array.isArray(input?.slides) || input.slides.length === 0) return;
  const dominant = normalizeLang(input.lang) || DEFAULT_DECK_LANG;
  assertValidNewDeckSlides(
    versionsOfProvidedSlides(input.slides, dominant),
    await buildMergedSlideTypes(scope),
    { dominant },
  );
}

/**
 * Create a deck for an actor, on every contract.
 *
 * The rules of the handling live here, once: the retired field names, an
 * unsupported `lang` and an `ownerEmail` are refused; the actor owns the deck;
 * the storage result goes through {@link throwStorageFailure} (D254); and the
 * activity row and the slide-library usage are recorded whoever asked. What
 * holds for *every* writer (theme check, slide normalization, sandbox quota,
 * size limits) stays in the storage facade (D252). Provided slides meet the
 * declared field rules a save meets (B693); validating an agent's slide
 * payload strictly or with fixes is an MCP input step before this call.
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {{ actor: Actor }} identity - The creating actor (D253).
 * @param {Object} input - The deck to create: `title`, `theme`, `lang`,
 *   `slides`, `settings`, … as storage's factory reads them, plus
 *   `sourceLibraryItemIds` / `sourceCollectionId` for a compose from the
 *   slide library.
 * @returns {Promise<Object>} The created presentation.
 * @throws {AppError} 400 `invalid`: a refused field, or a provided slide's
 *   declared field (`details.lang`, `index`, `slideId`, `field`, `errors`).
 * @throws {AppError} A storage refusal (theme, quota, size).
 */
export async function createPresentation(scope, { actor }, input = {}) {
  assertCreatableDeckInput(input);
  await assertValidProvidedSlides(scope, input);

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
 * Copy a deck for an actor, on every contract.
 *
 * Whoever may read a deck may copy it: the source is loaded with
 * {@link loadPresentationForActor} at `access: 'read'`, so the refusal is the
 * loader's (404 absent, 403 unreadable; D255). The copy is the actor's, not
 * the source owner's, and leaves the same `presentation.created` row a create
 * leaves: to the activity feed a copy is a new deck. The copy itself (slide
 * ids, rekeying, the title prefix, the sandbox quota) is storage's (D252).
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {{ actor: Actor }} identity - The copying actor (D253).
 * @param {string} presentationId - The deck to copy.
 * @returns {Promise<Object>} The copy.
 * @throws {NotFoundError} No deck with this id in this scope.
 * @throws {ForbiddenError} The actor may not read the deck.
 * @throws {AppError} A storage refusal (sandbox quota).
 */
export async function duplicatePresentation(scope, identity, presentationId) {
  const source = await loadPresentationForActor(
    scope,
    identity,
    presentationId,
  );
  const { actor } = identity;
  const duplicated = await storeDuplicate(scope, source.id, {
    actorEmail: actor?.email || null,
  });
  if (!duplicated.ok) throwStorageFailure(duplicated);

  const copy = duplicated.presentation;
  if (actor?.email) {
    fireAndForget(
      recordPresentationCreated({ presentation: copy, actor, scope }),
      'record presentation-created activity',
    );
  }
  return copy;
}

/**
 * Move a deck to the trash for an actor, on every contract.
 *
 * The deck is loaded with {@link loadPresentationForActor} at
 * `access: 'delete'`, so the owner decides (`ownerId`, D22) and the refusal is
 * the loader's (404 absent or already trashed, 403 not the owner; D255). A
 * delete is always the trash: the permanent delete is its own handling
 * (`services/permanent-delete.js`). The loader reads a trashed deck too, so a
 * deck already in the trash is answered by storage's refusal to trash it
 * twice: absent, on every contract. The activity row is
 * left for an organization-visible deck only: the row outlives the deck and
 * carries its title, and the feed cannot check read access on a deck it no
 * longer has.
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {{ actor: Actor }} identity - The deleting actor (D253).
 * @param {string} presentationId - The deck to trash.
 * @returns {Promise<Object>} The deck as it was before it went to the trash.
 * @throws {NotFoundError} No deck with this id in this scope, or it is
 *   already in the trash.
 * @throws {ForbiddenError} The actor may not delete the deck.
 */
export async function deletePresentation(scope, identity, presentationId) {
  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'delete',
  });
  const { actor } = identity;
  const trashed = await storeTrash(scope, pres.id, {
    actorEmail: actor?.email || null,
  });
  if (!trashed) throw new NotFoundError('Presentation not found');

  if (actor?.email && pres.visibility === 'organization') {
    fireAndForget(
      recordPresentationDeleted({ presentation: pres, actor, scope }),
      'record presentation-deleted activity',
    );
  }
  return pres;
}

/** Restore a trashed deck for its owner, creator, trasher or admin. */
export async function restorePresentation(scope, { actor }, presentationId) {
  const pres = presentationId
    ? await getPresentation(scope, presentationId)
    : null;
  if (!pres) throw new NotFoundError('Presentation not found');
  if (!pres.trashedAt) {
    throw new AppError(
      'Presentation is not in trash',
      409,
      null,
      'not_trashed',
    );
  }
  if (!canRestorePresentation({ user: actor, pres })) {
    throw new ForbiddenError(
      'You do not have permission to restore this presentation',
    );
  }

  const restored = await storeRestore(scope, pres.id);
  if (!restored.ok) throw new NotFoundError('Presentation not found');
  return restored.presentation;
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
