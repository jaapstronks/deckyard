/**
 * Storage layer for user-organization membership management.
 * Handles multi-workspace user membership and role operations.
 */

import { nowIso, normalizeEmail } from '../../utils/normalize.js';
import { withDbGuard } from '../utils/db-guard.js';

// ============================================================
// WORKSPACE-LEVEL ROLES
// ============================================================

/**
 * Workspace roles in order of increasing privileges.
 * - member: Regular user, can view and edit content
 * - admin: Can manage members and workspace settings
 * - owner: Billing contact, full control, can delete workspace
 */
export const WORKSPACE_ROLES = ['member', 'admin', 'owner'];

/**
 * Check if a role has at least the specified permission level.
 * @param {string} userRole - User's role
 * @param {string} requiredRole - Required minimum role
 * @returns {boolean}
 */
export function hasWorkspaceRole(userRole, requiredRole) {
  const userLevel = WORKSPACE_ROLES.indexOf(userRole);
  const requiredLevel = WORKSPACE_ROLES.indexOf(requiredRole);
  return userLevel >= 0 && requiredLevel >= 0 && userLevel >= requiredLevel;
}

// ============================================================
// DESIGNER CAPABILITY
// ============================================================

/**
 * Check if a user has designer capability in their organization.
 * Designer capability is granted when:
 * - User has is_designer = true on their membership, OR
 * - User is an owner (always has designer capability), OR
 * - User is an admin AND the org setting adminsAreDesigners is true (default)
 *
 * @param {Object} membership - Membership object (from getMembership/formatMembership)
 * @param {Object} [orgSettings] - Organization settings object
 * @returns {boolean}
 */
export function hasDesignerCapability(membership, orgSettings) {
  if (!membership) return false;

  // Owners always have designer capability
  if (membership.role === 'owner') return true;

  // Explicit designer flag
  if (membership.isDesigner) return true;

  // Admins inherit designer capability by default (configurable)
  if (membership.role === 'admin') {
    const settings = orgSettings && typeof orgSettings === 'object' ? orgSettings : {};
    // Default to true if not explicitly set to false
    return settings.adminsAreDesigners !== false;
  }

  return false;
}

/**
 * Update a member's designer flag.
 * @param {string} membershipId - Membership ID
 * @param {boolean} isDesigner - New designer flag value
 * @returns {Promise<Object>}
 */
export async function updateMemberDesigner(membershipId, isDesigner) {
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const now = nowIso();
    const row = await db
      .updateTable('user_organizations')
      .set({
        is_designer: Boolean(isDesigner),
        updated_at: now,
      })
      .where('id', '=', membershipId)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    return {
      ok: true,
      membership: formatMembership(row),
    };
  });
}

// ============================================================
// MEMBERSHIP CRUD
// ============================================================

/**
 * Get user's membership in a specific organization.
 * @param {string} userId - User ID
 * @param {string} organizationId - Organization ID
 * @returns {Promise<Object|null>}
 */
export async function getMembership(userId, organizationId) {
  return withDbGuard(null, async (db) => {
    const row = await db
      .selectFrom('user_organizations')
      .select([
        'id',
        'user_id',
        'organization_id',
        'role',
        'is_designer',
        'invited_by',
        'invited_at',
        'joined_at',
        'created_at',
        'updated_at',
      ])
      .where('user_id', '=', userId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    return row ? formatMembership(row) : null;
  });
}

/**
 * Get user's membership by email in a specific organization.
 * @param {string} email - User's email
 * @param {string} organizationId - Organization ID
 * @returns {Promise<Object|null>}
 */
export async function getMembershipByEmail(email, organizationId) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  return withDbGuard(null, async (db) => {
    const row = await db
      .selectFrom('user_organizations')
      .innerJoin('users', 'users.id', 'user_organizations.user_id')
      .select([
        'user_organizations.id',
        'user_organizations.user_id',
        'user_organizations.organization_id',
        'user_organizations.role',
        'user_organizations.is_designer',
        'user_organizations.invited_by',
        'user_organizations.invited_at',
        'user_organizations.joined_at',
        'user_organizations.created_at',
        'user_organizations.updated_at',
        'users.email',
        'users.name',
      ])
      .where('users.email', '=', normalized)
      .where('user_organizations.organization_id', '=', organizationId)
      .executeTakeFirst();

    return row ? formatMembershipWithUser(row) : null;
  });
}

