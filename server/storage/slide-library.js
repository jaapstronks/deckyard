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
import { ConflictError } from '../utils/errors.js';

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
 * @returns {object}
 */
export function mapSlideLibraryRow(row, lookup = NO_DISPLAY_NAMES) {
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
    favorites: row.favorites || [],
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

  const lookup = await libraryDisplayNames(rows);
  return rows.map((row) => mapSlideLibraryRow(row, lookup));
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
  return mapSlideLibraryRow(row, await libraryDisplayNames([row]));
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
      favorites: sql`${data.favorites || []}::text[]`,
      created_by: actorEmail,
      created_by_user_id: actorUserId,
      updated_by: actorEmail,
      updated_by_user_id: actorUserId,
    })
    .returningAll()
    .executeTakeFirst();

  return mapSlideLibraryRow(row, await libraryDisplayNames([row]));
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
  return new ConflictError(
    'Conflict: this library slide was changed by someone else. Reload and try again.',
    {
      id: item.id,
      revision: item.revision,
      modified: item.updatedAt,
      updatedBy: item.updatedBy || null,
    },
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
  return mapSlideLibraryRow(row, await libraryDisplayNames([row]));
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
 *   Returns a refusal message for content the actor may not write
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
    if (!allowed) return { ok: false, reason: 'forbidden' };
  }
  if (edits && existing.revision !== expectedRevision) {
    throw conflictError(existing);
  }
  if ('content' in patch && typeof opts.contentGuard === 'function') {
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
  // `favorite` is in the key set, but storing it is B334; until then a
  // favorite-only patch writes nothing and answers with the item as it is.
  if (Object.keys(updateData).length === 0) return { ok: true, item: existing };

  updateData.updated_at = nowIso();
  // Dual-key (T10 PR F2): stamp updated_by_user_id from the same resolution
  // only when there is an actor to stamp, so an actor-less write never nulls
  // the id half while the e-mail half keeps the previous writer.
  if (ctx?.actorEmail) {
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
  if (row) {
    return {
      ok: true,
      item: mapSlideLibraryRow(row, await libraryDisplayNames([row])),
    };
  }
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
  if (!ok) return { ok: false, reason: 'forbidden' };
  const deleted = await deleteLibraryItem(ctx, target);
  if (!deleted) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

// Slide library tag functions
// These reuse the organization's existing tags (server/storage/tags), joined
// through slide_library_tags. Thin queries, inlined here 1:1.

export async function getTagsForSlideLibraryItem(
  storageScope,
  id,
  { userEmail } = {},
) {
  const ctx = toStorageContext(storageScope, 'getTagsForSlideLibraryItem', {
    userEmail,
  });
  const db = getDb();
  const orgId = getOrgId(ctx);

  const rows = await db
    .selectFrom('tags')
    .innerJoin('slide_library_tags', 'tags.id', 'slide_library_tags.tag_id')
    .select(['tags.id', 'tags.name'])
    .where('slide_library_tags.slide_library_id', '=', id)
    .where('tags.organization_id', '=', orgId)
    .orderBy('tags.name', 'asc')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
  }));
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

export async function setTagsForSlideLibraryItem(
  storageScope,
  id,
  tagNames,
  { userEmail } = {},
) {
  const ctx = toStorageContext(storageScope, 'setTagsForSlideLibraryItem', {
    userEmail,
  });
  const db = getDb();
  const orgId = getOrgId(ctx);

  // Normalize tag names (trim, drop empties and over-long).
  const normalizedNames = (tagNames || [])
    .map((name) => String(name || '').trim())
    .filter((name) => name.length > 0 && name.length <= 100);

  // Remove duplicates (case-insensitive).
  const uniqueNames = [];
  const seenLower = new Set();
  for (const name of normalizedNames) {
    const lower = name.toLowerCase();
    if (!seenLower.has(lower)) {
      seenLower.add(lower);
      uniqueNames.push(name);
    }
  }

  // Remove all existing tags for this slide library item.
  await db
    .deleteFrom('slide_library_tags')
    .where('slide_library_id', '=', id)
    .execute();

  if (uniqueNames.length === 0) {
    return [];
  }

  // Get or create tags (reuses existing org tags).
  const tagIds = [];
  for (const name of uniqueNames) {
    // Try to find existing tag (case-insensitive).
    let tag = await db
      .selectFrom('tags')
      .select(['id', 'name'])
      .where('organization_id', '=', orgId)
      .where(db.fn('lower', ['name']), '=', name.toLowerCase())
      .executeTakeFirst();

    if (!tag) {
      // Create new tag.
      tag = await db
        .insertInto('tags')
        .values({
          organization_id: orgId,
          name,
          created_at: nowIso(),
        })
        .returning(['id', 'name'])
        .executeTakeFirst();
    }

    tagIds.push({ id: tag.id, name: tag.name });
  }

  // Insert slide_library_tags relationships.
  if (tagIds.length > 0) {
    await db
      .insertInto('slide_library_tags')
      .values(
        tagIds.map((tag) => ({
          slide_library_id: id,
          tag_id: tag.id,
          created_at: nowIso(),
        })),
      )
      .execute();
  }

  return tagIds;
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
