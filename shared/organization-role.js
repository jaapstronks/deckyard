/**
 * The membership-role ladder — the one place that ranks organization roles.
 *
 * A membership role (`owner` / `admin` / `member`) says what someone may do
 * *in the organization they are currently in*. Both halves of the stack ask
 * the same question of it: the client to decide what to render, the server to
 * decide what to allow. When those two disagree a user is shown a control
 * whose request is refused — or refused a control whose request would have
 * been allowed — so the ranking lives here and both sides import it.
 *
 * It imports nothing on purpose, and it deliberately holds *only* the ladder:
 * membership rows, the instance-wide `users.role` flag and the conjunction of
 * the two are not shared concerns. The gates that combine them stay where they
 * are — `client/lib/user/organization-role.js` for the UI,
 * `server/utils/organization-role.js` for authorization.
 *
 * @module shared/organization-role
 */

/**
 * Organization roles in order of increasing privileges.
 * - member: Regular user, can view and edit content
 * - admin: Can manage members and organization settings
 * - owner: Billing contact, full control, can delete organization
 */
export const WORKSPACE_ROLES = ['member', 'admin', 'owner'];

/**
 * Check if a role has at least the specified permission level.
 *
 * An unrecognized role satisfies nothing — not even `member` — so callers can
 * use this as the membership test as well as the ranking.
 *
 * @param {string|null|undefined} userRole - User's membership role
 * @param {string} requiredRole - Required minimum role
 * @returns {boolean}
 */
export function hasOrganizationRole(userRole, requiredRole) {
  const userLevel = WORKSPACE_ROLES.indexOf(userRole);
  const requiredLevel = WORKSPACE_ROLES.indexOf(requiredRole);
  return userLevel >= 0 && requiredLevel >= 0 && userLevel >= requiredLevel;
}
