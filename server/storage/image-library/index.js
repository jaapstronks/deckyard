/**
 * Image library storage facade.
 *
 * Every function takes a **storage scope** rather than a bare `repoRoot`, so the
 * organization comes from the caller instead of a hardcoded default (see
 * server/storage/scope.js). The image library is per-organization: two
 * organizations on one instance do not share each other's uploads, and neither do
 * their per-user favorites.
 *
 * Queries run directly through Kysely (B79/D34 removed the adapter
 * indirection); getDb() throws on an uninitialized database.
 */

import { getDb, sql } from '../../db/client.js';
import { getOrgId } from '../../utils/context.js';
import { resolveScope, toStorageContext } from '../scope.js';

/** @returns {string} current ISO timestamp */
function now() {
  return new Date().toISOString();
}

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
 * Map an image_library row to the facade's API object.
 * @param {object} row - Database row
 * @returns {object}
 */
function mapImageRow(row) {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description,
    photographer: row.photographer,
    tags: row.tags || [],
    alts: row.alts || {},
    sources: row.sources || [],
    uploadedBy: row.uploaded_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// Image queries (organization-scoped)
// ============================================================

async function listImages(ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  const rows = await db
    .selectFrom('image_library')
    .selectAll()
    .where('organization_id', '=', orgId)
    .orderBy('created_at', 'desc')
    // Full organization-scoped set. B79 inherited applyPagination()'s default
    // 100-row cap as a literal .limit(100), silently dropping the tail for orgs
    // with >100 images; B85 removed it. The public-api resources route paginates
    // over it in-memory and bulk-export backs it up, so a hard cap corrupted
    // totals and dropped data. DB-level pagination is a future deliberate
    // feature. See docs/reference/storage-layer.md § List reads.
    .execute();

  return rows.map(mapImageRow);
}

async function getImage(id, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  const row = await db
    .selectFrom('image_library')
    .selectAll()
    .where('id', '=', id)
    .where('organization_id', '=', orgId)
    .executeTakeFirst();

  if (!row) return null;
  return mapImageRow(row);
}

async function createImage(data, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  const row = await db
    .insertInto('image_library')
    .values({
      organization_id: orgId,
      url: data.url,
      title: data.title || '',
      description: data.description || '',
      photographer: data.photographer || '',
      tags: sql`${data.tags || []}::text[]`,
      alts: jsonb(data.alts || { nl: '', 'en-GB': '' }),
      sources: sql`${data.sources || []}::text[]`,
      uploaded_by: data.uploadedBy || null,
    })
    .returningAll()
    .executeTakeFirst();

  return mapImageRow(row);
}

async function updateImage(id, data, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  const row = await db
    .updateTable('image_library')
    .set({
      url: data.url,
      title: data.title,
      description: data.description,
      photographer: data.photographer,
      tags: data.tags ? sql`${data.tags}::text[]` : undefined,
      alts: data.alts ? jsonb(data.alts) : undefined,
      sources: data.sources ? sql`${data.sources}::text[]` : undefined,
      updated_at: now(),
    })
    .where('id', '=', id)
    .where('organization_id', '=', orgId)
    .returningAll()
    .executeTakeFirst();

  if (!row) return { ok: false, reason: 'not_found' };
  return { ok: true, image: mapImageRow(row) };
}

async function deleteImage(id, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  const result = await db
    .deleteFrom('image_library')
    .where('id', '=', id)
    .where('organization_id', '=', orgId)
    .executeTakeFirst();

  return result.numDeletedRows > 0
    ? { ok: true }
    : { ok: false, reason: 'not_found' };
}

// ============================================================
// Per-user favorites (organization-scoped)
// ============================================================

async function favoritesOf(userEmail, ctx) {
  if (!userEmail) return [];

  const db = getDb();
  const orgId = getOrgId(ctx);

  const rows = await db
    .selectFrom('image_library_favorites')
    .select('image_id')
    .where('organization_id', '=', orgId)
    .where('user_email', '=', userEmail)
    .execute();

  return rows.map((r) => r.image_id);
}

async function isFavorite(imageId, userEmail, ctx) {
  if (!userEmail || !imageId) return false;

  const db = getDb();
  const orgId = getOrgId(ctx);

  const row = await db
    .selectFrom('image_library_favorites')
    .select('image_id')
    .where('organization_id', '=', orgId)
    .where('image_id', '=', imageId)
    .where('user_email', '=', userEmail)
    .executeTakeFirst();

  return !!row;
}

async function addFavorite(imageId, userEmail, ctx) {
  if (!userEmail || !imageId) return false;

  const db = getDb();
  const orgId = getOrgId(ctx);

  try {
    await db
      .insertInto('image_library_favorites')
      .values({
        image_id: imageId,
        user_email: userEmail,
        organization_id: orgId,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
    return true;
  } catch {
    return false;
  }
}

async function removeFavorite(imageId, userEmail, ctx) {
  if (!userEmail || !imageId) return false;

  const db = getDb();
  const orgId = getOrgId(ctx);

  const result = await db
    .deleteFrom('image_library_favorites')
    .where('organization_id', '=', orgId)
    .where('image_id', '=', imageId)
    .where('user_email', '=', userEmail)
    .executeTakeFirst();

  return result.numDeletedRows > 0;
}

// ============================================================
// Facade
// ============================================================

/**
 * List the image library of the storageScope's organization.
 * @param {import('../scope.js').StorageScope} storageScope
 * @returns {Promise<Array<Object>>}
 */
export async function listImageLibrary(storageScope) {
  const ctx = toStorageContext(storageScope, 'listImageLibrary');
  return listImages(ctx);
}

/**
 * Fetch one image library item within the storageScope's organization.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getImageLibraryItem(storageScope, id) {
  const ctx = toStorageContext(storageScope, 'getImageLibraryItem');
  return getImage(id, ctx);
}

/**
 * Add an image to the storageScope's organization library.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {Object} input
 * @returns {Promise<Object>}
 */
export async function createImageLibraryItem(storageScope, input) {
  const ctx = toStorageContext(storageScope, 'createImageLibraryItem');
  return createImage(input, ctx);
}

/**
 * Patch an image library item within the storageScope's organization.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} id
 * @param {Object} patch
 * @returns {Promise<{ok: true, image: Object}|{ok: false, reason: string}>}
 *   `not_found` when no such image lives in this organization.
 */
export async function updateImageLibraryItem(storageScope, id, patch) {
  const ctx = toStorageContext(storageScope, 'updateImageLibraryItem');
  return updateImage(id, patch, ctx);
}

/**
 * Delete an image library item within the storageScope's organization.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} id
 * @returns {Promise<{ok: true}|{ok: false, reason: string}>}
 *   `not_found` when no such image lives in this organization.
 */
export async function deleteImageLibraryItem(storageScope, id) {
  const ctx = toStorageContext(storageScope, 'deleteImageLibraryItem');
  return deleteImage(id, ctx);
}

/**
 * Get all favorite image IDs for a user.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} userEmail - User's email
 * @returns {Promise<string[]>} Array of image IDs
 */
export async function getImageFavorites(storageScope, userEmail) {
  const ctx = resolveScope(storageScope, 'getImageFavorites');
  return favoritesOf(userEmail, ctx);
}

/**
 * Toggle favorite status for an image.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} imageId - Image ID
 * @param {string} userEmail - User's email
 * @returns {Promise<boolean>} New favorite status (true if now favorited)
 */
export async function toggleImageFavorite(storageScope, imageId, userEmail) {
  const ctx = resolveScope(storageScope, 'toggleImageFavorite');
  if (await isFavorite(imageId, userEmail, ctx)) {
    await removeFavorite(imageId, userEmail, ctx);
    return false;
  }
  await addFavorite(imageId, userEmail, ctx);
  return true;
}
