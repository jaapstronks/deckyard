/**
 * The deck list: which decks a reader sees, decided in one query (B820).
 *
 * Every deck list used to read the organization's whole set and decide per row
 * in JavaScript (`belongsInCollection`), merge the collaborator rows in, sort
 * again and only then cut a page. A predicate applied after the cut makes a
 * page untrue, so the predicate is SQL here and the page is a keyset page on
 * the list-page contract (D358, `server/storage/keyset.js`):
 * `(modified_at desc, id desc)`.
 *
 * Who sees what, per `ownership` (the vocabulary of
 * `DECK_LIST_OWNERSHIPS` in server/services/presentations.js):
 *
 *   - `owned`: `owner_user_id = :id OR created_by_user_id = :id`. The maker
 *     is compared on the id stored with the deck (migration 063, D22), never
 *     through the address: an address can change and a NULL stamp names
 *     nobody;
 *   - `collection`: `visibility = 'organization'` or `owned`, for a reader
 *     with any identity at all;
 *   - `shared`: an active collaborator row for the reader's address in this
 *     organization (`EXISTS`). The organization here means "decks in the
 *     organization I am acting in", a listing decision, not an authorization
 *     one: a cross-organization collaborator still reaches such a deck by id
 *     (docs/reference/tenant-isolation.md);
 *   - `all`: `collection OR shared`.
 *
 * The auth-off operator (`unrestricted`) sees every deck under `owned`,
 * `collection` and `all`. The organization filter and `trashed_at IS NULL`
 * apply to every list.
 *
 * Two narrowing filters ride on any ownership, also in the query (B821):
 * `visibility` (the Workspace chip on Home) and `tags`, which keeps a deck
 * carrying at least one of the named tags, compared on `lower(name)` as the
 * tag identity is (migration 018, server/storage/tags.js).
 *
 * `belongsInCollection` (server/utils/presentation-authz/presentations.js)
 * stays the answer for one deck; this is the same rule for a list. Two
 * spellings of one rule need a gate: tests/pg/deck-list-page.pgtest.js holds
 * this query equal to `rows.filter(belongsInCollection)` for every ownership.
 *
 * @module server/storage/presentations/deck-list
 */

import { getDb } from '../../db/client.js';
import { getOrgId } from '../../utils/context.js';
import { toStorageContext } from '../scope.js';
import { resolveDisplayNames, toDisplayIdentity } from '../display-identity.js';
import { existingVersionLangs } from '../../../shared/i18n-progress.js';
import { keysetPage, keysetRows } from '../keyset.js';

/** The columns a deck card reads; the slides only for "has a first slide". */
const DECK_LIST_COLUMNS = Object.freeze([
  'id',
  'title',
  'modified_at as modified',
  'created_at as created',
  'theme',
  'lang',
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
]);

/**
 * The terms a list is the disjunction of, per ownership. `null` = no filter
 * (every deck of the organization); an empty list = no deck at all.
 *
 * @param {{userId?: string|null, email?: string, unrestricted?: boolean}} reader
 * @param {string} ownership
 * @returns {string[]|null}
 */
function deckListTerms(reader, ownership) {
  const unrestricted = reader?.unrestricted === true;
  const identified = Boolean(reader?.userId || reader?.email);
  const mine = reader?.userId ? ['owner', 'maker'] : [];
  const shared = reader?.email ? ['collaborator'] : [];
  const collection = identified ? ['organization', ...mine] : [];
  switch (ownership) {
    case 'owned':
      return unrestricted ? null : mine;
    case 'collection':
      return unrestricted ? null : collection;
    case 'shared':
      return shared;
    case 'all':
      return unrestricted ? null : [...collection, ...shared];
    default:
      throw new Error(`deckListTerms: unknown ownership "${ownership}"`);
  }
}

/**
 * One term as a Kysely expression.
 * @param {Object} eb - Expression builder
 * @param {string} term
 * @param {{userId?: string|null, email?: string}} reader
 * @param {string} orgId
 */
