/**
 * PostgreSQL per-user slide-library usage storage module.
 *
 * Records when a user first used a library slide or collection as a starting
 * point for a deck. Powers the Home building-blocks "new to you" badge. Stores
 * references only (item_type + item_id), never slide content; no FK, so a
 * later-deleted item simply stops matching.
 */

import { getDb, getOrgId, now, sql } from './helpers.js';

const ITEM_TYPES = new Set(['slide', 'collection']);

/**
 * Clean an incoming list of usage refs: drop blanks/invalid types, de-duplicate
 * on (type, id), keep first occurrence.
 * @param {unknown} input - [{ type, id }]
 * @returns {Array<{ itemType: string, itemId: string }>}
 */
function normalizeUsageItems(input) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(input) ? input : []) {
    const itemType = String(raw?.type || '').trim();
    const itemId = String(raw?.id || '').trim();
    if (!ITEM_TYPES.has(itemType) || !itemId) continue;
    const key = `${itemType}:${itemId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ itemType, itemId });
  }
  return out;
}

/**
 * Slide-library usage mixin - adds per-user usage tracking to the adapter.
 * @param {typeof import('../interface.js').StorageAdapter} Base
 */
export function withSlideLibraryUsage(Base) {
  return class extends Base {
    async listSlideLibraryUsage(userEmail, ctx) {
      const email = String(userEmail || '').trim().toLowerCase();
      if (!email) return [];

      const db = getDb();
      const orgId = getOrgId(ctx);

      const rows = await db
        .selectFrom('slide_library_usage')
        .select(['item_type', 'item_id', 'first_used_at', 'use_count', 'updated_at'])
        .where('organization_id', '=', orgId)
        .where('user_email', '=', email)
        .execute();

      return rows.map((r) => ({
        itemType: r.item_type,
        itemId: r.item_id,
        firstUsedAt: r.first_used_at ? new Date(r.first_used_at).toISOString() : '',
        useCount: Number(r.use_count) || 0,
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : '',
      }));
    }

    async recordSlideLibraryUsage(userEmail, items, ctx) {
      const email = String(userEmail || '').trim().toLowerCase();
      const refs = normalizeUsageItems(items);
      if (!email || !refs.length) return 0;

      const db = getDb();
      const orgId = getOrgId(ctx);
      const ts = now();

      for (const { itemType, itemId } of refs) {
        await db
          .insertInto('slide_library_usage')
          .values({
            organization_id: orgId,
            user_email: email,
            item_type: itemType,
            item_id: itemId,
            first_used_at: ts,
            use_count: 1,
            updated_at: ts,
          })
          .onConflict((oc) =>
            oc
              .columns(['organization_id', 'user_email', 'item_type', 'item_id'])
              .doUpdateSet({
                use_count: sql`slide_library_usage.use_count + 1`,
                updated_at: ts,
              })
          )
          .execute();
      }

      return refs.length;
    }
  };
}
