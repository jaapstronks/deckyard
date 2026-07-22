/**
 * Storage layer for user-organization relationships.
 *
 * Facade that preserves the historical import surface. The implementation is
 * split by domain:
 * - `user-organizations/memberships.js`: workspace roles, designer capability,
 *   and membership CRUD (add/remove/list members, roles, ownership transfer).
 * - `user-organizations/organizations.js`: organization (workspace) CRUD.
 */

export {
  WORKSPACE_ROLES,
  hasWorkspaceRole,
  hasDesignerCapability,
  updateMemberDesigner,
  getMembership,
  getMembershipByEmail,
  listUserOrganizations,
  listOrganizationMembers,
  countOrganizationMembers,
  addMember,
  updateMemberRole,
  removeMember,
  transferOwnership,
} from './user-organizations/memberships.js';

export {
  getOrganizationById,
  getOrganizationBySubdomain,
  getOrganizationByCustomDomain,
  createOrganization,
  updateOrganization,
  deleteOrganization,
} from './user-organizations/organizations.js';
