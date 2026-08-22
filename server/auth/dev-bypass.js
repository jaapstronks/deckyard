/**
 * The development auth bypass, as a real database identity.
 *
 * `AUTH_DEV_BYPASS=1` (with `NODE_ENV=development`, enforced by
 * {@link devAuthBypassEnabled}) hands every request an admin session without a
 * login. That session used to carry an address and no `users.id`, which worked
 * only because the ownership rule fell back to comparing addresses. That
 * fallback is gone (D22; see shared/identity-match.js), so the bypass user needs
 * what every other user has: a row in `users` and the id on it.
 *
 * This module resolves that row once per process and creates it on first use, so
 * a fresh clone with the bypass on behaves like a normal login instead of
 * silently owning nothing. The row is an ordinary admin user — nothing about it
 * is special beyond the address it uses — and it is only ever touched when the
 * bypass is enabled, which refuses to be on outside development.
 *
 * @module auth/dev-bypass
 */

import { getDefaultOrganizationId } from '../config/database.js';
import { withDbGuard } from '../storage/utils/db-guard.js';
import { nowIso } from '../utils/normalize.js';

/**
 * The address the development bypass acts under.
 *
 * The domain carries a TLD on purpose. `validateEmail`
 * (`server/utils/secure-tokens.js`) requires a dot in the domain, so a
 * single-label `dev@local` was rejected by every surface that validates an
 * address — `createApiKey` among them, which made the public API surface
 * untestable on a bypass machine. `.test` is reserved by RFC 2606, so the
 * address stays synthetic and never resolves.
 *
 * Existing dev databases carry the old row; the one-line repair is in
 * `docs/developer/dev-setup.md` § The dev-bypass identity.
 */
export const DEV_BYPASS_EMAIL = 'dev@local.test';

/**
 * In-process memo of the resolution, so the lookup happens once rather than on
 * every request. Cleared on failure so a database that was down at first use
 * gets another chance.
 * @type {Promise<string|null>|null}
 */
let pending = null;

/**
 * Resolve (creating on first use) the `users.id` of the dev-bypass user.
 *
 * Answers `null` when the database is unreachable — the bypass session then
 * carries no id and matches no ownership stamp, which is the honest degraded
 * state rather than a crash on a local machine with no database.
 *
 * @returns {Promise<string|null>}
 */
export function resolveDevBypassUserId() {
  if (!pending) {
    pending = ensureDevBypassUserId().catch(() => null);
  }
  return pending.then((id) => {
    if (!id) pending = null;
    return id;
  });
}

/**
 * Reset the memo. Test seam; production has no reason to call it.
 * @returns {void}
 */
export function resetDevBypassUserCache() {
  pending = null;
}

/**
 * Look up `dev@local.test`, inserting the row when it is not there yet.
 * @returns {Promise<string|null>}
 */
async function ensureDevBypassUserId() {
  return withDbGuard(null, async (db) => {
    const existing = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', DEV_BYPASS_EMAIL)
      .executeTakeFirst();
    if (existing?.id) return existing.id;

    const now = nowIso();
    const inserted = await db
      .insertInto('users')
      .values({
        organization_id: getDefaultOrganizationId(),
        email: DEV_BYPASS_EMAIL,
        name: 'Dev',
        role: 'admin',
        // No password: this identity is only ever reached through the bypass,
        // never through the login form.
        auth_source: 'database',
        created_at: now,
        updated_at: now,
      })
      // A second worker may have inserted it between the select and here.
      .onConflict((oc) => oc.column('email').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (inserted?.id) return inserted.id;

    const raced = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', DEV_BYPASS_EMAIL)
      .executeTakeFirst();
    return raced?.id || null;
  });
}
