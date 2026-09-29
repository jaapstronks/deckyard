/**
 * The membership a login writes in multi-organization mode: the one policy
 * shared by every route that signs a person in and may create their `users`
 * row (SSO, magic link).
 *
 * @see server/storage/sso.js
 * @see server/storage/magic-link.js
 */

import { nowIso } from '../utils/normalize.js';
import { isMultiOrgEnabled } from '../config/features.js';
import { listUserOrganizations } from './user-organizations/index.js';

/**
 * Give a person who just proved their identity an organization to work in
 * (multi-organization mode). Both login routes that can create a `users` row
 * call this, SSO and magic link, so a login never ends with a user who holds
 * no membership and bounces back to `/login`. A no-op in single-organization
 * mode.
 *
 * The organization row lock serializes the empty-org decision and insert,
 * including concurrent first logins. Recheck the user's memberships after
 * acquiring it: another login may have provisioned the same person meanwhile.
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {object} user - Raw `users` row: freshly inserted, or as found
 *   before this login's update (a refusal must not have written it)
 * @param {boolean} autoProvision - The operator's provisioning policy
 * @param {string | null} targetOrgId - Organization matched from an OIDC claim;
 *   null means "any membership will do", and a new one lands in the user's
 *   home organization (owner when it has no members yet, member otherwise)
 * @param {'admin' | 'member'} role - Role for a new claimed membership
 * @returns {Promise<{ ok: true, membership: { organizationId: string, role: string } | null }
 *   | { ok: false, reason: string }>}
 */
export async function ensureMembership(
  db,
  user,
  autoProvision,
  targetOrgId,
  role,
) {
  if (!isMultiOrgEnabled()) return { ok: true, membership: null };

  if (targetOrgId) {
    const existing = await db
      .selectFrom('user_organizations')
      .select('id')
      .where('user_id', '=', user.id)
      .where('organization_id', '=', targetOrgId)
      .executeTakeFirst();
    if (existing) return { ok: true, membership: null };
  } else {
    const held = await listUserOrganizations(user.id);
    if (held.length) return { ok: true, membership: null };
  }
  if (!autoProvision) return { ok: false, reason: 'no_membership' };

  const organizationId = targetOrgId || user.organization_id;
  return db.transaction().execute(async (trx) => {
    await trx
      .selectFrom('organizations')
      .select('id')
      .where('id', '=', organizationId)
      .forUpdate()
      .executeTakeFirstOrThrow();

    let membershipQuery = trx
      .selectFrom('user_organizations')
      .select('id')
      .where('user_id', '=', user.id);
    if (targetOrgId) {
      membershipQuery = membershipQuery.where(
        'organization_id',
        '=',
        organizationId,
      );
    }
    const existing = await membershipQuery.executeTakeFirst();
    if (existing) return { ok: true, membership: null };

    const count = await trx
      .selectFrom('user_organizations')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
    const membershipRole = targetOrgId
      ? role
      : Number(count?.count || 0) === 0
        ? 'owner'
        : 'member';
    const now = nowIso();
    await trx
      .insertInto('user_organizations')
      .values({
        user_id: user.id,
        organization_id: organizationId,
        role: membershipRole,
        joined_at: now,
        created_at: now,
        updated_at: now,
      })
      .execute();
    return { ok: true, membership: { organizationId, role: membershipRole } };
  });
}