/**
 * List all organizations a user belongs to.
 * @param {string} userId - User ID
 * @returns {Promise<Array>}
 */
export async function listUserOrganizations(userId) {
  return withDbGuard([], async (db) => {
    const rows = await db
      .selectFrom('user_organizations')
      .innerJoin('organizations', 'organizations.id', 'user_organizations.organization_id')
      .select([
        'user_organizations.id as membership_id',
        'user_organizations.role',
        'user_organizations.is_designer',
        'user_organizations.joined_at',
        'organizations.id',
        'organizations.name',
        'organizations.slug',
        'organizations.subdomain',
        'organizations.logo_url',
        'organizations.display_name',
        'organizations.created_at',
      ])
      .where('user_organizations.user_id', '=', userId)
      .orderBy('user_organizations.joined_at', 'asc')
      .execute();

    return rows.map(formatOrganizationWithMembership);
  });
}

/**
 * List all members of an organization.
 * @param {string} organizationId - Organization ID
 * @param {Object} options - Query options
 * @param {number} [options.limit=50] - Max results
 * @param {number} [options.offset=0] - Skip results
 * @returns {Promise<Array>}
 */
export async function listOrganizationMembers(organizationId, options = {}) {
  return withDbGuard([], async (db) => {
    const limit = Math.min(Math.max(1, options.limit || 50), 100);
    const offset = Math.max(0, options.offset || 0);

    const rows = await db
      .selectFrom('user_organizations')
      .innerJoin('users', 'users.id', 'user_organizations.user_id')
      .select([
        'user_organizations.id as membership_id',
        'user_organizations.role',
        'user_organizations.is_designer',
        'user_organizations.invited_at',
        'user_organizations.joined_at',
        'users.id',
        'users.email',
        'users.name',
        'users.created_at',
      ])
      .where('user_organizations.organization_id', '=', organizationId)
      .orderBy('user_organizations.role', 'desc') // owner first, then admin, then member
      .orderBy('user_organizations.joined_at', 'asc')
      .limit(limit)
      .offset(offset)
      .execute();

    return rows.map(formatMemberWithUser);
  });
}

/**
 * Count members in an organization.
 * @param {string} organizationId - Organization ID
 * @returns {Promise<number>}
 */
export async function countOrganizationMembers(organizationId) {
  return withDbGuard(0, async (db) => {
    const result = await db
      .selectFrom('user_organizations')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    return Number(result?.count || 0);
  });
}

/**
 * Add a user to an organization.
 * @param {Object} data - Membership data
 * @param {string} data.userId - User ID
 * @param {string} data.organizationId - Organization ID
 * @param {string} [data.role='member'] - Role in organization
 * @param {string} [data.invitedBy] - User ID who invited them
 * @returns {Promise<Object>}
 */
export async function addMember(data) {
  const role = WORKSPACE_ROLES.includes(data.role) ? data.role : 'member';

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    // Check if membership already exists
    const existing = await db
      .selectFrom('user_organizations')
      .select('id')
      .where('user_id', '=', data.userId)
      .where('organization_id', '=', data.organizationId)
      .executeTakeFirst();

    if (existing) {
      return { ok: false, reason: 'already_member' };
    }

    const now = nowIso();
    const row = await db
      .insertInto('user_organizations')
      .values({
        user_id: data.userId,
        organization_id: data.organizationId,
        role,
        invited_by: data.invitedBy || null,
        invited_at: data.invitedBy ? now : null,
        joined_at: now,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirst();

    return {
      ok: true,
      membership: formatMembership(row),
    };
  });
}

