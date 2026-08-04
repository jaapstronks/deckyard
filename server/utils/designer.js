/**
 * Designer capability utilities.
 * Resolves whether a user has designer capability based on their
 * membership flags, role, and organization settings.
 */

import { getMembershipByEmail, hasDesignerCapability } from '../storage/user-organizations/index.js';
import { getOrganizationById } from '../storage/user-organizations/index.js';
import { isMultiWorkspaceEnabled } from '../config/features.js';
import { getOrgSettings } from './org-settings.js';

/**
 * Resolve whether a user has designer capability.
 * Looks up the user's membership and org settings to determine capability.
 *
 * On a single-workspace instance the instance admin is the only administrator
 * there is, and the modes that have no database at all (auth disabled, dev
 * bypass, sandbox) have no membership row to read — so `isAdmin` stands in for
 * the membership there, as it always has.
 *
 * In multi-workspace mode it must not: designer capability is held *per
 * organization*, the same way the membership role is (see
 * client/lib/user/workspace-role.js). An instance-wide admin who is a plain
 * member of the organization they switched into gets designer capability only
 * if that membership says so — via `is_designer`, via being its owner, or via
 * the organization's `adminsAreDesigners` setting.
 *
 * This runs once per request, so it avoids reading `user_organizations` a second
 * time. In multi-workspace mode the active membership was already read while
 * resolving the session's organization (auth/auth.js → resolveActiveMembership),
 * and it carries both the role and the raw designer flag — so the membership is
 * reused from the user object rather than re-queried by email. The organization
 * row (for `adminsAreDesigners`) is only read when it can actually change the
 * answer, i.e. for an admin whose membership does not already grant designer.
 *
 * @param {Object} user - User object from auth (must have email, organizationId)
 * @returns {Promise<boolean>}
 */
export async function resolveDesignerCapability(user) {
  if (!user?.email) return false;

  if (!isMultiWorkspaceEnabled() && user.isAdmin) return true;

  const orgId = user.organizationId;

  try {
    // A non-null `organizationRole` means the active membership was resolved in
    // auth and its row travels on the user object; reuse role + raw designer
    // flag. Otherwise (single-workspace member, dev bypass, sandbox) read it.
    const membership =
      user.organizationRole != null
        ? { role: user.organizationRole, isDesigner: Boolean(user.organizationIsDesigner) }
        : await getMembershipByEmail(user.email, orgId);
    if (!membership) return false;

    // Owners, explicit designers and plain members are decided by the membership
    // alone; only an admin without the flag depends on `adminsAreDesigners`, so
    // defer that organization read until it is the deciding factor.
    const needsOrgSettings = membership.role === 'admin' && !membership.isDesigner;
    const org = needsOrgSettings ? await getOrganizationById(orgId) : null;

    return hasDesignerCapability(membership, getOrgSettings(org));
  } catch {
    return false;
  }
}
