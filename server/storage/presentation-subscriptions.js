/**
 * Per-deck notification subscription storage (phase 4 of the comments &
 * notifications plan). A row is an explicit override of the user's global
 * default level; no row means "use the default".
 */

import { getOrgId } from '../utils/context.js';
import { norm, normalizeEmail, nowIso } from '../utils/normalize.js';
import { withDbGuard } from './utils/db-guard.js';

/** Valid subscription levels, most → least verbose. */
export const SUBSCRIPTION_LEVELS = ['watching', 'participating', 'mentions_only', 'mute'];

/**
 * Get a user's subscription override for a deck.
 * @returns {Promise<{level: string}|null>} null = no override (use default)
 */
export async function getSubscription(presentationId, userEmail, ctx) {
  const pid = norm(presentationId);
  const email = normalizeEmail(userEmail);
  if (!pid || !email) return null;

  return withDbGuard(null, async (db) => {
    const row = await db
      .selectFrom('presentation_subscriptions')
      .select(['level', 'updated_at'])
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', getOrgId(ctx))
      .where('user_email', '=', email)
      .executeTakeFirst();
    return row ? { level: row.level, updatedAt: row.updated_at } : null;
  });
}

/**
 * Set (or clear) a user's subscription override for a deck.
 * @param {string|null} level - One of SUBSCRIPTION_LEVELS, or null to clear
 */
export async function setSubscription(presentationId, userEmail, level, ctx) {
  const pid = norm(presentationId);
  const email = normalizeEmail(userEmail);
  if (!pid || !email) return { ok: false, reason: 'invalid' };
  if (level !== null && !SUBSCRIPTION_LEVELS.includes(level)) {
    return { ok: false, reason: 'invalid_level' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    if (level === null) {
      await db
        .deleteFrom('presentation_subscriptions')
        .where('presentation_id', '=', pid)
        .where('organization_id', '=', orgId)
        .where('user_email', '=', email)
        .execute();
      return { ok: true, level: null };
    }

    const now = nowIso();
    await db
      .insertInto('presentation_subscriptions')
      .values({
        organization_id: orgId,
        presentation_id: pid,
        user_email: email,
        level,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.columns(['presentation_id', 'user_email']).doUpdateSet({ level, updated_at: now })
      )
      .execute();
    return { ok: true, level };
  });
}

/**
 * All subscription overrides on a deck, as a Map email → level.
 * @returns {Promise<Map<string, string>>}
 */
export async function listSubscriptions(presentationId, ctx) {
  const pid = norm(presentationId);
  if (!pid) return new Map();

  return withDbGuard(new Map(), async (db) => {
    const rows = await db
      .selectFrom('presentation_subscriptions')
      .select(['user_email', 'level'])
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', getOrgId(ctx))
      .execute();
    return new Map(rows.map((r) => [normalizeEmail(r.user_email), r.level]));
  });
}
