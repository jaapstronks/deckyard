/**
 * Tags storage facade.
 *
 * Tags are per-organization, and these functions used to have no way of hearing
 * which one: they built their own context from a hardcoded default. Every
 * function now takes a **storage scope** as its first argument, so the
 * organization is the caller's answer, not storage's guess — see
 * server/storage/scope.js.
 *
 * These used to degrade to empty results when storage was uninitialized. That
 * case no longer exists: PostgreSQL is the only backend, so an uninitialized
 * database is a boot bug and `getDb()` throws instead of quietly returning
 * nothing. Queries run directly through Kysely (B79/D34 removed the adapter
 * indirection); the shapes below are the storage contract for tags.
 */

import { getDb } from '../../db/client.js';
import { getOrgId } from '../../utils/context.js';
import { ValidationError } from '../../utils/errors.js';
import { resolveScope } from '../scope.js';

/** @returns {string} current ISO timestamp */
function now() {
  return new Date().toISOString();
}

/**
 * List all tags of the storageScope's organization.
 * @param {import('../scope.js').StorageScope} storageScope
 * @returns {Promise<Array<{id: string, name: string, count: number}>>}
 */
export async function listTags(storageScope) {
  const ctx = resolveScope(storageScope, 'listTags');
  const db = getDb();
  const orgId = getOrgId(ctx);

  const rows = await db
    .selectFrom('tags')
    .leftJoin('presentation_tags', 'tags.id', 'presentation_tags.tag_id')
    .select([
      'tags.id',
      'tags.name',
      db.fn.count('presentation_tags.presentation_id').as('count'),
    ])
    .where('tags.organization_id', '=', orgId)
    .groupBy(['tags.id', 'tags.name'])
    .orderBy('tags.name', 'asc')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    count: Number(row.count) || 0,
  }));
}

/**
 * Get tags for a specific presentation.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} presentationId - Presentation ID
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function getTagsForPresentation(storageScope, presentationId) {
  const ctx = resolveScope(storageScope, 'getTagsForPresentation');
  const db = getDb();
  const orgId = getOrgId(ctx);

  const rows = await db
    .selectFrom('tags')
    .innerJoin('presentation_tags', 'tags.id', 'presentation_tags.tag_id')
    .select(['tags.id', 'tags.name'])
    .where('presentation_tags.presentation_id', '=', presentationId)
    .where('tags.organization_id', '=', orgId)
    .orderBy('tags.name', 'asc')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
  }));
}

/**
 * Get tags for multiple presentations at once (for list views).
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string[]} presentationIds - Array of presentation IDs
 * @returns {Promise<Map<string, Array<{id: string, name: string}>>>}
 */
export async function getTagsForPresentations(storageScope, presentationIds) {
  const ctx = resolveScope(storageScope, 'getTagsForPresentations');
  if (!presentationIds || presentationIds.length === 0) {
    return new Map();
  }

  const db = getDb();
  const orgId = getOrgId(ctx);

  const rows = await db
    .selectFrom('tags')
    .innerJoin('presentation_tags', 'tags.id', 'presentation_tags.tag_id')
    .select([
      'presentation_tags.presentation_id as presentationId',
      'tags.id',
      'tags.name',
    ])
    .where('presentation_tags.presentation_id', 'in', presentationIds)
    .where('tags.organization_id', '=', orgId)
    .orderBy('tags.name', 'asc')
    .execute();

  const result = new Map();
  for (const row of rows) {
    if (!result.has(row.presentationId)) {
      result.set(row.presentationId, []);
    }
    result.get(row.presentationId).push({
      id: row.id,
      name: row.name,
    });
  }

  return result;
}

/**
 * Set tags for a presentation (replaces existing tags).
 * Creates new tags if they don't exist.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} presentationId - Presentation ID
 * @param {string[]} tagNames - Array of tag names
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function setTagsForPresentation(storageScope, presentationId, tagNames) {
  const ctx = resolveScope(storageScope, 'setTagsForPresentation');
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

  // Remove all existing tags for this presentation.
  await db
    .deleteFrom('presentation_tags')
    .where('presentation_id', '=', presentationId)
    .execute();

  if (uniqueNames.length === 0) {
    return [];
  }

  // Get or create tags.
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
          created_at: now(),
        })
        .returning(['id', 'name'])
        .executeTakeFirst();
    }

    tagIds.push({ id: tag.id, name: tag.name });
  }

  // Insert presentation_tags relationships.
  if (tagIds.length > 0) {
    await db
      .insertInto('presentation_tags')
      .values(
        tagIds.map((tag) => ({
          presentation_id: presentationId,
          tag_id: tag.id,
          created_at: now(),
        }))
      )
      .execute();
  }

  return tagIds;
}

/**
 * Create a new tag in the storageScope's organization (if it doesn't exist).
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} name - Tag name
 * @returns {Promise<{id: string, name: string}>}
 */
export async function createTag(storageScope, name) {
  const ctx = resolveScope(storageScope, 'createTag');
  const db = getDb();
  const orgId = getOrgId(ctx);

  const trimmedName = String(name || '').trim();
  if (!trimmedName || trimmedName.length > 100) {
    throw new ValidationError('Invalid tag name');
  }

  // Check if tag already exists.
  const existing = await db
    .selectFrom('tags')
    .select(['id', 'name'])
    .where('organization_id', '=', orgId)
    .where(db.fn('lower', ['name']), '=', trimmedName.toLowerCase())
    .executeTakeFirst();

  if (existing) {
    return { id: existing.id, name: existing.name };
  }

  // Create new tag.
  const row = await db
    .insertInto('tags')
    .values({
      organization_id: orgId,
      name: trimmedName,
      created_at: now(),
    })
    .returning(['id', 'name'])
    .executeTakeFirst();

  return { id: row.id, name: row.name };
}

/**
 * Delete a tag from the storageScope's organization (and all its associations).
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} tagId - Tag ID
 * @returns {Promise<boolean>}
 */
export async function deleteTag(storageScope, tagId) {
  const ctx = resolveScope(storageScope, 'deleteTag');
  const db = getDb();
  const orgId = getOrgId(ctx);

  const result = await db
    .deleteFrom('tags')
    .where('id', '=', tagId)
    .where('organization_id', '=', orgId)
    .executeTakeFirst();

  return result.numDeletedRows > 0;
}

/**
 * Search tags by prefix (for autocomplete).
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} prefix - Search prefix
 * @param {number} [limit=10] - Max results
 * @returns {Promise<Array<{id: string, name: string, count: number}>>}
 */
export async function searchTags(storageScope, prefix, limit = 10) {
  const ctx = resolveScope(storageScope, 'searchTags');
  const db = getDb();
  const orgId = getOrgId(ctx);

  const searchTerm = String(prefix || '').trim().toLowerCase();
  if (!searchTerm) {
    return listTags(storageScope);
  }

  const rows = await db
    .selectFrom('tags')
    .leftJoin('presentation_tags', 'tags.id', 'presentation_tags.tag_id')
    .select([
      'tags.id',
      'tags.name',
      db.fn.count('presentation_tags.presentation_id').as('count'),
    ])
    .where('tags.organization_id', '=', orgId)
    .where(db.fn('lower', ['tags.name']), 'like', `${searchTerm}%`)
    .groupBy(['tags.id', 'tags.name'])
    .orderBy('tags.name', 'asc')
    .limit(limit)
    .execute();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    count: Number(row.count) || 0,
  }));
}
