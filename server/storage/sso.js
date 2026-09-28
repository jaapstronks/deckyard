/**
 * Storage layer for SSO (OIDC) users. JIT-provisions or updates a user from a
 * verified SSO identity and returns the object `setSessionCookie` needs.
 *
 * Mirrors {@link getOrCreateMagicLinkUser}: upsert by email (globally unique),
 * set `auth_source`, and stamp the session-version key from the shared
 * {@link sessionVersion} helper the async validator also uses, so the minted
 * cookie validates on the next request.
 *
 * @see server/utils/session-version.js
 * @see server/storage/magic-link.js
 * @see server/auth/auth.js (getUserFromRequestAsync, setSessionCookie)
 */

import { getOrgId } from '../utils/context.js';
import { toStorageContext } from './scope.js';
import { getUserByEmailGlobal } from './identity.js';
import { nowIso, normalizeEmail } from '../utils/normalize.js';
import { sessionVersion } from '../utils/session-version.js';
import { withDbGuard } from './utils/index.js';
import { envStr } from '../config/utils.js';
import { isMultiOrgEnabled } from '../config/features.js';
import { invalidateDisplayNames } from './display-identity.js';
import { listUserOrganizations } from './user-organizations/index.js';

/**
 * The AUTH_ADMIN_EMAIL bootstrap admin, lowercased, or '' when unset.
 * @returns {string}
 */
function getAdminEmail() {
  return envStr('AUTH_ADMIN_EMAIL').toLowerCase();
}

/**
 * Give an SSO identity an organization to work in (multi-organization mode).
 *
 * The organization row lock serializes the empty-org decision and insert,
 * including concurrent first logins. Recheck the user's memberships after
 * acquiring it: another login may have provisioned the same person meanwhile.
 *
 * @param {object} user - Raw `users` row: freshly inserted, or as found
 *   before this login's update (a refusal must not have written it)
 * @param {boolean} autoProvision - The operator's provisioning policy
 * @param {string | null} targetOrgId - Organization matched from an OIDC claim
 * @param {'admin' | 'member'} role - Role for a new claimed membership
 * @returns {Promise<{ ok: true, membership: { organizationId: string, role: string } | null }
 *   | { ok: false, reason: string }>}
 */
async function ensureMembership(db, user, autoProvision, targetOrgId, role) {
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

/**
 * Provision (or update) a Deckyard user from a verified SSO identity.
 *
 * Role policy (self-hosted single-IdP): an SSO login can *grant* admin (via
 * group mapping or the AUTH_ADMIN_EMAIL match) but never auto-*demotes* — a
 * transient missing group-claim must not lock out every admin. Removing admin
 * is done through the admin-users UI. New users are provisioned at
 * `defaultRole` unless the identity is admin.
 *
 * In multi-organization mode the person also needs a membership to act in;
 * see {@link ensureMembership} for when one is written and which role it gets.
 *
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {{ email: string, name?: string, isAdmin?: boolean, externalOrgId?: string | null }} identity - From
 *   {@link mapClaimsToIdentity}.
 * @param {object} opts
 * @param {boolean} opts.autoProvision - When false, unknown users are rejected
 *   rather than created, and a known user without any membership is refused
 *   rather than given one.
 * @param {string} opts.defaultRole - Role for newly provisioned users ('user'|'admin').
 * @returns {Promise<{ ok: true, user: object, provisioned: boolean,
 *   organizationId: string | null,
 *   membership: { organizationId: string, role: string } | null }
 *   | { ok: false, reason: string }>} `membership` names the organization
 *   membership this login created, or null when none was needed.
 */
export async function getOrCreateSsoUser(scope, identity, opts) {
  toStorageContext(scope, 'getOrCreateSsoUser');
  const email = normalizeEmail(identity?.email);
  if (!email || !email.includes('@')) {
    return { ok: false, reason: 'invalid', field: 'email' };
  }

  const name = String(identity?.name || '').trim();
  const grantsAdmin = !!identity?.isAdmin || email === getAdminEmail();
  const defaultRole = opts?.defaultRole === 'admin' ? 'admin' : 'user';

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    let orgId = getOrgId(scope);
    if (identity.externalOrgId) {
      const organization = await db
        .selectFrom('organizations')
        .select('id')
        .where('external_id', '=', identity.externalOrgId)
        .executeTakeFirst();
      if (!organization) return { ok: false, reason: 'org_not_found' };
      orgId = organization.id;
    }
    const now = nowIso();

    // Resolved across organizations: the IdP asserts an email, and that email
    // identifies exactly one person instance-wide (users.email is unique).
    let user = await getUserByEmailGlobal(email);

    let provisioned = false;

    if (!user) {
      if (!opts?.autoProvision) {
        return { ok: false, reason: 'not_provisioned' };
      }
      const inserted = await db
        .insertInto('users')
        .values({
          organization_id: orgId,
          email,
          name: name || null,
          role: grantsAdmin ? 'admin' : defaultRole,
          auth_source: 'oidc',
          created_at: now,
          updated_at: now,
        })
        .onConflict((oc) => oc.column('email').doNothing())
        .returningAll()
        .executeTakeFirst();
      user = inserted || (await getUserByEmailGlobal(email));
      provisioned = Boolean(inserted);
    }
    // Membership first: a refused login (no_membership) must leave the
    // existing user row untouched - no rename, no admin grant, no
    // auth_source flip. The membership does not depend on the update below.
    const membershipResult = await ensureMembership(
      db,
      user,
      !!opts?.autoProvision,
      identity.externalOrgId ? orgId : null,
      grantsAdmin || defaultRole === 'admin' ? 'admin' : 'member',
    );
    if (!membershipResult.ok) return membershipResult;

    if (!provisioned) {
      // Update on login: keep name fresh, mark the source as SSO, and grant
      // admin if the identity says so (never demote — see policy above).
      const updates = { auth_source: 'oidc', updated_at: now };
      if (name && name !== user.name) updates.name = name;
      if (grantsAdmin && user.role !== 'admin') updates.role = 'admin';

      const updated = await db
        .updateTable('users')
        .set(updates)
        .where('id', '=', user.id)
        .returningAll()
        .executeTakeFirst();
      user = updated || { ...user, ...updates };
      // `users.name` feeds the memoized response `displayName`
      // (storage/display-identity.js); a rename at login lands now, not
      // within the TTL.
      if (updates.name) invalidateDisplayNames();
    }

    const adminEmail = getAdminEmail();
    const role =
      user.role === 'admin' || email === adminEmail ? 'admin' : 'user';

    return {
      ok: true,
      provisioned,
      membership: membershipResult.membership,
      organizationId: identity.externalOrgId ? orgId : null,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || '',
        role,
        isAdmin: role === 'admin',
        v: sessionVersion(user),
      },
    };
  });
}
