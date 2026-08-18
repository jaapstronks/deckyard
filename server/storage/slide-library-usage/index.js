/**
 * Per-user slide-library usage storage facade.
 *
 * "Usage" = the current user picked a library slide or collection as a starting
 * point for a deck (compose or insert-into-existing). It powers the Home
 * building-blocks shelf's "new to you" badge: a team item the user has never
 * used is flagged; the flag clears after first use. Records references only
 * (item_type + item_id), never slide content; no FK, so a later-deleted item
 * simply stops matching.
 *
 * Both functions take a **storage scope** rather than a bare `repoRoot`, so the
 * organization comes from the caller instead of a hardcoded default — see
 * server/storage/scope.js. Queries run directly through Kysely (B79/D34 removed
 * the adapter indirection); getDb() throws on an uninitialized database.
 */

import { getDb, sql } from '../../db/client.js';
import { getOrgId } from '../../utils/context.js';
import { toStorageContext } from '../scope.js';

const ITEM_TYPES = new Set(['slide', 'collection']);

/** @returns {string} current ISO timestamp */
function now() {
  return new Date().toISOString();
}

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
 * List the current user's usage records (set of used {itemType, itemId}).
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} userEmail
 * @returns {Promise<{ items: Array<object> }>}
 */
export async function listSlideLibraryUsage(storageScope, userEmail) {
  const email = String(userEmail || '').trim().toLowerCase();
  const ctx = toStorageContext(storageScope, 'listSlideLibraryUsage', { userEmail: email });
  if (!email) return { items: [] };

  const db = getDb();
  const orgId = getOrgId(ctx);

  const rows = await db
    .selectFrom('slide_library_usage')
    .select(['item_type', 'item_id', 'first_used_at', 'use_count', 'updated_at'])
    .where('organization_id', '=', orgId)
    .where('user_email', '=', email)
    .execute();

  const items = rows.map((r) => ({
    itemType: r.item_type,
    itemId: r.item_id,
    firstUsedAt: r.first_used_at ? new Date(r.first_used_at).toISOString() : '',
    useCount: Number(r.use_count) || 0,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : '',
  }));

  return { items };
}

/**
 * Record usage of one or more library items for a user.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} userEmail
 * @param {Array<{ type: 'slide'|'collection', id: string }>} items
 * @returns {Promise<{ ok: boolean, recorded: number }>}
 */
export async function recordSlideLibraryUsage(storageScope, userEmail, items) {
  const email = String(userEmail || '').trim().toLowerCase();
  if (!email) return { ok: true, recorded: 0 };
  const ctx = toStorageContext(storageScope, 'recordSlideLibraryUsage', { userEmail: email });

  const refs = normalizeUsageItems(items);
  if (!refs.length) return { ok: true, recorded: 0 };

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

  return { ok: true, recorded: refs.length };
}
