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

import { getDb, sql } from '../db/client.js';
import { getOrgId } from '../utils/context.js';
import { resolveScope, toStorageContext } from './scope.js';
import { keysetPage, keysetRows } from './keyset.js';
import { escapeLikePattern } from './utils/index.js';
import { normalizeEmail } from '../../shared/email.js';

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

/**
 * The sections an image list narrows to (the picker's sidebar): every image,
 * the reader's uploads, the reader's stars, and the images tagged as logo or
 * icon (a tag containing the word, as the picker always matched them).
 */
export const IMAGE_LIST_SECTIONS = Object.freeze([
  'all',
  'mine',
  'favorites',
  'logos',
  'icons',
]);

/** The tag substring of a tag-word section. */
const SECTION_TAG_WORD = Object.freeze({ logos: 'logo', icons: 'icon' });

/**
 * @typedef {Object} ImageListFilter
 * @property {string} [section='all'] - One of {@link IMAGE_LIST_SECTIONS}.
 * @property {string|null} [viewerEmail] - The reader; `mine` and `favorites`
 *   are empty without one.
 * @property {string} [tag] - Only images carrying this tag (case-insensitive).
 * @property {string} [q] - A case-insensitive substring of the title,
 *   description, photographer, URL, a tag or an alt text.
 */

/**
 * The image list query before its order and page: the organization and every
 * filter, in SQL (B822, D358). `null` when the filter can match nothing.
 *
 * @param {Object} db
 * @param {string} orgId
 * @param {ImageListFilter} [filter]
 */
function imageListQuery(db, orgId, filter = {}) {
  const { section = 'all', viewerEmail = null, tag, q } = filter;
  if ((section === 'mine' || section === 'favorites') && !viewerEmail) {
    return null;
  }
  let qb = db
    .selectFrom('image_library')
    .selectAll()
    .where('image_library.organization_id', '=', orgId);
  if (section === 'mine') {
    qb = qb.where(
      'image_library.uploaded_by',
      '=',
      normalizeEmail(viewerEmail),
    );
  }
  if (section === 'favorites') {
    qb = qb.where((eb) =>
      eb.exists(
        eb
          .selectFrom('image_library_favorites as f')
          .select(eb.lit(1).as('one'))
          .whereRef('f.image_id', '=', 'image_library.id')
          .where('f.organization_id', '=', orgId)
          .where('f.user_email', '=', viewerEmail),
      ),
    );
  }
  const word = SECTION_TAG_WORD[section];
  if (word) {
    qb = qb.where(
      sql`EXISTS (SELECT 1 FROM unnest(image_library.tags) AS t(name) WHERE t.name ILIKE ${`%${word}%`})`,
    );
  }
  if (tag) {
    qb = qb.where(
      sql`EXISTS (SELECT 1 FROM unnest(image_library.tags) AS t(name) WHERE lower(t.name) = lower(${tag}))`,
    );
  }
  const text = typeof q === 'string' ? q.trim() : '';
  if (text) {
    const pattern = `%${escapeLikePattern(text)}%`;
    qb = qb.where((eb) =>
      eb.or([
        eb('image_library.title', 'ilike', pattern),
        eb('image_library.description', 'ilike', pattern),
        eb('image_library.photographer', 'ilike', pattern),
        eb('image_library.url', 'ilike', pattern),
        sql`EXISTS (SELECT 1 FROM unnest(image_library.tags) AS t(name) WHERE t.name ILIKE ${pattern})`,
        sql`EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(image_library.alts, '{}'::jsonb)) AS a WHERE a.value ILIKE ${pattern})`,
      ]),
    );
  }
  return qb;
}

/**
 * The images of the organization under a filter, as one keyset page
 * `(created_at desc, id desc)` or (without `limit`) the whole list.
 *
 * @param {Object} ctx - Storage context
 * @param {ImageListFilter} [filter]
 * @param {{limit?: number, after?: {value: string, id: string}|null}} [page]
 * @returns {Promise<{items: Object[], next: {value: string, id: string}|null}>}
 */
async function listImages(ctx, filter = {}, { limit, after = null } = {}) {
  const qb = imageListQuery(getDb(), getOrgId(ctx), filter);
  if (!qb) return { items: [], next: null };
  if (limit === undefined) {
    const rows = await qb
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return { items: rows.map(mapImageRow), next: null };
  }
  const { rows, next } = keysetRows(
    await keysetPage(qb, { column: 'created_at', after, limit }).execute(),
    limit,
  );
  return { items: rows.map(mapImageRow), next };
}

/**
 * Every tag in the organization's image library, with how many images carry
 * it, most used first and then by name ignoring case (whatever the database
 * collation), the categories facet as its own query (B822).
 *
 * @param {Object} ctx - Storage context
 * @returns {Promise<Array<{name: string, count: number}>>}
 */
