/**
 * Organization-role gate for server-side authorization.
 *
 * Two role systems meet on the user object and they are not the same thing:
 *
 *   - `user.isAdmin` comes from `users.role` and is **instance-wide**. It is
 *     what the instance-scoped surfaces (admin users, email templates,
 *     integrations, analytics) check.
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
 * This is the server half of `client/lib/user/organization-role.js` and holds
 * the same rule, deliberately: the UI decides what to render with it and the
 * server decides what to allow, and the two disagreeing is how a user gets
 * shown a button whose request is refused (or, worse, is refused a button
 * whose request would have been allowed). The role ladder itself is not
 * restated here — `hasOrganizationRole()` in
 * server/storage/user-organizations/memberships.js is the one implementation.
 */

import { hasOrganizationRole } from '../storage/user-organizations/index.js';

/**
 * Whether the user is an admin *of the organization they are acting in*.
 *
 * Instance admin is necessary; in multi-organization mode being `admin` or
 * `owner` of the active organization is necessary too. Without a membership
 * role this is exactly the old `user.isAdmin` check, so single-organization
 * instances, the dev bypass and the sandbox are unchanged — an unrecognized
 * role value is treated the same way, matching the client helper rather than
 * inventing a second answer for one question.
 *
 * @param {{ isAdmin?: boolean, organizationRole?: string|null }} [user]
 * @returns {boolean}
 */
export function isOrganizationAdmin(user) {
  if (!user?.isAdmin) return false;
  const role = user.organizationRole;
  if (!hasOrganizationRole(role, 'member')) return true;
  return hasOrganizationRole(role, 'admin');
}
