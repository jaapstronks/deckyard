/**
 * PostgreSQL slide library tags storage module.
 * Reuses existing org tags for slide library items.
 */

import { getDb, getOrgId, now } from './helpers.js';

/**
 * Slide Library Tags mixin - adds slide library tag methods to adapter.
 * @param {typeof import('../interface.js').StorageAdapter} Base
 */
export function withSlideLibraryTags(Base) {
  return class extends Base {
    /**
     * Get tags for a specific slide library item.
     * @param {string} slideLibraryId - Slide library item ID
     * @param {object} ctx - Storage context
     * @returns {Promise<Array<{id: string, name: string}>>}
     */
    async getTagsForSlideLibraryItem(slideLibraryId, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const rows = await db
        .selectFrom('tags')
        .innerJoin('slide_library_tags', 'tags.id', 'slide_library_tags.tag_id')
        .select(['tags.id', 'tags.name'])
        .where('slide_library_tags.slide_library_id', '=', slideLibraryId)
        .where('tags.organization_id', '=', orgId)
        .orderBy('tags.name', 'asc')
        .execute();

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
      }));
    }

    /**
     * Get tags for multiple slide library items at once (for list views).
     * @param {string[]} slideLibraryIds - Array of slide library item IDs
     * @param {object} ctx - Storage context
     * @returns {Promise<Map<string, Array<{id: string, name: string}>>>}
     */
    async getTagsForSlideLibraryItems(slideLibraryIds, ctx) {
      if (!slideLibraryIds || slideLibraryIds.length === 0) {
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
        .where('slide_library_tags.slide_library_id', 'in', slideLibraryIds)
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
     * Set tags for a slide library item (replaces existing tags).
     * Creates new tags if they don't exist.
     * @param {string} slideLibraryId - Slide library item ID
     * @param {string[]} tagNames - Array of tag names
     * @param {object} ctx - Storage context
     * @returns {Promise<Array<{id: string, name: string}>>}
     */
    async setTagsForSlideLibraryItem(slideLibraryId, tagNames, ctx) {
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

      // Remove all existing tags for this slide library item
      await db
        .deleteFrom('slide_library_tags')
        .where('slide_library_id', '=', slideLibraryId)
        .execute();

      if (uniqueNames.length === 0) {
        return [];
      }

      // Get or create tags (reuses existing org tags)
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

      // Insert slide_library_tags relationships
      if (tagIds.length > 0) {
        await db
          .insertInto('slide_library_tags')
          .values(
            tagIds.map((tag) => ({
              slide_library_id: slideLibraryId,
              tag_id: tag.id,
              created_at: now(),
            }))
          )
          .execute();
      }

      return tagIds;
    }
  };
}