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

import { getDb, sql } from '../../db/client.js';
import { getOrgId } from '../../utils/context.js';
import { resolveIdentityByEmail } from '../identity-resolver.js';
import { toStorageContext } from '../scope.js';
import { nowIso } from '../../utils/normalize.js';

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
 * @returns {object}
 */
function mapSlideLibraryRow(row) {
  return {
    id: row.id,
    shelf: row.shelf,
    ownerEmail: row.owner_email,
    name: row.name,
    description: row.description || '',
    slideType: row.slide_type,
    themeId: row.theme_id,
    content: row.content || {},
    i18n: row.i18n || {},
    favorites: row.favorites || [],
    trashedAt: row.trashed_at,
    // Identity travels as a pair (T10 PR F2): the stable `users.id`
    // (migration 070) beside the display/fallback e-mail. The organization-library
    // trash/delete guard matches on `createdById`; see shared/identity-match.js.
    trashedBy: row.trashed_by,
    createdById: row.created_by_user_id || null,
    createdBy: row.created_by,
    updatedById: row.updated_by_user_id || null,
    updatedBy: row.updated_by,
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

  return rows.map(mapSlideLibraryRow);
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
  return mapSlideLibraryRow(row);
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

  return mapSlideLibraryRow(row);
}

async function updateSlideLibraryRow(id, data, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  // Build update object, only including fields that are defined.
  // Dual-key (T10 PR F2): stamp updated_by_user_id from the same resolution
  // only when there is an actor to stamp, so an actor-less write (Kysely drops
  // the undefined updated_by) never nulls the id half while the e-mail half
  // keeps the previous writer.
  const updateData = {
    updated_at: nowIso(),
  };
  if (ctx?.actorEmail) {
    const actorResolution = await resolveIdentityByEmail(ctx.actorEmail);
    updateData.updated_by = ctx.actorEmail;
    updateData.updated_by_user_id = actorResolution?.userId ?? null;
  }
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.content !== undefined) updateData.content = jsonb(data.content);
  if (data.i18n !== undefined) updateData.i18n = jsonb(data.i18n);
  if (data.favorites !== undefined)
    updateData.favorites = sql`${data.favorites}::text[]`;
  if (data.trashedAt !== undefined) updateData.trashed_at = data.trashedAt;
  if (data.trashedBy !== undefined) updateData.trashed_by = data.trashedBy;

  const row = await db
    .updateTable('slide_library')
    .set(updateData)
    .where('id', '=', id)
    .where('organization_id', '=', orgId)
    .returningAll()
    .executeTakeFirst();

  if (!row) return null;
  return mapSlideLibraryRow(row);
}

async function deleteSlideLibraryRow(id, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  const result = await db
    .deleteFrom('slide_library')
    .where('id', '=', id)
    .where('organization_id', '=', orgId)
    .executeTakeFirst();

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
  if (!slideType) return { ok: false, reason: 'slideType_required' };
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

export async function updatePersonalLibraryItem(
  storageScope,
  userEmail,
  id,
  patch,
  { actorEmail } = {},
) {
  const ctx = toStorageContext(storageScope, 'updatePersonalLibraryItem', {
    userEmail,
    actorEmail,
  });
  const normalizedPatch = { ...patch };
  if ('trashed' in patch) {
    normalizedPatch.trashedAt = patch.trashed ? nowIso() : null;
    normalizedPatch.trashedBy = patch.trashed ? actorEmail || userEmail : null;
    delete normalizedPatch.trashed;
  }
  const result = await updateSlideLibraryRow(id, normalizedPatch, ctx);
  if (!result) return { ok: false, reason: 'not_found' };
  return { ok: true, item: result };
}

export async function deletePersonalLibraryItem(storageScope, userEmail, id) {
  const ctx = toStorageContext(storageScope, 'deletePersonalLibraryItem', {
    userEmail,
  });
  const deleted = await deleteSlideLibraryRow(id, ctx);
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
  if (!slideType) return { ok: false, reason: 'slideType_required' };
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

export async function updateOrganizationLibraryItem(
  storageScope,
  id,
  patch,
  { actorEmail } = {},
) {
  const ctx = toStorageContext(storageScope, 'updateOrganizationLibraryItem', {
    actorEmail,
  });
  const result = await updateSlideLibraryRow(id, patch, ctx);
  if (!result) return { ok: false, reason: 'not_found' };
  return { ok: true, item: result };
}

export async function setOrganizationLibraryItemTrashed(
  storageScope,
  id,
  { trashed, actorEmail, allowTrash } = {},
) {
  const ctx = toStorageContext(
    storageScope,
    'setOrganizationLibraryItemTrashed',
    { actorEmail },
  );
  if (typeof allowTrash === 'function') {
    // Resolve the guard's target directly by id, never through the org list:
    // that list was capped at 100 rows (B85), so an item past the newest page
    // would have failed the authz guard with a false not_found. A non-org-shelf
    // id is not an organization-shelf item, so it stays not_found here.
    const item = await getSlideLibraryRow(id, ctx);
    if (!item || item.shelf !== 'organization')
      return { ok: false, reason: 'not_found' };
    const ok = await allowTrash(item, { actorEmail });
    if (!ok) return { ok: false, reason: 'forbidden' };
  }
  const result = await updateSlideLibraryRow(
    id,
    {
      trashedAt: trashed ? nowIso() : null,
      trashedBy: trashed ? actorEmail : null,
    },
    ctx,
  );
  if (!result) return { ok: false, reason: 'not_found' };
  return { ok: true, item: result };
}

export async function deleteOrganizationLibraryItem(
  storageScope,
  id,
  { actorEmail, allowDelete } = {},
) {
  const ctx = toStorageContext(storageScope, 'deleteOrganizationLibraryItem', {
    actorEmail,
  });
  if (typeof allowDelete === 'function') {
    // Resolve the guard's target directly by id, never through the org list:
    // that list was capped at 100 rows (B85), so an item past the newest page
    // would have failed the authz guard with a false not_found. A non-org-shelf
    // id is not an organization-shelf item, so it stays not_found here.
    const item = await getSlideLibraryRow(id, ctx);
    if (!item || item.shelf !== 'organization')
      return { ok: false, reason: 'not_found' };
    const ok = await allowDelete(item, { actorEmail });
    if (!ok) return { ok: false, reason: 'forbidden' };
  }
  const deleted = await deleteSlideLibraryRow(id, ctx);
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
