/**
 * PostgreSQL follow codes storage module.
 */

import { getDb, getOrgId, now } from './helpers.js';

/**
 * FollowCodes mixin - adds follow code methods to adapter.
 * @param {typeof import('../interface.js').StorageAdapter} Base
 */
export function withFollowCodes(Base) {
  return class extends Base {
    async createFollowCode(code, followUrl, ctx, opts = {}) {
      const db = getDb();
      const orgId = getOrgId(ctx);
      const expiresAt = opts?.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const row = await db
        .insertInto('follow_codes')
        .values({
          code,
          organization_id: orgId,
          follow_url: followUrl,
          expires_at: expiresAt,
        })
        .returningAll()
        .executeTakeFirst();

      return {
        code: row.code,
        followUrl: row.follow_url,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      };
    }

    async resolveFollowCode(code, ctx) {
      const db = getDb();

      const row = await db
        .selectFrom('follow_codes')
        .select('follow_url')
        .where('code', '=', code)
        .where('expires_at', '>', now())
        .executeTakeFirst();

      return row?.follow_url || null;
    }

    async cleanupExpiredFollowCodes(ctx) {
      const db = getDb();

      const result = await db
        .deleteFrom('follow_codes')
        .where('expires_at', '<', now())
        .executeTakeFirst();

      return Number(result.numDeletedRows) || 0;
    }
  };
}