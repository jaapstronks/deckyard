/**
 * Storage layer for user-organization relationships.
 *
 * Facade that preserves the historical import surface. The implementation is
 * split by domain:
 * - `user-organizations/memberships.js`: organization roles, designer capability,
 *   and membership CRUD (add/remove/list members, roles, ownership transfer).
 * - `user-organizations/organizations.js`: organization CRUD.
 */

export {
  WORKSPACE_ROLES,
  hasOrganizationRole,
  hasDesignerCapability,
  updateMemberDesigner,
  getMembership,
  getMembershipByEmail,
  listUserOrganizations,
  listOrganizationMembers,
  getOrganizationMember,
  countOrganizationMembers,
  addMember,
  updateMemberRole,
  removeMember,
  transferOwnership,
} from './memberships.js';

export {
  getOrganizationById,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  isDefaultOrganization,
} from './organizations.js';