function termExpression(eb, term, reader, orgId) {
  switch (term) {
    case 'organization':
      return eb('presentations.visibility', '=', 'organization');
    case 'owner':
      return eb('presentations.owner_user_id', '=', reader.userId);
    case 'maker':
      return eb('presentations.created_by_user_id', '=', reader.userId);
    case 'collaborator':
      return eb.exists(
        eb
          .selectFrom('presentation_collaborators as c')
          .select('c.presentation_id')
          .whereRef('c.presentation_id', '=', 'presentations.id')
          .where('c.user_email', '=', reader.email)
          .where('c.organization_id', '=', orgId)
          .where('c.revoked_at', 'is', null),
      );
    default:
      throw new Error(`deck list: unknown term "${term}"`);
  }
}

/**
 * Decks carrying at least one of `names`, compared as the tag identity is:
 * `lower(name)` within the organization.
 * @param {Object} eb - Expression builder
 * @param {string[]} names
 * @param {string} orgId
 */
function taggedExpression(eb, names, orgId) {
  return eb.exists(
    eb
      .selectFrom('presentation_tags as pt')
      .innerJoin('tags as t', 't.id', 'pt.tag_id')
      .select('pt.presentation_id')
      .whereRef('pt.presentation_id', '=', 'presentations.id')
      .where('t.organization_id', '=', orgId)
      .where(
        eb.fn('lower', ['t.name']),
        'in',
        names.map((name) => eb.fn('lower', [eb.val(name)])),
      ),
  );
}

/**
 * The list query before its order and page: scope, trash, the reader's terms,
 * `viewOnly`, `visibility` and `tags`.
 *
 * @param {Object} db
 * @param {string} orgId
 * @param {Object} filter
 * @param {Object} filter.reader
 * @param {string[]|null} filter.terms - {@link deckListTerms}; not empty.
 * @param {boolean} [filter.viewOnly]
 * @param {'private'|'organization'} [filter.visibility]
 * @param {string[]} [filter.tags] - Tag names; a deck needs one of them.
 */
function deckListQuery(
  db,
  orgId,
  { reader, terms, viewOnly, visibility, tags },
) {
  let qb = db
    .selectFrom('presentations')
    .select([...DECK_LIST_COLUMNS])
    .where('presentations.organization_id', '=', orgId)
    .where('presentations.trashed_at', 'is', null);
  if (terms) {
    qb = qb.where((eb) =>
      eb.or(terms.map((term) => termExpression(eb, term, reader, orgId))),
    );
  }
  if (viewOnly !== undefined) {
    qb = qb.where('presentations.is_view_only', '=', viewOnly);
  }
  if (visibility !== undefined) {
    qb = qb.where('presentations.visibility', '=', visibility);
  }
  if (tags?.length) {
    qb = qb.where((eb) => taggedExpression(eb, tags, orgId));
  }
  return qb;
}

/**
 * How the reader holds each listed deck through a collaborator row: a stamp
 * after the page is read, which removes nothing from it.
 *
 * @param {Object} db
 * @param {string} orgId
 * @param {string} email
 * @param {string[]} ids
 * @returns {Promise<Map<string, Object>>}
 */
async function collaboratorGrants(db, orgId, email, ids) {
  if (!email || ids.length === 0) return new Map();
  const rows = await db
    .selectFrom('presentation_collaborators')
    .select(['presentation_id', 'permission', 'invited_by', 'invited_at'])
    .where('presentation_id', 'in', ids)
    .where('user_email', '=', email)
    .where('organization_id', '=', orgId)
    .where('revoked_at', 'is', null)
    .execute();
  return new Map(rows.map((row) => [row.presentation_id, row]));
}

/**
 * Project list rows as deck cards, with one batched name lookup for the page.
 * @param {Object} ctx - Storage context
 * @param {Object[]} rows
 * @returns {Promise<Object[]>}
 */
async function toDeckListItems(ctx, rows) {
  // One batched name lookup for the whole page rather than one per card:
  // a 200-deck organization would otherwise issue 200 identical queries.
  const displayNames = await resolveDisplayNames(
    ctx,
    rows.flatMap((row) => [
      { id: row.updatedById, email: row.updatedBy },
      { id: row.createdById, email: row.createdBy },
    ]),
  );

  return rows.map((row) => {
    const slides = Array.isArray(row.slides) ? row.slides : [];
    const i18n = row.i18n && typeof row.i18n === 'object' ? row.i18n : null;
    const dominant = i18n?.dominant || null;

    return {
      id: row.id,
      title: row.title,
      modified: row.modified,
      created: row.created,
      theme: row.theme,
      lang: row.lang,
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
      // Which languages the deck has, as the open list it is. The summary used
      // to carry `hasNl`/`hasEnGb`/`otherLang` beside the dominant language —
      // three fields that could not describe a German version, and that no
      // reader ever asked for (D72).
      i18n: i18n ? { dominant, langs: existingVersionLangs({ i18n }) } : null,
      hasSlides: slides.length > 0,
    };
  });
}

