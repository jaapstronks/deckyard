/**
 * Slide library storage facade.
 *
 * Every function takes a **storage scope** rather than a bare `repoRoot`, so the
 * organization comes from the caller instead of a hardcoded default — see
 * server/storage/scope.js. The organization library is an organization's shared shelf, so
 * reading it out of the wrong organization is exactly what this removes.
 *
 * `userEmail` stays a separate argument where it appears: it names the *subject*
 * of a personal-library operation, which is not the same question as who the
 * scope attributes the write to (`actorEmail`).
 *
 * Queries run directly through Kysely (B79/D34 removed the adapter
 * indirection); getDb() throws on an uninitialized database.
 */

import { crossOrganizationScope, toStorageContext } from './scope.js';
import { keysetPage, keysetRows } from './keyset.js';
import { DEFAULT_DECK_LANG } from '../../shared/i18n-utils.js';
import { escapeLikePattern } from './utils/index.js';

import { getDb, sql } from '../db/client.js';
import { getOrgId } from '../utils/context.js';
import { resolveIdentityByEmail } from './identity-resolver.js';
import {
  resolveDisplayNames,
  toDisplayIdentity,
  toStoredActorIdentity,
  NO_DISPLAY_NAMES,
} from './display-identity.js';
import { nowIso } from '../utils/normalize.js';
import { normalizeEmail } from '../../shared/email.js';
import { migrateLibraryItem } from '../../shared/slide-types/schema-version.js';
import { mergeLibraryI18n } from '../../shared/slide-library/merge-content.js';
import { AppError, revisionConflict } from '../utils/errors.js';
import { isUuid } from '../utils/uuid.js';
import { replaceTagLinks } from './tags.js';
import {
  normalizeLang,
  refuseNonCanonicalVersionKeys,
  TRANSLATION_LANGS,
} from './presentations/index.js';

/**
 * The refusal of a change to a shared item by someone who is neither its
 * creator nor an admin (D170). Without a message the envelope's only text was
 * the code `forbidden`, and that is what a client showed (B411).
 */
const NOT_EDITABLE = {
  ok: false,
  reason: 'forbidden',
  message: 'Only its maker or an admin can change this shared slide.',
};

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
 * Map a slide_library row to the facade's API object.
 * @param {object} row - Database row
 * @param {import('./display-identity.js').DisplayNameLookup} [lookup] -
 *   Resolved display names; omitted derives them from the stored address.
 * @param {string|null} [viewerEmail] - Who is reading: `favorite` is theirs.
 * @returns {object}
 */
