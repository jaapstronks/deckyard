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
 */

/** Membership roles, weakest first. */
const WORKSPACE_ROLES = ['member', 'admin', 'owner'];

/**
 * Whether a membership role is at least the required level.
 * Mirrors `hasWorkspaceRole()` in
 * server/storage/user-organizations/memberships.js.
 * @param {string|null|undefined} role - Membership role
 * @param {string} required - Minimum role
 * @returns {boolean}
 */
export function hasWorkspaceRole(role, required) {
  const level = WORKSPACE_ROLES.indexOf(role);
  const requiredLevel = WORKSPACE_ROLES.indexOf(required);
  return level >= 0 && requiredLevel >= 0 && level >= requiredLevel;
}

/**
 * The user's membership role in the organization they are currently in, or
 * null when there is none to speak of (single-workspace, dev bypass, sandbox).
 * @param {Object} [user] - User from `/api/auth/me`
 * @returns {string|null}
 */
export function getWorkspaceRole(user) {
  const role = user?.organizationRole;
  return WORKSPACE_ROLES.includes(role) ? role : null;
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
export function isWorkspaceAdmin(user) {
  if (!user?.isAdmin) return false;
  const role = getWorkspaceRole(user);
  if (!role) return true;
  return hasWorkspaceRole(role, 'admin');
}
