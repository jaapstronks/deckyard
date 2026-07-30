/**
 * Organization member actions — reads and mutations (organization UI, slices 3-4).
 *
 * Every mutation goes through `mutateMember()`, which exists for one reason:
 * the refusals. The API enforces rules the list cannot fully predict (an admin
 * may not touch another admin, the owner may not leave, your own role may have
 * changed since the page loaded), and a refusal is a normal outcome here, not a
 * failure. So a 401/403 gets the server's own sentence and a reload of the
 * list, rather than a generic "something went wrong" on top of a stale screen.
 */

import { api } from '../../../lib/api.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';

/** How many members one page holds. The server clamps `limit` to 100. */
export const MEMBERS_PAGE_SIZE = 25;

/**
 * Load one page of members.
 *
 * @param {string} organizationId - The organization to read.
 * @param {Object} [options]
 * @param {number} [options.offset=0] - Where the page starts.
 * @param {number} [options.limit=MEMBERS_PAGE_SIZE] - Page size.
 * @returns {Promise<{ members: Array<Object>, total: number, offset: number }>}
 */
export async function fetchMembers(organizationId, options = {}) {
  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Math.max(1, Number(options.limit) || MEMBERS_PAGE_SIZE);
  const query = `limit=${limit}&offset=${offset}`;
  const res = await api(
    `/api/organizations/${encodeURIComponent(organizationId)}/members?${query}`
  );
  const members = Array.isArray(res?.members) ? res.members : [];
  // `total` counts the whole organization, not this page — the panel uses the
  // difference to place the reader and to decide whether paging is possible.
  const total = Number.isFinite(res?.total) ? res.total : members.length;
  return { members, total, offset };
}

/**
 * Run a member mutation and report it, refusals included.
 *
 * @param {Object} options
 * @param {Function} options.run - Performs the request.
 * @param {string} options.success - Toast text on success.
 * @param {string} options.failure - Toast text for a failure with no message.
 * @returns {Promise<boolean>} Whether the mutation went through.
 */
async function mutateMember({ run, success, failure }) {
  try {
    await run();
    toast.success(success);
    return true;
  } catch (err) {
    const status = err?.statusCode;
    if (status === 401 || status === 403) {
      // The server's sentence is more specific than anything this module could
      // reconstruct ("Admins cannot remove other admins or owners", "Owner must
      // transfer ownership before leaving"), so show it and prefix only the
      // fact that it is a refusal.
      toast.error(
        t('organization.members.notAllowed', 'Not allowed: {reason}', {
          reason: err?.message || t('organization.members.notAllowedGeneric', 'you do not have permission for this.'),
        })
      );
    } else if (status === 404) {
      toast.error(
        t('organization.members.gone', 'That member is no longer in this organization.')
      );
    } else {
      toast.error(err?.message || failure);
    }
    return false;
  }
}

/**
 * Change a member's role within the organization.
 *
 * @param {Object} options
 * @param {string} options.organizationId - Organization ID.
 * @param {Object} options.member - Member to change.
 * @param {string} options.role - New role (`member` or `admin`).
 * @returns {Promise<boolean>} Whether the change went through.
 */
export function changeMemberRole({ organizationId, member, role }) {
  return mutateMember({
    run: () =>
      api(
        `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(member.membershipId)}`,
        { method: 'PATCH', body: { role } }
      ),
    success: t('organization.members.roleChanged', 'Role updated.'),
    failure: t('organization.members.roleChangeFailed', 'Could not update the role.'),
  });
}

/**
 * Hand the organization over to another member. The current owner becomes an
 * admin, so the caller reloads afterwards: their own gates just changed.
 *
 * @param {Object} options
 * @param {string} options.organizationId - Organization ID.
 * @param {Object} options.member - Member to promote to owner.
 * @returns {Promise<boolean>} Whether the transfer went through.
 */
export function transferOwnership({ organizationId, member }) {
  return mutateMember({
    run: () =>
      api(
        `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(member.membershipId)}`,
        { method: 'PATCH', body: { role: 'owner' } }
      ),
    success: t('organization.members.ownershipTransferred', 'Ownership transferred.'),
    failure: t('organization.members.ownershipTransferFailed', 'Could not transfer ownership.'),
  });
}

/**
 * Remove a member from the organization, or leave it yourself.
 *
 * @param {Object} options
 * @param {string} options.organizationId - Organization ID.
 * @param {Object} options.member - Member to remove.
 * @param {boolean} [options.self=false] - Whether this is the viewer leaving.
 * @returns {Promise<boolean>} Whether the removal went through.
 */
export function removeMember({ organizationId, member, self = false }) {
  return mutateMember({
    run: () =>
      api(
        `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(member.membershipId)}`,
        { method: 'DELETE' }
      ),
    success: self
      ? t('organization.members.left', 'You have left the organization.')
      : t('organization.members.removed', 'Member removed.'),
    failure: self
      ? t('organization.members.leaveFailed', 'Could not leave the organization.')
      : t('organization.members.removeFailed', 'Could not remove the member.'),
  });
}