export function mapSlideLibraryRow(
  row,
  lookup = NO_DISPLAY_NAMES,
  viewerEmail = null,
) {
  // Through the deck funnel on every read, like a presentation (B286): the
  // stored content can predate any step of the schema ledger, and every reader
  // of the library - preview, insert, compose, public API, MCP - reads here.
  const { slideType, content, i18n } = migrateLibraryItem({
    slideType: row.slide_type,
    content: row.content || {},
    i18n: row.i18n || {},
  });
  return {
    id: row.id,
    shelf: row.shelf,
    ownerEmail: row.owner_email,
    name: row.name,
    description: row.description || '',
    slideType,
    themeId: row.theme_id,
    content,
    i18n,
    // A favorite is per user (D170): the item carries the reader's own flag,
    // derived from the stored `favorites` addresses. The addresses themselves
    // never leave this layer — on the organization shelf they would name every
    // colleague who starred the item (D22: an address is not a display value).
    favorite: isFavoriteOf(row, viewerEmail),
    // The optimistic-concurrency token (D170): the client sends it back as
    // `If-Match`, and a name/description/content write raises it.
    revision: row.revision ?? 0,
    trashedAt: row.trashed_at,
    // Everyone named on an item is a display pair (D22): the stable `users.id`
    // (migration 070) and the name to render, never the address. The id is
    // still the key — the organization-shelf trash/delete guard matches on
    // `createdBy.id`; see shared/identity-match.js.
    // `slide_library.trashed_by` never got an id column (migration 070
    // explains why), so the id comes from the lookup that resolved the name.
    trashedBy: toStoredActorIdentity(row.trashed_by, null, lookup),
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Whether `viewerEmail` starred this row. The stored addresses went through
 * `normalizeEmail` (the favorite patch below, migration 092 for older rows).
 * @param {{favorites?: string[]|null}} row
 * @param {string|null} viewerEmail
 * @returns {boolean}
 */
function isFavoriteOf(row, viewerEmail) {
  const viewer = normalizeEmail(viewerEmail);
  return !!viewer && (row.favorites || []).includes(viewer);
}

/**
 * Map rows for the reader the context names (`ctx.actorEmail`: the caller).
 * @param {object[]} rows
 * @param {object} ctx - Storage context
 * @returns {Promise<object[]>}
 */
async function mapRowsFor(rows, ctx) {
  const lookup = await libraryDisplayNames(rows);
  return rows.map((row) => mapSlideLibraryRow(row, lookup, ctx?.actorEmail));
}

// ============================================================
// Storage queries (organization-scoped)
// ============================================================

// ============================================================
// The shelves as lists (B822, D358)
// ============================================================
//
// A shelf used to answer every item of the organization's shelf, trashed or
// not, and the picker filtered, searched and counted in the browser; v1 kept
// the untrashed ones after the read and sliced. A predicate applied after the
// cut makes a page untrue, so every predicate is SQL here and the page is a
// keyset page (`./keyset.js`):
//
//   - the shelf (`personal` needs its owner's address; without one it is
//     empty, never every personal item of the organization);
//   - `trashed`: the trash, ordered `(trashed_at desc, id desc)`, or the
//     shelf itself, ordered `(created_at desc, id desc)`;
//   - `themeId`, `slideType`: equality;
//   - `tags`: the item carries **every** named tag, compared on `lower(name)`
//     as the tag identity is (migration 018, ./tags.js);
//   - `lang`: the item has a version in that language, or is written in it
//     (`i18n.dominant`, else the default deck language) — the rule of
//     `hasContentForLang` (client/views/slide-library/search.js);
//   - `q`: a case-insensitive substring of the name, the description, the
//     slide type, a tag name or any string in the content.
//
// The facets (counts per slide type and per tag) are their own query over the
// same shelf, so a count never depends on which page the reader holds.

/**
 * @typedef {Object} LibraryListFilter
 * @property {'personal'|'organization'} shelf
 * @property {string} [ownerEmail] - The owner; required on `personal`.
 * @property {boolean|null} [trashed=false] - The shelf's trash instead of the
 *   shelf; `null` = both (the backup, which never pages).
 * @property {string} [themeId]
 * @property {string} [slideType]
 * @property {string[]} [tags] - Every one of these tag names.
 * @property {string} [lang] - A deck language the item has content in.
 * @property {string} [q] - Search text.
 */

/** The sort column of a shelf or its trash. */
function librarySortColumn({ trashed = false } = {}) {
  return trashed ? 'trashed_at' : 'created_at';
}

/**
 * Whether the filter can match anything at all: a personal shelf without an
 * owner names nobody.
 * @param {LibraryListFilter} filter
 * @returns {boolean}
 */
function libraryListPossible(filter) {
  return filter.shelf !== 'personal' || !!normalizeEmail(filter.ownerEmail);
}

/**
 * The item carries a tag with this name in its organization.
 * @param {Object} eb
 * @param {string} orgId
 * @param {(tag: Object) => Object} match - Condition on `t.name`.
 */
function taggedWhere(eb, orgId, match) {
  return eb.exists(
    eb
      .selectFrom('slide_library_tags as slt')
      .innerJoin('tags as t', 't.id', 'slt.tag_id')
      .select(eb.lit(1).as('one'))
      .whereRef('slt.slide_library_id', '=', 'slide_library.id')
      .where('t.organization_id', '=', orgId)
      .where(match),
  );
}

/**
 * The shelf query before its order and page: scope, shelf and every filter.
 *
 * @param {Object} db
 * @param {string} orgId
 * @param {LibraryListFilter} filter
 */
function libraryListQuery(db, orgId, filter) {
  const {
    shelf,
    ownerEmail,
    trashed = false,
    themeId,
    slideType,
    tags,
    lang,
    q,
  } = filter;
  let qb = db
    .selectFrom('slide_library')
    .selectAll()
    .where('slide_library.organization_id', '=', orgId)
    .where('slide_library.shelf', '=', shelf);
  if (trashed !== null) {
    qb = qb.where('slide_library.trashed_at', trashed ? 'is not' : 'is', null);
  }
  if (shelf === 'personal') {
    qb = qb.where(
      'slide_library.owner_email',
      '=',
      normalizeEmail(ownerEmail) || '',
    );
  }
  if (themeId) qb = qb.where('slide_library.theme_id', '=', themeId);
  if (slideType) qb = qb.where('slide_library.slide_type', '=', slideType);
  for (const name of tags || []) {
    qb = qb.where((eb) =>
      taggedWhere(eb, orgId, (inner) =>
        inner(
          inner.fn('lower', ['t.name']),
          '=',
          inner.fn('lower', [inner.val(name)]),
        ),
      ),
    );
  }
  if (lang) {
    qb = qb.where(
      sql`(
        jsonb_typeof(slide_library.i18n #> ARRAY['versions', ${lang}::text, 'content']) = 'object'
        OR COALESCE(NULLIF(slide_library.i18n ->> 'dominant', ''), ${DEFAULT_DECK_LANG}) = ${lang}::text
      )`,
    );
  }
  const text = typeof q === 'string' ? q.trim() : '';
  if (text) {
    const pattern = `%${escapeLikePattern(text)}%`;
    qb = qb.where((eb) =>
      eb.or([
        eb('slide_library.name', 'ilike', pattern),
        eb('slide_library.description', 'ilike', pattern),
        eb('slide_library.slide_type', 'ilike', pattern),
        taggedWhere(eb, orgId, (inner) => inner('t.name', 'ilike', pattern)),
        sql`EXISTS (
          SELECT 1 FROM jsonb_path_query(COALESCE(slide_library.content, '{}'::jsonb), 'strict $.**') AS v
          WHERE jsonb_typeof(v) = 'string' AND (v #>> '{}') ILIKE ${pattern}
        )`,
      ]),
    );
  }
  return qb;
}

/**
 * Counts per slide type and per tag over the untrashed items of a shelf, in
 * the language scope when one is named (the picker's filter chips), and the
 * shelf's `total` without the language scope (so an empty list can say
 * whether the shelf or the language is empty). Type, tag and search filters
 * are not applied: the chips count the shelf the reader narrows, not the
 * narrowed list.
 *
 * @param {Object} db
 * @param {string} orgId
 * @param {Pick<LibraryListFilter, 'shelf'|'ownerEmail'|'themeId'|'lang'>} filter
 * @returns {Promise<{total: number, types: Array<{slideType: string, count: number}>, tags: Array<{name: string, count: number}>}>}
 */
async function libraryFacetCounts(db, orgId, filter) {
  const base = libraryListQuery(db, orgId, {
    shelf: filter.shelf,
    ownerEmail: filter.ownerEmail,
    themeId: filter.themeId,
    lang: filter.lang,
  }).clearSelect();
  const shelfOnly = libraryListQuery(db, orgId, {
    shelf: filter.shelf,
    ownerEmail: filter.ownerEmail,
    themeId: filter.themeId,
  }).clearSelect();
  const [totalRow, typeRows, tagRows] = await Promise.all([
    shelfOnly.select((eb) => eb.fn.countAll().as('count')).executeTakeFirst(),
    base
      .select(['slide_library.slide_type as slideType'])
      .select((eb) => eb.fn.countAll().as('count'))
      .groupBy('slide_library.slide_type')
      .execute(),
    base
      .innerJoin(
        'slide_library_tags as slt',
        'slt.slide_library_id',
        'slide_library.id',
      )
      .innerJoin('tags as t', 't.id', 'slt.tag_id')
      .where('t.organization_id', '=', orgId)
      .select(['t.name as name'])
      .select((eb) => eb.fn.countAll().as('count'))
      .groupBy('t.name')
      .execute(),
  ]);
  const byCount = (a, b) =>
    b.count - a.count || String(a.key).localeCompare(String(b.key));
  return {
    total: Number(totalRow?.count ?? 0),
    types: typeRows
      .map((row) => ({ key: row.slideType, count: Number(row.count) }))
      .filter((row) => row.key)
      .sort(byCount)
      .map(({ key, count }) => ({ slideType: key, count })),
    tags: tagRows
      .map((row) => ({ key: row.name, count: Number(row.count) }))
      .sort(byCount)
      .map(({ key, count }) => ({ name: key, count })),
  };
}

/**
 * The rows of one shelf (or its trash) under a filter, as one keyset page or
 * (without `limit`) the whole list. The predicate is SQL
 * (§ The shelves as lists above); nothing is removed after the read.
 *
 * @param {object} ctx - Storage context
 * @param {LibraryListFilter} filter
 * @param {{limit?: number, after?: {value: string, id: string}|null}} [page]
 * @returns {Promise<{items: object[], next: {value: string, id: string}|null}>}
 */
async function listSlideLibraryRows(ctx, filter, { limit, after = null } = {}) {
  if (!libraryListPossible(filter)) return { items: [], next: null };
  const qb = libraryListQuery(getDb(), getOrgId(ctx), filter);
  const column = librarySortColumn(filter);
  let rows;
  let next = null;
  if (limit === undefined) {
    rows = await qb.orderBy(column, 'desc').orderBy('id', 'desc').execute();
  } else {
    ({ rows, next } = keysetRows(
      await keysetPage(qb, { column, after, limit }).execute(),
      limit,
    ));
  }
  return { items: await mapRowsFor(rows, ctx), next };
}

async function getSlideLibraryRow(id, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  const row = await db
    .selectFrom('slide_library')
    .selectAll()
    .where('id', '=', id)
    .where('organization_id', '=', orgId)
    .executeTakeFirst();

  if (!row) return null;
  return (await mapRowsFor([row], ctx))[0];
}

/**
 * The `i18n` a create stores, in the one shape the library reads (B482).
 *
 * Create is the one write that carries `i18n` from the caller (a PATCH derives
 * it from `content`, D170), so this is the seam. A version key that is not its
 * own `normalizeLang` form is refused, the same check as a deck's. `dominant`
 * is a language *value* and is normalized like a deck's (`en` -> `en-GB`); one
 * off the axis is refused, because `mergeLibraryI18n` writes
 * `versions[dominant]` on every content PATCH and would mint that key there.
 *
 * Omitted i18n, versions and version content are allowed. Present values must
 * be objects, including each version record; null is not omission.
 *
 * @param {unknown} i18n
 * @returns {object}
 * @throws {AppError} 400 `invalid`, `details.field` names the refused path
 */
function canonicalCreateI18n(i18n) {
  if (i18n === undefined) return {};
  requireI18nObject(i18n, 'i18n');
  if ('versions' in i18n) {
    requireI18nObject(i18n.versions, 'i18n.versions');
    refuseNonCanonicalVersionKeys(i18n.versions);
    for (const [lang, version] of Object.entries(i18n.versions)) {
      const field = `i18n.versions.${lang}`;
      requireI18nObject(version, field);
      if ('content' in version) {
        requireI18nObject(version.content, `${field}.content`);
      }
    }
  }
  if (i18n.dominant === undefined) return i18n;
  const dominant = normalizeLang(i18n.dominant);
  if (!dominant) {
    throw new AppError(
      `i18n.dominant ${JSON.stringify(i18n.dominant)} is not a deck language: use one of ${TRANSLATION_LANGS.join(', ')}`,
      400,
      { field: 'i18n.dominant' },
      'invalid',
    );
  }
  return { ...i18n, dominant };
}

/** Refuse malformed language data before any create writes to the database. */
function requireI18nObject(value, field) {
  if (!isPlainObject(value)) {
    throw new AppError(`${field} must be an object`, 400, { field }, 'invalid');
  }
}

/**
 * Insert a library row. The `i18n` is checked before anything is written
 * (`canonicalCreateI18n`).
 */
async function createSlideLibraryRow(data, ctx) {
  const i18n = canonicalCreateI18n(data.i18n);

  const db = getDb();
  const orgId = getOrgId(ctx);

  // Dual-key (T10 PR F2): resolve the id once and stamp it beside both the
  // created_by and updated_by e-mail (the same actor at create), so the
  // organization-library authz guard can match on the stable id.
  const actorEmail = normalizeEmail(ctx?.actorEmail);
  const actorResolution = actorEmail
    ? await resolveIdentityByEmail(ctx, actorEmail)
    : null;
  const actorUserId = actorResolution?.userId ?? null;

  const row = await db
    .insertInto('slide_library')
    .values({
      organization_id: orgId,
      owner_email: normalizeEmail(data.ownerEmail) || actorEmail,
      shelf: data.shelf || 'personal',
      name: data.name,
      description: data.description || null,
      slide_type: data.slideType,
      theme_id: data.themeId || null,
      content: jsonb(data.content || {}),
      i18n: jsonb(i18n),
      // A new item has no favorites; starring is a PATCH of its own.
      favorites: sql`'{}'::text[]`,
      created_by: actorEmail,
      created_by_user_id: actorUserId,
      updated_by: actorEmail,
      updated_by_user_id: actorUserId,
    })
    .returningAll()
    .executeTakeFirst();

  return (await mapRowsFor([row], ctx))[0];
}

// ============================================================
// The save contract (D170)
// ============================================================

/**
 * The keys a library PATCH may carry. `i18n` is deliberately absent: the
 * language versions are derived by the server from `content`
 * (`mergeLibraryI18n`), and a second route to the same state is how they went
 * stale. `slideType`, `themeId` and `shelf` are fixed at create.
 */
const PATCH_KEYS = Object.freeze([
  'name',
  'description',
  'content',
  'trashed',
  'favorite',
]);

/** The keys that change what an item *is*: they need `If-Match` and raise the revision. */
const EDIT_KEYS = Object.freeze(['name', 'description', 'content']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Refuse a patch outside the closed key set, or with a value of the wrong
 * shape. One refusal names one field; the first one found wins. The route
 * calls it before it looks at `If-Match`, and `patchLibraryItem` calls it
 * again, so no writer reaches the table with an open patch.
 * @param {*} patch
 * @returns {{ok: false, reason: 'invalid', field: string}|null}
 */
export function libraryPatchViolation(patch) {
  if (!isPlainObject(patch))
    return { ok: false, reason: 'invalid', field: 'body' };
  // A key outside the set is a fault of the body as a whole: `field` is a
  // literal token (tests/storage-reason-vocabulary.test.js), so the key itself
  // travels in the message.
  const unknown = Object.keys(patch).find((k) => !PATCH_KEYS.includes(k));
  if (unknown !== undefined) {
    return {
      ok: false,
      reason: 'invalid',
      field: 'body',
      message: `A library PATCH takes ${PATCH_KEYS.join(', ')}; "${unknown}" is not one of them`,
    };
  }
  if ('name' in patch && (typeof patch.name !== 'string' || !patch.name.trim()))
    return { ok: false, reason: 'invalid', field: 'name' };
  if ('description' in patch && typeof patch.description !== 'string')
    return { ok: false, reason: 'invalid', field: 'description' };
  if ('content' in patch && !isPlainObject(patch.content))
    return { ok: false, reason: 'invalid', field: 'content' };
  if ('trashed' in patch && typeof patch.trashed !== 'boolean')
    return { ok: false, reason: 'invalid', field: 'trashed' };
  if ('favorite' in patch && typeof patch.favorite !== 'boolean')
    return { ok: false, reason: 'invalid', field: 'favorite' };
  return null;
}

function conflictError(item) {
  return revisionConflict(
    'Conflict: this library slide was changed by someone else. Reload and try again.',
    { ...item, modified: item.updatedAt },
  );
}

/**
 * Select the one row a mutation may touch: this id, this organization, this
 * shelf, and on the personal shelf this owner. Everything a mutation writes or
 * deletes carries the same WHERE, so an item outside it is not merely refused
 * — it does not exist for the caller (`not_found`).
 */
function whereItem(query, { id, orgId, shelf, ownerEmail }) {
  let q = query
    .where('id', '=', id)
    .where('organization_id', '=', orgId)
    .where('shelf', '=', shelf);
  if (shelf === 'personal')
    q = q.where('owner_email', '=', normalizeEmail(ownerEmail) || '');
  return q;
}

async function readItem(ctx, target) {
  const row = await whereItem(getDb().selectFrom('slide_library').selectAll(), {
    ...target,
    orgId: getOrgId(ctx),
  }).executeTakeFirst();
  if (!row) return null;
  return (await mapRowsFor([row], ctx))[0];
}

/**
 * The SQL that sets or clears one caller's favorite, idempotently: remove the
 * address, then append it again when the flag is on. One statement, so two
 * toggles never lose each other's write.
 * @param {string} email - Normalized caller address
 * @param {boolean} on
 */
function favoritesWith(email, on) {
  const without = sql`array_remove(coalesce(favorites, '{}'::text[]), ${email}::text)`;
  return on ? sql`array_append(${without}, ${email}::text)` : without;
}

/**
 * Apply a library PATCH under the save contract (D170).
 *
 * @param {object} ctx - Storage context
 * @param {object} target
 * @param {string} target.id
 * @param {'personal'|'organization'} target.shelf
 * @param {string} [target.ownerEmail] - The owner, on the personal shelf
 * @param {object} patch - Keys from `PATCH_KEYS`
 * @param {object} opts
 * @param {number|null} [opts.expectedRevision] - Required when the patch has an `EDIT_KEYS` key
 * @param {(item: object) => boolean|Promise<boolean>} [opts.allowEdit] - The
 *   organization-shelf guard; an organization edit or trash without one is refused
 * @param {string|null} [opts.trashedBy] - Who a trash toggle is attributed to
 * @returns {Promise<{ok: true, item: object}|{ok: false, reason: string, field?: string, message?: string}>}
 * @throws {ConflictError} When `expectedRevision` is not the stored revision
 */
async function patchLibraryItem(ctx, target, patch, opts = {}) {
  const invalid = libraryPatchViolation(patch);
  if (invalid) return invalid;
  const edits = EDIT_KEYS.some((k) => k in patch);
  const { expectedRevision = null } = opts;
  if (edits && !Number.isInteger(expectedRevision)) {
    // The route answers 428 before it gets here; reaching this is a caller bug.
    throw new TypeError('patchLibraryItem: an edit needs expectedRevision');
  }

  const existing = await readItem(ctx, target);
  if (!existing) return { ok: false, reason: 'not_found' };

  if (target.shelf === 'organization' && (edits || 'trashed' in patch)) {
    // Fail closed: a shared item is changed by its creator or an admin, and a
    // caller that brings no guard is not either.
    const allowed =
      typeof opts.allowEdit === 'function' && (await opts.allowEdit(existing));
    if (!allowed) return { ...NOT_EDITABLE };
  }
  if (edits && existing.revision !== expectedRevision) {
    throw conflictError(existing);
  }
  const updateData = {};
  if ('name' in patch) updateData.name = patch.name.trim();
  if ('description' in patch) updateData.description = patch.description;
  if ('content' in patch) {
    updateData.content = jsonb(patch.content);
    updateData.i18n = jsonb(
      mergeLibraryI18n({
        slideType: existing.slideType,
        content: patch.content,
        i18n: existing.i18n,
      }),
    );
  }
  if ('trashed' in patch) {
    updateData.trashed_at = patch.trashed ? nowIso() : null;
    updateData.trashed_by = patch.trashed
      ? normalizeEmail(opts.trashedBy)
      : null;
  }
  // Only a change to the item itself is stamped as an update; a favorite is
  // the caller's own mark and leaves `updated_at`/`updated_by` alone.
  const changesItem = Object.keys(updateData).length > 0;
  if ('favorite' in patch) {
    const viewer = normalizeEmail(ctx?.actorEmail);
    // Every route passes the caller; reaching this without one is a caller bug.
    if (!viewer)
      throw new TypeError('patchLibraryItem: a favorite needs an actor');
    updateData.favorites = favoritesWith(viewer, patch.favorite);
  }
  if (Object.keys(updateData).length === 0) return { ok: true, item: existing };

  if (changesItem) updateData.updated_at = nowIso();
  // Dual-key (T10 PR F2): stamp updated_by_user_id from the same resolution
  // only when there is an actor to stamp, so an actor-less write never nulls
  // the id half while the e-mail half keeps the previous writer.
  if (changesItem && ctx?.actorEmail) {
    const actorResolution = await resolveIdentityByEmail(ctx, ctx.actorEmail);
    updateData.updated_by = normalizeEmail(ctx.actorEmail);
    updateData.updated_by_user_id = actorResolution?.userId ?? null;
  }
  if (edits) updateData.revision = expectedRevision + 1;

  let query = whereItem(getDb().updateTable('slide_library').set(updateData), {
    ...target,
    orgId: getOrgId(ctx),
  });
  // The revision test is part of the UPDATE, so it is atomic: a write that
  // landed between the read above and this statement makes it match nothing.
  if (edits) query = query.where('revision', '=', expectedRevision);
  const row = await query.returningAll().executeTakeFirst();
  if (row) return { ok: true, item: (await mapRowsFor([row], ctx))[0] };
  const now = await readItem(ctx, target);
  if (now && edits) throw conflictError(now);
  return { ok: false, reason: 'not_found' };
}

async function deleteLibraryItem(ctx, target) {
  const result = await whereItem(getDb().deleteFrom('slide_library'), {
    ...target,
    orgId: getOrgId(ctx),
  }).executeTakeFirst();
  return result.numDeletedRows > 0;
}

// Personal library functions

/**
 * Every item on `userEmail`'s personal shelf, trashed ones included, newest
 * first: the backup's read (bulk export). Lists a reader pages through go
 * through {@link listLibraryShelf}.
 */
export async function listPersonalLibrary(scope, userEmail) {
  const ctx = toStorageContext(scope, 'listPersonalLibrary', {
    userEmail,
  });
  const { items } = await listSlideLibraryRows(ctx, {
    shelf: 'personal',
    ownerEmail: userEmail,
    trashed: null,
  });
  return { items };
}

export async function createPersonalLibraryItem(
  scope,
  userEmail,
  input,
  { actorEmail } = {},
) {
  const ctx = toStorageContext(scope, 'createPersonalLibraryItem', {
    userEmail,
    actorEmail,
  });
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const slideType =
    typeof input?.slideType === 'string' ? input.slideType.trim() : '';
  if (!name) return { ok: false, reason: 'name_required' };
  if (!slideType) return { ok: false, reason: 'slide_type_required' };
  const result = await createSlideLibraryRow(
    {
      ...input,
      shelf: 'personal',
      ownerEmail: userEmail,
    },
    ctx,
  );
  if (!result) return { ok: false, reason: 'create_failed' };
  return { ok: true, item: result };
}

/**
 * Patch an item on `userEmail`'s personal shelf. Someone else's item, and any
 * organization item, is `not_found`. See `patchLibraryItem` for the contract.
 */
export async function updatePersonalLibraryItem(
  scope,
  userEmail,
  id,
  patch,
  { actorEmail, expectedRevision = null } = {},
) {
  const ctx = toStorageContext(scope, 'updatePersonalLibraryItem', {
    userEmail,
    actorEmail,
  });
  return patchLibraryItem(
    ctx,
    { id, shelf: 'personal', ownerEmail: userEmail },
    patch,
    { expectedRevision, trashedBy: actorEmail || userEmail },
  );
}

export async function deletePersonalLibraryItem(scope, userEmail, id) {
  const ctx = toStorageContext(scope, 'deletePersonalLibraryItem', {
    userEmail,
  });
  const deleted = await deleteLibraryItem(ctx, {
    id,
    shelf: 'personal',
    ownerEmail: userEmail,
  });
  if (!deleted) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

// Organization-shelf library functions

/**
 * Every item on the organization shelf, trashed ones included, newest first:
 * the backup's read (bulk export).
 */
export async function listOrganizationLibrary(scope, { userEmail = '' } = {}) {
  const ctx = toStorageContext(scope, 'listOrganizationLibrary', {
    userEmail,
  });
  const { items } = await listSlideLibraryRows(ctx, {
    shelf: 'organization',
    trashed: null,
  });
  return { items };
}

/**
 * The filter a shelf is read under, from the reader's point of view: on the
 * personal shelf the reader is the owner (only their own items).
 * @param {LibraryListFilter & {readerEmail?: string|null}} filter
 * @returns {LibraryListFilter}
 */
function readerFilter({ readerEmail, ...filter }) {
  return {
    ...filter,
    ownerEmail: filter.shelf === 'personal' ? readerEmail : undefined,
  };
}

/**
 * One page of a shelf (or its trash) as a reader sees it (B822, D358): the
 * filter is applied in the query, the order is `(created_at desc, id desc)`
 * on the shelf and `(trashed_at desc, id desc)` in the trash. Without
 * `limit` the whole filtered list. Each item carries the reader's own
 * `favorite`.
 *
 * @param {object} scope
 * @param {LibraryListFilter & {readerEmail?: string|null}} filter - `readerEmail`
 *   is who reads; on `personal` also whose shelf it is.
 * @param {{limit?: number, after?: {value: string, id: string}|null}} [page]
 * @returns {Promise<{items: object[], next: {value: string, id: string}|null}>}
 */
export async function listLibraryShelf(scope, filter, page = {}) {
  const ctx = toStorageContext(scope, 'listLibraryShelf', {
    userEmail: filter?.readerEmail,
  });
  return listSlideLibraryRows(
    ctx,
    { trashed: false, ...readerFilter(filter) },
    page,
  );
}

/**
 * Counts per slide type and per tag over a shelf's untrashed items, in the
 * language scope when one is named: the picker's filter chips, as their own
 * query (B822).
 *
 * @param {object} scope
 * @param {Pick<LibraryListFilter, 'shelf'|'themeId'|'lang'> & {readerEmail?: string|null}} filter
 * @returns {Promise<{total: number, types: Array<{slideType: string, count: number}>, tags: Array<{name: string, count: number}>}>}
 */
export async function getLibraryShelfFacets(scope, filter) {
  const ctx = toStorageContext(scope, 'getLibraryShelfFacets', {
    userEmail: filter?.readerEmail,
  });
  const shelfFilter = readerFilter(filter);
  if (!libraryListPossible(shelfFilter)) {
    return { total: 0, types: [], tags: [] };
  }
  return libraryFacetCounts(getDb(), getOrgId(ctx), shelfFilter);
}

/**
 * The library items with these ids that the reader may see, in the order the
 * ids are given: organization-shelf items, and personal items only when they
 * are the reader's own. Trashed items come back with their `trashedAt`; an id
 * the reader may not see, or that does not exist, is left out. This resolves
 * a collection's members (`GET /api/slide-collections/:shelf/:id/slides`), a
 * list bounded by the collection, not a list page.
 *
 * @param {object} scope
 * @param {string[]} ids
 * @param {{userEmail?: string}} [opts] - The reader.
 * @returns {Promise<object[]>}
 */
export async function getLibraryItemsByIds(scope, ids, { userEmail } = {}) {
  const ctx = toStorageContext(scope, 'getLibraryItemsByIds', { userEmail });
  const wanted = [...new Set((ids || []).filter(isUuid))];
  if (wanted.length === 0) return [];
  const owner = normalizeEmail(userEmail);
  const rows = await getDb()
    .selectFrom('slide_library')
    .selectAll()
    .where('organization_id', '=', getOrgId(ctx))
    .where('id', 'in', wanted)
    .where((eb) =>
      owner
        ? eb.or([
            eb('shelf', '=', 'organization'),
            eb.and([
              eb('shelf', '=', 'personal'),
              eb('owner_email', '=', owner),
            ]),
          ])
        : eb('shelf', '=', 'organization'),
    )
    .execute();
  const byId = new Map(
    (await mapRowsFor(rows, ctx)).map((item) => [item.id, item]),
  );
  return wanted.map((id) => byId.get(id)).filter(Boolean);
}

/**
 * One item of a shelf as its reader may see it: someone else's personal item,
 * or an item on the other shelf, is null. Trashed items are returned with
 * their `trashedAt`.
 *
 * @param {object} scope
 * @param {{id: string, shelf: 'personal'|'organization'}} target
 * @param {{userEmail?: string}} [opts] - The reader; the owner on `personal`.
 * @returns {Promise<object|null>}
 */
export async function getLibraryShelfItem(scope, target, { userEmail } = {}) {
  const ctx = toStorageContext(scope, 'getLibraryShelfItem', { userEmail });
  return readItem(ctx, { ...target, ownerEmail: userEmail });
}

export async function getOrganizationLibraryItem(
  scope,
  id,
  { userEmail = '' } = {},
) {
  const ctx = toStorageContext(scope, 'getOrganizationLibraryItem', {
    userEmail,
  });
  const item = await getSlideLibraryRow(id, ctx);
  if (!item || item.shelf !== 'organization') return null;
  return item;
}

export async function createOrganizationLibraryItem(
  scope,
  input,
  { actorEmail } = {},
) {
  const ctx = toStorageContext(scope, 'createOrganizationLibraryItem', {
    actorEmail,
  });
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const slideType =
    typeof input?.slideType === 'string' ? input.slideType.trim() : '';
  if (!name) return { ok: false, reason: 'name_required' };
  if (!slideType) return { ok: false, reason: 'slide_type_required' };
  const result = await createSlideLibraryRow(
    {
      ...input,
      shelf: 'organization',
    },
    ctx,
  );
  if (!result) return { ok: false, reason: 'create_failed' };
  return { ok: true, item: result };
}

/**
 * Patch an item on the organization shelf. Changing its name, description or
 * content, or trashing it, passes `allowEdit` — one rule for "change a shared
 * item" (D170); without a guard it is `forbidden`. A personal item is
 * `not_found`. See `patchLibraryItem` for the contract.
 */
export async function updateOrganizationLibraryItem(
  scope,
  id,
  patch,
  { actorEmail, expectedRevision = null, allowEdit } = {},
) {
  const ctx = toStorageContext(scope, 'updateOrganizationLibraryItem', {
    actorEmail,
  });
  return patchLibraryItem(ctx, { id, shelf: 'organization' }, patch, {
    expectedRevision,
    allowEdit,
    trashedBy: actorEmail || null,
  });
}

export async function deleteOrganizationLibraryItem(
  scope,
  id,
  { actorEmail, allowDelete } = {},
) {
  const ctx = toStorageContext(scope, 'deleteOrganizationLibraryItem', {
    actorEmail,
  });
  // Resolve the guard's target directly by id, never through the org list
  // (B85: that list was once capped, and a guard behind the cap failed with a
  // false not_found). A personal item is not on this shelf: not_found. The
  // guard is required — a shared item is deleted by its creator or an admin,
  // and a caller that brings no guard is neither.
  const target = { id, shelf: 'organization' };
  const item = await readItem(ctx, target);
  if (!item) return { ok: false, reason: 'not_found' };
  const ok =
    typeof allowDelete === 'function' &&
    (await allowDelete(item, { actorEmail }));
  if (!ok) return { ...NOT_EDITABLE };
  const deleted = await deleteLibraryItem(ctx, target);
  if (!deleted) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

// Slide library tag functions
// These reuse the organization's existing tags (server/storage/tags), joined
// through slide_library_tags. The single-item reader and the writer select the
// item through `whereItem` first — on the personal shelf the caller is the
// owner, as in `updatePersonalLibraryItem` — so tags follow the save contract (D170): an
// item outside the caller's shelf and owner is `not_found`, and writing tags on
// the organization shelf passes the same guard as a name or content edit. Tags
// are not part of `EDIT_KEYS`: they do not raise `revision` and take no
// `If-Match`. Only the *selection* is library business: the replacement itself
// is `replaceTagLinks` in server/storage/tags.js, shared with presentations.

/**
 * Read the tags of one library item, selected like every mutation selects it.
 *
 * @param {object} scope
 * @param {object} target
 * @param {string} target.id
 * @param {'personal'|'organization'} target.shelf
 * @param {object} [opts]
 * @param {string} [opts.userEmail] - The caller; the owner, on the personal shelf
 * @returns {Promise<{ok: true, tags: Array<{id: string, name: string}>}|{ok: false, reason: 'not_found'}>}
 */
export async function getTagsForSlideLibraryItem(
  scope,
  target,
  { userEmail } = {},
) {
  const ctx = toStorageContext(scope, 'getTagsForSlideLibraryItem', {
    userEmail,
  });
  const existing = await readItem(ctx, {
    id: target.id,
    shelf: target.shelf,
    ownerEmail: userEmail,
  });
  if (!existing) return { ok: false, reason: 'not_found' };

  const rows = await getDb()
    .selectFrom('tags')
    .innerJoin('slide_library_tags', 'tags.id', 'slide_library_tags.tag_id')
    .select(['tags.id', 'tags.name'])
    .where('slide_library_tags.slide_library_id', '=', existing.id)
    .where('tags.organization_id', '=', getOrgId(ctx))
    .orderBy('tags.name', 'asc')
    .execute();

  return {
    ok: true,
    tags: rows.map((row) => ({ id: row.id, name: row.name })),
  };
}

export async function getTagsForSlideLibraryItems(
  scope,
  ids,
  { userEmail } = {},
) {
  const ctx = toStorageContext(scope, 'getTagsForSlideLibraryItems', {
    userEmail,
  });
  if (!ids || ids.length === 0) {
    return new Map();
  }

  const db = getDb();
  const orgId = getOrgId(ctx);

  const rows = await db
    .selectFrom('tags')
    .innerJoin('slide_library_tags', 'tags.id', 'slide_library_tags.tag_id')
    .select([
      'slide_library_tags.slide_library_id as slideLibraryId',
      'tags.id',
      'tags.name',
    ])
    .where('slide_library_tags.slide_library_id', 'in', ids)
    .where('tags.organization_id', '=', orgId)
    .orderBy('tags.name', 'asc')
    .execute();

  const result = new Map();
  for (const row of rows) {
    if (!result.has(row.slideLibraryId)) {
      result.set(row.slideLibraryId, []);
    }
    result.get(row.slideLibraryId).push({
      id: row.id,
      name: row.name,
    });
  }

  return result;
}

/**
 * Replace the tags of one library item. The item is selected through
 * `whereItem` (someone else's personal item, or the wrong shelf, is
 * `not_found`); on the organization shelf the write passes `allowEdit`, the
 * one "change a shared item" rule (D170), and without a guard it is
 * `forbidden`. The replacement itself is `replaceTagLinks`, the one
 * tag-replacement path, and is atomic (B343, D184).
 *
 * @param {object} scope
 * @param {object} target - `{ id, shelf }`, as `getTagsForSlideLibraryItem`
 * @param {string[]} tagNames
 * @param {object} [opts]
 * @param {string} [opts.actorEmail] - The caller; the owner, on the personal shelf
 * @param {(item: object) => boolean|Promise<boolean>} [opts.allowEdit] - The organization-shelf guard
 * @returns {Promise<{ok: true, tags: Array<{id: string, name: string}>}|{ok: false, reason: 'not_found'|'forbidden'|'invalid'}>}
 */
export async function setTagsForSlideLibraryItem(
  scope,
  target,
  tagNames,
  { actorEmail, allowEdit } = {},
) {
  const ctx = toStorageContext(scope, 'setTagsForSlideLibraryItem', {
    actorEmail,
  });
  const existing = await readItem(ctx, {
    id: target.id,
    shelf: target.shelf,
    ownerEmail: actorEmail,
  });
  if (!existing) return { ok: false, reason: 'not_found' };
  if (target.shelf === 'organization') {
    const allowed =
      typeof allowEdit === 'function' && (await allowEdit(existing));
    if (!allowed) return { ...NOT_EDITABLE };
  }
  // A refused tag name is already an `invalid` result; it travels as it is.
  return replaceTagLinks(scope, {
    linkTable: 'slide_library_tags',
    rowId: existing.id,
    tagNames,
  });
}

/**
 * Resolve the display names a batch of library rows needs.
 * @param {Array<Object>} rows - Raw `slide_library` rows.
 * @returns {Promise<import('./display-identity.js').DisplayNameLookup>}
 */
async function libraryDisplayNames(rows) {
  return resolveDisplayNames(
    crossOrganizationScope(
      null,
      'global identity display and stable user identifier lookup',
    ),
    (rows || [])
      .filter(Boolean)
      .flatMap((row) => [
        { id: row.updated_by_user_id, email: row.updated_by },
        { id: row.created_by_user_id, email: row.created_by },
        { email: row.trashed_by },
      ]),
  );
}

/** Write validated sandbox library seeds in one transaction, preserving stable IDs. */
export async function upsertSandboxLibrarySeed(
  scope,
  { owner, slides, collections },
) {
  const { organizationId: orgId } = toStorageContext(
    scope,
    'upsertSandboxLibrarySeed',
  );
  const slideIds = new Map(slides.map((slide) => [slide.key, slide.id]));
  await getDb()
    .transaction()
    .execute(async (trx) => {
      for (const slide of slides) {
        await sql`
          INSERT INTO slide_library (id, organization_id, owner_email, shelf, name, description,
            slide_type, theme_id, content, i18n, favorites, created_by, updated_by)
          VALUES (${slide.id}, ${orgId}, ${owner}, 'organization',
            ${slide.name}, ${slide.description || null}, ${slide.slideType},
            ${slide.themeId}, ${JSON.stringify(slide.content)}::jsonb,
            ${JSON.stringify({ dominant: slide.lang })}::jsonb,
            '{}'::text[], ${owner}, ${owner})
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, description = EXCLUDED.description,
            slide_type = EXCLUDED.slide_type, theme_id = EXCLUDED.theme_id,
            content = EXCLUDED.content, i18n = EXCLUDED.i18n, trashed_at = NULL, trashed_by = NULL,
            updated_at = now()
          WHERE (slide_library.name, slide_library.description, slide_library.slide_type,
              slide_library.theme_id, slide_library.content, slide_library.i18n,
              slide_library.trashed_at)
            IS DISTINCT FROM
            (EXCLUDED.name, EXCLUDED.description, EXCLUDED.slide_type,
              EXCLUDED.theme_id, EXCLUDED.content, EXCLUDED.i18n, NULL::timestamptz)
        `.execute(trx);
      }
      for (const collection of collections) {
        const id = collection.id;
        await sql`
          INSERT INTO slide_collections (id, organization_id, owner_email, shelf, name, description,
            created_by, updated_by)
          VALUES (${id}, ${orgId}, ${owner}, 'organization', ${collection.name},
            ${collection.description || null}, ${owner}, ${owner})
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, description = EXCLUDED.description, updated_at = now()
          WHERE (slide_collections.name, slide_collections.description)
            IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.description)
        `.execute(trx);
        await trx
          .deleteFrom('slide_collection_items')
          .where('collection_id', '=', id)
          .execute();
        await trx
          .insertInto('slide_collection_items')
          .values(
            collection.slides.map((key, position) => ({
              collection_id: id,
              slide_library_id: slideIds.get(key),
              position,
            })),
          )
          .execute();
      }
    });
}

// White-box seam: tests/pg/library-list-page.pgtest.js EXPLAINs the exact
// query a page runs. The `__` prefix marks it internal.
export const __libraryList = { libraryListQuery };
