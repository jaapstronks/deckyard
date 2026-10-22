/**
 * The trash list: which trashed decks a reader may restore, decided in one
 * query and paged by keyset (B821, D358).
 *
 * The trash route used to read the organization's whole trash and keep the
 * rows `canRestorePresentation` allowed, after the read. A predicate applied
 * after the cut makes a page untrue, so the predicate is SQL here and the
 * page is a keyset page `(trashed_at desc, id desc)`
 * (`server/storage/keyset.js`):
 *
 *   - an admin (`isAdmin`) and the auth-off operator (`unrestricted`) see
 *     every trashed deck of the organization;
 *   - anyone else with a `users.id` sees the decks they own, made or
 *     trashed: `owner_user_id`, `created_by_user_id` or `trashed_by_user_id`
 *     equals it. All three are compared on the stored id, never through an
 *     address (D22);
 *   - an actor without a user id sees nothing.
 *
 * `canRestorePresentation` (server/utils/presentation-authz/presentations.js)
 * stays the answer for one deck; this is the same rule for a list.
 * tests/pg/trash-list-page.pgtest.js holds the two equal.
 *
 * @module server/storage/presentations/trash-list
 */

import { getDb } from '../../db/client.js';
import { getOrgId } from '../../utils/context.js';
import { toStorageContext } from '../scope.js';
import { resolveDisplayNames, toDisplayIdentity } from '../display-identity.js';
import { existingVersionLangs } from '../../../shared/i18n-progress.js';
import { keysetPage, keysetRows } from '../keyset.js';

/** The columns a trash card reads; the slides only for "has a first slide". */
const TRASH_LIST_COLUMNS = Object.freeze([
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
]);

/**
 * Who the reader may restore for: `null` = every trashed deck, a user id =
 * the decks stamped with it, `undefined` = none.
 *
 * @param {{userId?: string|null, unrestricted?: boolean, isAdmin?: boolean}} reader
 * @returns {string|null|undefined}
 */
function trashReaderKey(reader) {
  if (reader?.isAdmin === true || reader?.unrestricted === true) return null;
  return reader?.userId || undefined;
}

/**
 * The trash query before its order and page.
 * @param {Object} db
 * @param {string} orgId
 * @param {string|null} userId - {@link trashReaderKey}; null = no filter.
 */
function trashListQuery(db, orgId, userId) {
  let qb = db
    .selectFrom('presentations')
    .select([...TRASH_LIST_COLUMNS])
    .where('presentations.organization_id', '=', orgId)
    .where('presentations.trashed_at', 'is not', null);
  if (userId) {
    qb = qb.where((eb) =>
      eb.or([
        eb('presentations.owner_user_id', '=', userId),
        eb('presentations.created_by_user_id', '=', userId),
        eb('presentations.trashed_by_user_id', '=', userId),
      ]),
    );
  }
  return qb;
}

/**
 * Project trash rows as deck cards, with one batched name lookup.
 * @param {Object} ctx - Storage context
 * @param {Object[]} rows
 * @returns {Promise<Object[]>}
 */
async function toTrashListItems(ctx, rows) {
  const displayNames = await resolveDisplayNames(
    ctx,
    rows.flatMap((row) => [
      { id: row.updatedById, email: row.updatedBy },
      { id: row.createdById, email: row.createdBy },
      { id: row.trashedById, email: row.trashedBy },
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
      // Same i18n summary shape as the deck list (./deck-list.js).
      i18n: i18n ? { dominant, langs: existingVersionLangs({ i18n }) } : null,
      hasSlides: slides.length > 0,
    };
  });
}

/**
 * The trashed decks a reader may restore, as one keyset page or (without
 * `limit`) the whole list, most recently trashed first.
 *
 * @param {import('../scope.js').StorageScope} scope
 * @param {Object} filter
 * @param {{userId?: string|null, unrestricted?: boolean, isAdmin?: boolean}} filter.reader
 *   The reader as `canRestorePresentation` reads it: `actorIdentity()` plus
 *   the actor's `isAdmin`.
 * @param {Object} [page]
 * @param {number} [page.limit] - Rows per page; the whole list when absent.
 * @param {{value: string, id: string}|null} [page.after] - Position of the
 *   last row seen.
 * @returns {Promise<{items: Object[], next: {value: string, id: string}|null}>}
 */
export async function listTrashedDecks(
  scope,
  { reader },
  { limit, after = null } = {},
) {
  const ctx = toStorageContext(scope, 'listTrashedDecks');
  const userId = trashReaderKey(reader);
  if (userId === undefined) return { items: [], next: null };

  const qb = trashListQuery(getDb(), getOrgId(ctx), userId);
  let rows;
  let next = null;
  if (limit === undefined) {
    rows = await qb
      .orderBy('trashed_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
  } else {
    ({ rows, next } = keysetRows(
      await keysetPage(qb, { column: 'trashed_at', after, limit }).execute(),
      limit,
    ));
  }
  return { items: await toTrashListItems(ctx, rows), next };
}

// White-box seam: tests/pg/trash-list-page.pgtest.js EXPLAINs the exact query
// a page runs. The `__` prefix marks it internal.
export const __trashList = { trashListQuery };
