/**
 * What the signed-in person may do to the organization itself
 * (organization UI, slice 6).
 *
 * Same rule as `organization-members/permissions.js`: these mirror the guards
 * in `server/routes/api/organizations.js`, they are not a second source of
 * truth. The server decides and every action handles its refusal; what the
 * mirror buys is that a control certain to be refused is never drawn.
 *
 * The three levels the route draws are exactly the three this screen has:
 *
 *   - **any member** may `GET` the organization → the profile is readable
 *   - **admin or owner** may `PATCH` it → the fields are editable
 *   - **the owner** may `DELETE` it → the danger zone exists
 */

import { hasOrganizationRole } from '../../../../shared/organization-role.js';
import { getOrganizationRole } from '../../../lib/user/organization-role.js';

/**
 * Whether the viewer may change the organization's profile fields.
 *
 * Mirrors `hasOrganizationRole(membership.role, 'admin')` on `PATCH
 * /api/organizations/:id`. A plain member gets the same card with its fields
 * read-only rather than a screen that refuses on save.
 *
 * @param {Object} [currentUser] - User from `/api/auth/me`
 * @returns {boolean}
 */
export function canEditProfile(currentUser) {
  return hasOrganizationRole(getOrganizationRole(currentUser), 'admin');
}

/**
 * Whether the viewer owns the organization.
 *
 * Drives whether the owner-only section exists at all, separately from whether
 * the Delete button inside it does — the owner of the default organization
 * still needs to be told why they cannot delete it.
 *
 * @param {Object} [currentUser] - User from `/api/auth/me`
 * @returns {boolean}
 */
export function isOrganizationOwner(currentUser) {
  return getOrganizationRole(currentUser) === 'owner';
}

/**
 * Whether the viewer may delete the organization.
 *
 * Owner-only on the route, and the route additionally refuses the default
 * organization — the workspace every single-workspace path falls back to. That
 * second half is why `GET /api/organizations/:id` carries `isDefault`: without
 * it the owner of the default organization would be offered a button that can
 * only ever fail.
 *
 * @param {Object} [currentUser] - User from `/api/auth/me`
 * @param {Object} [organization] - Organization from `GET /api/organizations/:id`
 * @returns {boolean}
 */
export function canDeleteOrganization(currentUser, organization) {
  if (!isOrganizationOwner(currentUser)) return false;
  return organization?.isDefault !== true;
}
