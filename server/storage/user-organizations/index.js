/**
 * Storage layer for user-organization relationships.
 *
 * Facade that preserves the historical import surface. The implementation is
 * split by domain:
 * - `user-organizations/memberships.js`: designer capability and membership
 *   CRUD (add/remove/list members, roles, ownership transfer). The role ladder
 *   itself is not storage — it lives in `shared/organization-role.js`, which
 *   client and server both import.
 * - `user-organizations/organizations.js`: organization CRUD.
 */

export {
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
