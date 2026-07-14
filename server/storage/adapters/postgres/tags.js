/**
 * PostgreSQL tags storage module.
 */

import { getDb, getOrgId, now } from './helpers.js';

/**
 * Tags mixin - adds tag methods to adapter.
 * @param {typeof import('../interface.js').StorageAdapter} Base
 */
export function withTags(Base) {
  return class extends Base {
    /**
     * List all tags for the organization.
     * @param {object} ctx - Storage context
     * @returns {Promise<Array<{id: string, name: string, count: number}>>}
     */
    async listTags(ctx) {
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
     * @param {string} presentationId - Presentation ID
     * @param {object} ctx - Storage context
     * @returns {Promise<Array<{id: string, name: string}>>}
     */
    async getTagsForPresentation(presentationId, ctx) {
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
     * @param {string[]} presentationIds - Array of presentation IDs
     * @param {object} ctx - Storage context
     * @returns {Promise<Map<string, Array<{id: string, name: string}>>>}
     */
    async getTagsForPresentations(presentationIds, ctx) {
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
     * @param {string} presentationId - Presentation ID
     * @param {string[]} tagNames - Array of tag names
     * @param {object} ctx - Storage context
     * @returns {Promise<Array<{id: string, name: string}>>}
     */
    async setTagsForPresentation(presentationId, tagNames, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      // Normalize tag names (trim, lowercase for comparison)
      const normalizedNames = (tagNames || [])
        .map((name) => String(name || '').trim())
        .filter((name) => name.length > 0 && name.length <= 100);

      // Remove duplicates (case-insensitive)
      const uniqueNames = [];
      const seenLower = new Set();
      for (const name of normalizedNames) {
        const lower = name.toLowerCase();
        if (!seenLower.has(lower)) {
          seenLower.add(lower);
          uniqueNames.push(name);
        }
      }

      // Remove all existing tags for this presentation
      await db
        .deleteFrom('presentation_tags')
        .where('presentation_id', '=', presentationId)
        .execute();

      if (uniqueNames.length === 0) {
        return [];
      }

      // Get or create tags
      const tagIds = [];
      for (const name of uniqueNames) {
        // Try to find existing tag (case-insensitive)
        let tag = await db
          .selectFrom('tags')
          .select(['id', 'name'])
          .where('organization_id', '=', orgId)
          .where(db.fn('lower', ['name']), '=', name.toLowerCase())
          .executeTakeFirst();

        if (!tag) {
          // Create new tag
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

      // Insert presentation_tags relationships
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
     * Create a new tag (if it doesn't exist).
     * @param {string} name - Tag name
     * @param {object} ctx - Storage context
     * @returns {Promise<{id: string, name: string}>}
     */
    async createTag(name, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const trimmedName = String(name || '').trim();
      if (!trimmedName || trimmedName.length > 100) {
        const err = new Error('Invalid tag name');
        err.statusCode = 400;
        throw err;
      }

      // Check if tag already exists
      const existing = await db
        .selectFrom('tags')
        .select(['id', 'name'])
        .where('organization_id', '=', orgId)
        .where(db.fn('lower', ['name']), '=', trimmedName.toLowerCase())
        .executeTakeFirst();

      if (existing) {
        return { id: existing.id, name: existing.name };
      }

      // Create new tag
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
     * Delete a tag (and all its associations).
     * @param {string} tagId - Tag ID
     * @param {object} ctx - Storage context
     * @returns {Promise<boolean>}
     */
    async deleteTag(tagId, ctx) {
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
     * @param {string} prefix - Search prefix
     * @param {object} ctx - Storage context
     * @param {number} [limit=10] - Max results
     * @returns {Promise<Array<{id: string, name: string, count: number}>>}
     */
    async searchTags(prefix, ctx, limit = 10) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const searchTerm = String(prefix || '').trim().toLowerCase();
      if (!searchTerm) {
        return this.listTags(ctx);
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
  };
}