/**
 * Update a member's role in an organization.
 * @param {string} membershipId - Membership ID
 * @param {string} newRole - New role
 * @returns {Promise<Object>}
 */
export async function updateMemberRole(membershipId, newRole) {
  if (!WORKSPACE_ROLES.includes(newRole)) {
    return { ok: false, reason: 'invalid_role' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const now = nowIso();
    const row = await db
      .updateTable('user_organizations')
      .set({
        role: newRole,
        updated_at: now,
      })
      .where('id', '=', membershipId)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    return {
      ok: true,
      membership: formatMembership(row),
    };
  });
}

/**
 * Remove a member from an organization.
 * @param {string} membershipId - Membership ID
 * @returns {Promise<Object>}
 */
export async function removeMember(membershipId) {
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    // Get membership details first for validation
    const membership = await db
      .selectFrom('user_organizations')
      .select(['id', 'role', 'organization_id'])
      .where('id', '=', membershipId)
      .executeTakeFirst();

    if (!membership) {
      return { ok: false, reason: 'not_found' };
    }

    // Check if this is the only owner
    if (membership.role === 'owner') {
      const ownerCount = await db
        .selectFrom('user_organizations')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('organization_id', '=', membership.organization_id)
        .where('role', '=', 'owner')
        .executeTakeFirst();

      if (Number(ownerCount?.count || 0) <= 1) {
        return { ok: false, reason: 'last_owner' };
      }
    }

    await db
      .deleteFrom('user_organizations')
      .where('id', '=', membershipId)
      .execute();

    return { ok: true };
  });
}

/**
 * Transfer ownership of an organization to another member.
 * The current owner becomes an admin.
 * @param {string} organizationId - Organization ID
 * @param {string} currentOwnerUserId - Current owner's user ID
 * @param {string} newOwnerUserId - New owner's user ID
 * @returns {Promise<Object>}
 */
export async function transferOwnership(organizationId, currentOwnerUserId, newOwnerUserId) {
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const now = nowIso();

    // Verify current owner
    const currentOwnership = await db
      .selectFrom('user_organizations')
      .select(['id', 'role'])
      .where('user_id', '=', currentOwnerUserId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!currentOwnership || currentOwnership.role !== 'owner') {
      return { ok: false, reason: 'not_owner' };
    }

    // Verify new owner is a member
    const newOwnerMembership = await db
      .selectFrom('user_organizations')
      .select(['id', 'role'])
      .where('user_id', '=', newOwnerUserId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!newOwnerMembership) {
      return { ok: false, reason: 'not_member' };
    }

    // Demote current owner to admin
    await db
      .updateTable('user_organizations')
      .set({ role: 'admin', updated_at: now })
      .where('id', '=', currentOwnership.id)
      .execute();

    // Promote new owner
    await db
      .updateTable('user_organizations')
      .set({ role: 'owner', updated_at: now })
      .where('id', '=', newOwnerMembership.id)
      .execute();

    return { ok: true };
  });
}

// ============================================================
// HELPERS
// ============================================================

function formatMembership(row) {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    role: row.role,
    isDesigner: Boolean(row.is_designer),
    invitedBy: row.invited_by,
    invitedAt: row.invited_at,
    joinedAt: row.joined_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatMembershipWithUser(row) {
  return {
    ...formatMembership(row),
    email: row.email,
    name: row.name,
  };
}

function formatMemberWithUser(row) {
  return {
    membershipId: row.membership_id,
    role: row.role,
    isDesigner: Boolean(row.is_designer),
    invitedAt: row.invited_at,
    joinedAt: row.joined_at,
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.created_at,
    },
  };
}

function formatOrganizationWithMembership(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    subdomain: row.subdomain,
    logoUrl: row.logo_url,
    displayName: row.display_name,
    createdAt: row.created_at,
    membership: {
      id: row.membership_id,
      role: row.role,
      isDesigner: Boolean(row.is_designer),
      joinedAt: row.joined_at,
    },
  };
}
