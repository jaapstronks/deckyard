/**
 * Workspace-role helpers for UI gates.
 *
 * Two role systems meet on the user object and they are not the same thing:
 *
 *   - `user.isAdmin` comes from `users.role` and is **instance-wide**. It is
 *     what the instance-scoped APIs (admin users, email, integrations,
 *     API keys, analytics) still check.
 *   - `user.organizationRole` is the membership role (`owner` / `admin` /
 *     `member`) in the organization the session is currently in. It is what
 *     the organization-scoped APIs check, and it is only present in
 *     multi-workspace mode — single-workspace instances get `null`, because
 *     there is only one organization and no membership to read.
 *
 * Gating the admin surfaces on `isAdmin` alone means someone who is admin in
 * organization A stays admin in organization B the moment they switch. Gating
 * on the membership role alone would do the opposite damage: an organization
 * admin who is not an instance admin would be shown tabs whose API answers
 * 403. So the gate is the conjunction, and the membership role only ever
 * *narrows* what the instance role already allows.
 *
 * The ladder those roles form is not restated here: it lives in
 * `shared/organization-role.js` and the server gate
 * (`server/utils/organization-role.js`) imports the same one, so the two
 * halves cannot rank a role differently.
 */

import {
  WORKSPACE_ROLES,
  hasOrganizationRole,
} from '../../../shared/organization-role.js';

/**
 * The user's membership role in the organization they are currently in, or
 * null when there is none to speak of (single-workspace, dev bypass, sandbox).
 * @param {Object} [user] - User from `/api/auth/me`
 * @returns {string|null}
 */
export function getOrganizationRole(user) {
  const role = user?.organizationRole;
  return WORKSPACE_ROLES.includes(role) ? role : null;
}

/**
 * Whether the session is bound to a membership at all — that is, whether
 * "the organization you are in" is a thing this instance can talk about.
 *
 * True only in multi-workspace mode: single-workspace instances (and the dev
 * bypass and the sandbox, which have no membership row) get `null` for the
 * role and are unchanged by anything gated on this.
 *
 * @param {Object} [user] - User from `/api/auth/me`
 * @returns {boolean}
 */
export function isOrganizationMember(user) {
  return getOrganizationRole(user) !== null;
}

/**
 * Whether the member list should be reachable for this user.
 *
 * Gating it on `isOrganizationAdmin()` alone (slice 2) left a plain member unable
 * to reach the one screen carrying their own *Leave* button — the API allows
 * any member to read the list and to remove themselves, so the gate was
 * stricter than the rule it was mirroring. The row-level controls stay where
 * they were: `organization-members/permissions.js` gives a plain member a
 * read-only list plus their own way out, and nothing else.
 *
 * @param {Object} [user] - User from `/api/auth/me`
 * @returns {boolean}
 */
export function canSeeMemberList(user) {
  return isOrganizationAdmin(user) || isOrganizationMember(user);
}

/**
 * Whether the admin surfaces should be shown to this user.
 *
 * Instance admin is necessary; in multi-workspace mode being `admin` or
 * `owner` of the *active* organization is necessary too. Without a membership
 * role this is exactly the old `user.isAdmin` check, so single-workspace
 * instances are unchanged.
 *
 * @param {Object} [user] - User from `/api/auth/me`
 * @returns {boolean}
 */
export function isOrganizationAdmin(user) {
  if (!user?.isAdmin) return false;
  const role = getOrganizationRole(user);
  if (!role) return true;
  return hasOrganizationRole(role, 'admin');
}
