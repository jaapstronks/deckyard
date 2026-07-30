/**
 * Designer capability utilities.
 * Resolves whether a user has designer capability based on their
 * membership flags, role, and organization settings.
 */

import { getMembershipByEmail, hasDesignerCapability } from '../storage/user-organizations/index.js';
import { getOrganizationById } from '../storage/user-organizations/index.js';
import { getDefaultOrganizationId } from '../config/database.js';
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
 * @param {Object} user - User object from auth (must have email, organizationId)
 * @returns {Promise<boolean>}
 */
export async function resolveDesignerCapability(user) {
  if (!user?.email) return false;

  if (!isMultiWorkspaceEnabled() && user.isAdmin) return true;

  const orgId = user.organizationId || getDefaultOrganizationId();

  try {
    // Look up membership
    const membership = await getMembershipByEmail(user.email, orgId);
    if (!membership) return false;

    // Look up org settings for adminsAreDesigners config
    const org = await getOrganizationById(orgId);
    const orgSettings = getOrgSettings(org);

    return hasDesignerCapability(membership, orgSettings);
  } catch {
    return false;
  }
}
