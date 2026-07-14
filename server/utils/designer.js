/**
 * Designer capability utilities.
 * Resolves whether a user has designer capability based on their
 * membership flags, role, and organization settings.
 */

import { getMembershipByEmail, hasDesignerCapability } from '../storage/user-organizations.js';
import { getOrganizationById } from '../storage/user-organizations.js';
import { getDefaultOrganizationId } from '../config/database.js';
import { getOrgSettings } from './org-settings.js';

/**
 * Resolve whether a user has designer capability.
 * Looks up the user's membership and org settings to determine capability.
 *
 * For non-database modes (auth disabled, dev bypass, sandbox), admins get designer capability.
 *
 * @param {Object} user - User object from auth (must have email, organizationId)
 * @returns {Promise<boolean>}
 */
export async function resolveDesignerCapability(user) {
  if (!user?.email) return false;

  // Admins always get designer capability in single-user / non-DB modes
  if (user.isAdmin) return true;

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
