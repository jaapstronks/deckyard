/**
 * PostgreSQL image favorites storage module.
 */

import { getDb, getOrgId } from './helpers.js';

/**
 * Image favorites mixin - adds favorite methods to adapter.
 * @param {typeof import('../interface.js').StorageAdapter} Base
 */
export function withImageFavorites(Base) {
  return class extends Base {
    /**
     * Get all favorite image IDs for a user.
     * @param {string} userEmail - User's email
     * @param {object} ctx - Storage context
     * @returns {Promise<string[]>} Array of image IDs
     */
    async getImageFavorites(userEmail, ctx) {
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

    /**
     * Check if an image is favorited by a user.
     * @param {string} imageId - Image ID
     * @param {string} userEmail - User's email
     * @param {object} ctx - Storage context
     * @returns {Promise<boolean>}
     */
    async isImageFavorite(imageId, userEmail, ctx) {
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

    /**
     * Add an image to user's favorites.
     * @param {string} imageId - Image ID
     * @param {string} userEmail - User's email
     * @param {object} ctx - Storage context
     * @returns {Promise<boolean>} True if added, false if already existed
     */
    async addImageFavorite(imageId, userEmail, ctx) {
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

    /**
     * Remove an image from user's favorites.
     * @param {string} imageId - Image ID
     * @param {string} userEmail - User's email
     * @param {object} ctx - Storage context
     * @returns {Promise<boolean>} True if removed
     */
    async removeImageFavorite(imageId, userEmail, ctx) {
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

    /**
     * Toggle favorite status for an image.
     * @param {string} imageId - Image ID
     * @param {string} userEmail - User's email
     * @param {object} ctx - Storage context
     * @returns {Promise<boolean>} New favorite status (true if now favorited)
     */
    async toggleImageFavorite(imageId, userEmail, ctx) {
      const isFavorite = await this.isImageFavorite(imageId, userEmail, ctx);
      if (isFavorite) {
        await this.removeImageFavorite(imageId, userEmail, ctx);
        return false;
      } else {
        await this.addImageFavorite(imageId, userEmail, ctx);
        return true;
      }
    }
  };
}