/**
 * Every untrashed deck of the context's organization, newest change first.
 * @param {Object} ctx - Storage context
 * @returns {Promise<Object[]>}
 */
async function listPresentationRows(ctx) {
  const rows = await getDb()
    .selectFrom('presentations')
    .select([...DECK_LIST_COLUMNS])
    .where('organization_id', '=', getOrgId(ctx))
    .where('trashed_at', 'is', null)
    .orderBy('modified_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  return toDeckListItems(ctx, rows);
}

/**
 * Every untrashed deck of the scope's organization, newest change first: the
 * unfiltered set bulk export reads. A list a person sees goes through
 * {@link listDecks}.
 *
 * @param {import('../scope.js').StorageScope} scope
 * @returns {Promise<Object[]>}
 */
export async function listPresentations(scope) {
  const ctx = toStorageContext(scope, 'listPresentations');
  return listPresentationRows(ctx);
}

/**
 * The decks a reader sees, as one keyset page or (without `limit`) the whole
 * list, newest change first.
 *
 * A deck the reader holds through a collaborator row carries `permission`,
 * `sharedBy` and `sharedAt` under `shared` and `all`.
 *
 * @param {import('../scope.js').StorageScope} scope
 * @param {Object} filter
 * @param {{userId?: string|null, email?: string, unrestricted?: boolean}} filter.reader
 *   The reader's identity (`actorIdentity()` in shared/identity-match.js),
 *   its `userId` already resolved.
 * @param {'collection'|'owned'|'shared'|'all'} filter.ownership
 * @param {boolean} [filter.viewOnly] - Only view-only decks or only others.
 * @param {'private'|'organization'} [filter.visibility] - Only decks with
 *   this visibility.
 * @param {string[]} [filter.tags] - Only decks carrying one of these tags.
 * @param {Object} [page]
 * @param {number} [page.limit] - Rows per page; the whole list when absent.
 * @param {{value: string, id: string}|null} [page.after] - Position of the
 *   last row seen.
 * @returns {Promise<{items: Object[], next: {value: string, id: string}|null}>}
 */
export async function listDecks(
  scope,
  { reader, ownership, viewOnly, visibility, tags },
  { limit, after = null } = {},
) {
  const ctx = toStorageContext(scope, 'listDecks');
  const terms = deckListTerms(reader, ownership);
  if (terms && terms.length === 0) return { items: [], next: null };

  const db = getDb();
  const orgId = getOrgId(ctx);
  const qb = deckListQuery(db, orgId, {
    reader,
    terms,
    viewOnly,
    visibility,
    tags,
  });

  let rows;
  let next = null;
  if (limit === undefined) {
    rows = await qb
      .orderBy('modified_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
  } else {
    ({ rows, next } = keysetRows(
      await keysetPage(qb, { column: 'modified_at', after, limit }).execute(),
      limit,
    ));
  }

  const items = await toDeckListItems(ctx, rows);
  if (ownership !== 'shared' && ownership !== 'all') return { items, next };

  const grants = await collaboratorGrants(
    db,
    orgId,
    reader.email,
    items.map((item) => item.id),
  );
  return {
    items: items.map((item) => {
      const grant = grants.get(item.id);
      if (!grant) return item;
      return {
        ...item,
        permission: grant.permission,
        // Who shared it: the inviter's address, a contact the reader has.
        sharedBy: grant.invited_by,
        sharedAt: grant.invited_at,
      };
    }),
    next,
  };
}

// White-box seam: tests/pg/deck-list-page.pgtest.js EXPLAINs the exact query
// a page runs, and `__store` in ./index.js hands the context-level list to
// the organization-binding tests. The `__` prefix marks it internal.
export const __deckList = {
  deckListTerms,
  deckListQuery,
  listPresentationRows,
};
