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
import {
  addMember,
  countOrganizationMembers,
  listUserOrganizations,
} from './user-organizations/index.js';

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
 * In multi-organization mode a session only resolves through a
 * `user_organizations` row (`resolveActiveMembership`, storage/identity.js);
 * `users.organization_id` is the *home* organization, not a membership. A row
 * without one therefore logs in successfully and is refused on the very next
 * request — the browser lands on `/login` again with nothing to say (B430).
 *
 * The rule is the one `autoProvision` already states for the person: the IdP
 * decides who gets in. So a person it asserts who holds no membership at all
 * is given one in their home organization, `owner` when that organization has
 * no members yet (a fresh instance's first login must not need a database
 * edit), `member` otherwise. With `autoProvision` off the operator has said
 * "invited people only", and an invitation always carries a membership: a row
 * without one is a person whose access was removed, and it stays removed.
 *
 * Single-organization mode consults no memberships and writes none; the
 * query count of every existing installation is unchanged.
 *
 * @param {object} user - Raw `users` row, after the upsert
 * @param {boolean} autoProvision - The operator's provisioning policy
 * @returns {Promise<{ ok: true, membership: { organizationId: string, role: string } | null }
 *   | { ok: false, reason: string }>}
 */
async function ensureMembership(user, autoProvision) {
  if (!isMultiOrgEnabled()) return { ok: true, membership: null };

  const held = await listUserOrganizations(user.id);
  if (held.length) return { ok: true, membership: null };
  if (!autoProvision) return { ok: false, reason: 'no_membership' };

  const organizationId = user.organization_id;
  const role =
    (await countOrganizationMembers(organizationId)) === 0 ? 'owner' : 'member';
  const added = await addMember({ userId: user.id, organizationId, role });
  if (!added.ok) return { ok: false, reason: added.reason };
  return { ok: true, membership: { organizationId, role } };
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
 * @param {{ email: string, name?: string, isAdmin?: boolean }} identity - From
 *   {@link mapClaimsToIdentity}.
 * @param {object} opts
 * @param {boolean} opts.autoProvision - When false, unknown users are rejected
 *   rather than created, and a known user without any membership is refused
 *   rather than given one.
 * @param {string} opts.defaultRole - Role for newly provisioned users ('user'|'admin').
 * @returns {Promise<{ ok: true, user: object, provisioned: boolean,
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
    const orgId = getOrgId(scope);
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
        .returningAll()
        .executeTakeFirst();
      user = inserted;
      provisioned = true;
    } else {
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

    const membershipResult = await ensureMembership(
      user,
      !!opts?.autoProvision,
    );
    if (!membershipResult.ok) return membershipResult;

    const adminEmail = getAdminEmail();
    const role =
      user.role === 'admin' || email === adminEmail ? 'admin' : 'user';

    return {
      ok: true,
      provisioned,
      membership: membershipResult.membership,
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
