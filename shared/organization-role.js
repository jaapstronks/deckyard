/**
 * The organization-role gate — the one place that ranks membership roles and
 * the one place that decides who counts as an admin of the organization they
 * are acting in.
 *
 * Two role systems meet on the user object and they are not the same thing:
 *
 *   - `user.isAdmin` comes from `users.role` and is **instance-wide**. It is
 *     what the instance-scoped surfaces (admin users, email templates,
 *     integrations, API keys, analytics) check.
 *   - `user.organizationRole` is the membership role (`owner` / `admin` /
 *     `member`) in the organization the session is currently in
 *     (server/auth/auth.js → resolveActiveMembership). It exists only in
 *     multi-organization mode; single-organization instances, the dev bypass
 *     and the sandbox have no membership row, so it is `null` there.
 *
 * Gating an organization-scoped act on `isAdmin` alone means someone who is
 * admin in organization A stays admin in organization B the moment they switch
 * workspaces. Gating on the membership role alone would do the opposite damage:
 * an organization admin who is not an instance admin would pass a check the
 * rest of the stack still refuses. So the gate is the conjunction, and the
 * membership role only ever *narrows* what the instance role already allows.
 *
 * Both halves of the stack ask that same question: the client to decide what
 * to render, the server to decide what to allow. When those two disagree a
 * user is shown a control whose request is refused — or refused a control
 * whose request would have been allowed — so the rule lives here once and both
 * sides import it (B171/D67; until then the answer was written out three
 * times, with a comparative test standing guard over the drift).
 *
 * The module imports nothing on purpose: it reads the user object it is
 * handed and nothing else, so it is equally at home in the browser bundle and
 * in the server process.
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

/**
 * The user's membership role in the organization they are currently in, or
 * null when there is none to speak of (single-workspace, dev bypass, sandbox).
 *
 * @param {{ organizationRole?: string|null }} [user] - User from `/api/auth/me`
 *   or the server-side session user
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
 * @param {{ organizationRole?: string|null }} [user] - User from `/api/auth/me`
 * @returns {boolean}
 */
export function isOrganizationMember(user) {
  return getOrganizationRole(user) !== null;
}

/**
 * Whether the user is an admin *of the organization they are acting in*.
 *
 * Instance admin is necessary; in multi-workspace mode being `admin` or
 * `owner` of the *active* organization is necessary too. Without a membership
 * role this is exactly the old `user.isAdmin` check, so single-workspace
 * instances, the dev bypass and the sandbox are unchanged — and an
 * unrecognized role value lands in that same branch rather than getting an
 * answer of its own.
 *
 * @param {{ isAdmin?: boolean, organizationRole?: string|null }} [user]
 * @returns {boolean}
 */
export function isOrganizationAdmin(user) {
  if (!user?.isAdmin) return false;
  const role = getOrganizationRole(user);
  if (!role) return true;
  return hasOrganizationRole(role, 'admin');
}

/**
 * Whether the member list should be reachable for this user.
 *
 * Gating it on `isOrganizationAdmin()` alone (slice 2) left a plain member
 * unable to reach the one screen carrying their own *Leave* button — the API
 * allows any member to read the list and to remove themselves, so the gate was
 * stricter than the rule it was mirroring. The row-level controls stay where
 * they were: `organization-members/permissions.js` gives a plain member a
 * read-only list plus their own way out, and nothing else.
 *
 * @param {{ isAdmin?: boolean, organizationRole?: string|null }} [user]
 * @returns {boolean}
 */
export function canSeeMemberList(user) {
  return isOrganizationAdmin(user) || isOrganizationMember(user);
}