async function imageTagCounts(ctx) {
  const rows = await sql`
    SELECT t.name AS name, count(*)::int AS count
    FROM image_library, unnest(image_library.tags) AS t(name)
    WHERE image_library.organization_id = ${getOrgId(ctx)}
      AND btrim(t.name) <> ''
    GROUP BY t.name
    ORDER BY count(*) DESC, lower(t.name) ASC, t.name ASC
  `.execute(getDb());
  return rows.rows.map((row) => ({ name: row.name, count: Number(row.count) }));
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
      // An open map keyed by deck language, empty when the caller supplied
      // none — seeding a Dutch and an English key here made the pair look like
      // the shape of the field, which it never was (B182 fase 5).
      alts: jsonb(data.alts || {}),
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
 * The image library of the scope's organization under a filter, as one keyset
 * page or (without `limit`) the whole list, newest first (B822, D358). The
 * bulk export reads the whole unfiltered list.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {ImageListFilter} [filter]
 * @param {{limit?: number, after?: {value: string, id: string}|null}} [page]
 * @returns {Promise<{items: Object[], next: {value: string, id: string}|null}>}
 */
export async function listImageLibrary(scope, filter = {}, page = {}) {
  const ctx = toStorageContext(scope, 'listImageLibrary');
  return listImages(ctx, filter, page);
}

/**
 * Every tag of the organization's image library with its image count, most
 * used first (the categories facet).
 * @param {import('./scope.js').StorageScope} scope
 * @returns {Promise<Array<{name: string, count: number}>>}
 */
export async function listImageLibraryTags(scope) {
  const ctx = toStorageContext(scope, 'listImageLibraryTags');
  return imageTagCounts(ctx);
}

/**
 * Fetch one image library item within the scope's organization.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getImageLibraryItem(scope, id) {
  const ctx = toStorageContext(scope, 'getImageLibraryItem');
  return getImage(id, ctx);
}

/**
 * Add an image to the scope's organization library.
 * @param {import('./scope.js').StorageScope} scope
 * @param {Object} input
 * @returns {Promise<Object>}
 */
export async function createImageLibraryItem(scope, input) {
  const ctx = toStorageContext(scope, 'createImageLibraryItem');
  return createImage(input, ctx);
}

/**
 * Patch an image library item within the scope's organization.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} id
 * @param {Object} patch
 * @returns {Promise<{ok: true, image: Object}|{ok: false, reason: string}>}
 *   `not_found` when no such image lives in this organization.
 */
export async function updateImageLibraryItem(scope, id, patch) {
  const ctx = toStorageContext(scope, 'updateImageLibraryItem');
  return updateImage(id, patch, ctx);
}

/**
 * Delete an image library item within the scope's organization.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} id
 * @returns {Promise<{ok: true}|{ok: false, reason: string}>}
 *   `not_found` when no such image lives in this organization.
 */
export async function deleteImageLibraryItem(scope, id) {
  const ctx = toStorageContext(scope, 'deleteImageLibraryItem');
  return deleteImage(id, ctx);
}

/**
 * Get all favorite image IDs for a user.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} userEmail - User's email
 * @returns {Promise<string[]>} Array of image IDs
 */
export async function getImageFavorites(scope, userEmail) {
  const ctx = resolveScope(scope, 'getImageFavorites');
  return favoritesOf(userEmail, ctx);
}

/**
 * Stamp a list of image-library items with the reader's own star (D176).
 *
 * The one place a *list* of items gets `favorite`, so the surfaces that hand
 * one out — the collection route and the bulk export — cannot answer "has this
 * person starred this image" differently. One query for the reader's rows, one
 * lookup per item; the stored addresses never leave this layer (D22).
 *
 * A reader without an address has no stars, so every item comes back
 * `favorite: false` — still the field, the same answer the route already gives
 * an anonymous caller.
 * @param {import('./scope.js').StorageScope} scope
 * @param {Array<Object>} items - Mapped image-library items
 * @param {string|null} [viewerEmail] - Who is reading
 * @returns {Promise<Array<Object>>} The items, each carrying `favorite`
 */
export async function stampFavorites(scope, items, viewerEmail = null) {
  const ctx = resolveScope(scope, 'stampFavorites');
  const starred = new Set(await favoritesOf(viewerEmail, ctx));
  return items.map((item) => ({ ...item, favorite: starred.has(item.id) }));
}

/**
 * Whether `userEmail` starred this image. The caller's own flag, so that every
 * route can stamp `favorite` on the item it hands back (D176) without reading
 * the stored addresses — those never leave this layer (D22).
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} imageId - Image ID
 * @param {string} userEmail - User's email
 * @returns {Promise<boolean>} True when this user starred the image
 */
export async function isImageFavorite(scope, imageId, userEmail) {
  const ctx = resolveScope(scope, 'isImageFavorite');
  return isFavorite(imageId, userEmail, ctx);
}

/**
 * Toggle favorite status for an image.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} imageId - Image ID
 * @param {string} userEmail - User's email
 * @returns {Promise<boolean>} New favorite status (true if now favorited)
 */
export async function toggleImageFavorite(scope, imageId, userEmail) {
  const ctx = resolveScope(scope, 'toggleImageFavorite');
  if (await isFavorite(imageId, userEmail, ctx)) {
    await removeFavorite(imageId, userEmail, ctx);
    return false;
  }
  await addFavorite(imageId, userEmail, ctx);
  return true;
}

// White-box seam: tests/pg/library-list-page.pgtest.js EXPLAINs the exact
// query a page runs. The `__` prefix marks it internal.
export const __imageList = { imageListQuery };
