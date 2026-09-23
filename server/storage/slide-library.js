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
 * storageScope attributes the write to (`actorEmail`).
 *
 * Queries run directly through Kysely (B79/D34 removed the adapter
 * indirection); getDb() throws on an uninitialized database.
 */

import { getDb, sql } from '../db/client.js';
import { getOrgId } from '../utils/context.js';
import { resolveIdentityByEmail } from './identity-resolver.js';
import { toStorageContext } from './scope.js';
import {
  resolveDisplayNames,
  toDisplayIdentity,
  toStoredActorIdentity,
  NO_DISPLAY_NAMES,
} from './display-identity.js';
import { nowIso } from '../utils/normalize.js';
import { migrateLibraryItem } from '../../shared/slide-types/schema-version.js';
import { mergeLibraryI18n } from '../../shared/slide-library/merge-content.js';
import { revisionConflict } from '../utils/errors.js';
import { replaceTagLinks } from './tags.js';

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
 * Whether `viewerEmail` starred this row. The stored addresses are the
 * lowercased caller addresses the routes pass in.
 * @param {{favorites?: string[]|null}} row
 * @param {string|null} viewerEmail
 * @returns {boolean}
 */
function isFavoriteOf(row, viewerEmail) {
  const viewer = normalizeEmail(viewerEmail);
  return !!viewer && (row.favorites || []).includes(viewer);
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
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

/**
 * @param {object} ctx - Storage context
 * @param {object} [opts]
 * @param {string} [opts.shelf] - 'personal' or 'organization'
 * @param {string} [opts.ownerEmail] - Filter by owner
 * @param {string} [opts.themeId] - Filter by theme
 */
async function listSlideLibraryRows(ctx, opts = {}) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  let query = db
    .selectFrom('slide_library')
    .selectAll()
    .where('organization_id', '=', orgId);

  // Don't filter out trashed items - client handles trash view filtering

  if (opts?.shelf) {
    query = query.where('shelf', '=', opts.shelf);
  }
  if (opts?.ownerEmail) {
    query = query.where('owner_email', '=', opts.ownerEmail);
  }
  if (opts?.themeId) {
    query = query.where('theme_id', '=', opts.themeId);
  }

  query = query.orderBy('created_at', 'desc');
  // Returns the full organization-scoped set. B79 inherited applyPagination()'s
  // default 100-row cap as a literal .limit(100), which silently dropped the
  // tail for orgs with >100 items; B85 removed it. Every consumer treats this as
  // the complete list (the public-api route paginates over it in-memory,
  // bulk-export backs it up) — DB-level pagination is a future deliberate
  // feature, not an accidental cap. See docs/reference/storage-layer.md
  // § List reads.
  const rows = await query.execute();

  return mapRowsFor(rows, ctx);
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

async function createSlideLibraryRow(data, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  // Dual-key (T10 PR F2): resolve the id once and stamp it beside both the
  // created_by and updated_by e-mail (the same actor at create), so the
  // organization-library authz guard can match on the stable id.
  const actorEmail = ctx?.actorEmail || null;
  const actorResolution = actorEmail
    ? await resolveIdentityByEmail(actorEmail)
    : null;
  const actorUserId = actorResolution?.userId ?? null;

  const row = await db
    .insertInto('slide_library')
    .values({
      organization_id: orgId,
      owner_email: data.ownerEmail || ctx?.actorEmail || null,
      shelf: data.shelf || 'personal',
      name: data.name,
      description: data.description || null,
      slide_type: data.slideType,
      theme_id: data.themeId || null,
      content: jsonb(data.content || {}),
      i18n: jsonb(data.i18n || {}),
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
  if (shelf === 'personal') q = q.where('owner_email', '=', ownerEmail || '');
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
 * @param {(item: object, nextContent: object) => string|null} [opts.contentGuard] -
 *   Returns a refusal message for content the actor may not write; a content
 *   patch without one is refused
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
  if ('content' in patch) {
    // Fail closed, like `allowEdit` (D172): the raw-HTML/CSS capability is the
    // caller's to know, so a writer that brings no gate may not write content.
    if (typeof opts.contentGuard !== 'function')
      return { ok: false, reason: 'forbidden' };
    const message = opts.contentGuard(existing, patch.content);
    if (message) return { ok: false, reason: 'forbidden', message };
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
    updateData.trashed_by = patch.trashed ? opts.trashedBy || null : null;
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
    const actorResolution = await resolveIdentityByEmail(ctx.actorEmail);
    updateData.updated_by = ctx.actorEmail;
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

export async function listPersonalLibrary(
  storageScope,
  userEmail,
  { themeId = '' } = {},
) {
  const ctx = toStorageContext(storageScope, 'listPersonalLibrary', {
    userEmail,
  });
  const items = await listSlideLibraryRows(ctx, {
    shelf: 'personal',
    ownerEmail: userEmail,
    themeId,
  });
  return { items };
}

export async function createPersonalLibraryItem(
  storageScope,
  userEmail,
  input,
  { actorEmail } = {},
) {
  const ctx = toStorageContext(storageScope, 'createPersonalLibraryItem', {
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
  storageScope,
  userEmail,
  id,
  patch,
  { actorEmail, expectedRevision = null, contentGuard } = {},
) {
  const ctx = toStorageContext(storageScope, 'updatePersonalLibraryItem', {
    userEmail,
    actorEmail,
  });
  return patchLibraryItem(
    ctx,
    { id, shelf: 'personal', ownerEmail: userEmail },
    patch,
    { expectedRevision, contentGuard, trashedBy: actorEmail || userEmail },
  );
}

export async function deletePersonalLibraryItem(storageScope, userEmail, id) {
  const ctx = toStorageContext(storageScope, 'deletePersonalLibraryItem', {
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

export async function listOrganizationLibrary(
  storageScope,
  { themeId = '', userEmail = '' } = {},
) {
  const ctx = toStorageContext(storageScope, 'listOrganizationLibrary', {
    userEmail,
  });
  const items = await listSlideLibraryRows(ctx, {
    shelf: 'organization',
    themeId,
  });
  return { items };
}

export async function getOrganizationLibraryItem(
  storageScope,
  id,
  { userEmail = '' } = {},
) {
  const ctx = toStorageContext(storageScope, 'getOrganizationLibraryItem', {
    userEmail,
  });
  const item = await getSlideLibraryRow(id, ctx);
  if (!item || item.shelf !== 'organization') return null;
  return item;
}

export async function createOrganizationLibraryItem(
  storageScope,
  input,
  { actorEmail } = {},
) {
  const ctx = toStorageContext(storageScope, 'createOrganizationLibraryItem', {
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
  storageScope,
  id,
  patch,
  { actorEmail, expectedRevision = null, allowEdit, contentGuard } = {},
) {
  const ctx = toStorageContext(storageScope, 'updateOrganizationLibraryItem', {
    actorEmail,
  });
  return patchLibraryItem(ctx, { id, shelf: 'organization' }, patch, {
    expectedRevision,
    allowEdit,
    contentGuard,
    trashedBy: actorEmail || null,
  });
}

export async function deleteOrganizationLibraryItem(
  storageScope,
  id,
  { actorEmail, allowDelete } = {},
) {
  const ctx = toStorageContext(storageScope, 'deleteOrganizationLibraryItem', {
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
 * @param {object} storageScope
 * @param {object} target
 * @param {string} target.id
 * @param {'personal'|'organization'} target.shelf
 * @param {object} [opts]
 * @param {string} [opts.userEmail] - The caller; the owner, on the personal shelf
 * @returns {Promise<{ok: true, tags: Array<{id: string, name: string}>}|{ok: false, reason: 'not_found'}>}
 */
export async function getTagsForSlideLibraryItem(
  storageScope,
  target,
  { userEmail } = {},
) {
  const ctx = toStorageContext(storageScope, 'getTagsForSlideLibraryItem', {
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
  storageScope,
  ids,
  { userEmail } = {},
) {
  const ctx = toStorageContext(storageScope, 'getTagsForSlideLibraryItems', {
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
 * @param {object} storageScope
 * @param {object} target - `{ id, shelf }`, as `getTagsForSlideLibraryItem`
 * @param {string[]} tagNames
 * @param {object} [opts]
 * @param {string} [opts.actorEmail] - The caller; the owner, on the personal shelf
 * @param {(item: object) => boolean|Promise<boolean>} [opts.allowEdit] - The organization-shelf guard
 * @returns {Promise<{ok: true, tags: Array<{id: string, name: string}>}|{ok: false, reason: 'not_found'|'forbidden'|'invalid'}>}
 */
export async function setTagsForSlideLibraryItem(
  storageScope,
  target,
  tagNames,
  { actorEmail, allowEdit } = {},
) {
  const ctx = toStorageContext(storageScope, 'setTagsForSlideLibraryItem', {
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
  return replaceTagLinks({
    linkTable: 'slide_library_tags',
    rowId: existing.id,
    orgId: getOrgId(ctx),
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
    (rows || [])
      .filter(Boolean)
      .flatMap((row) => [
        { id: row.updated_by_user_id, email: row.updated_by },
        { id: row.created_by_user_id, email: row.created_by },
        { email: row.trashed_by },
      ]),
  );
}
