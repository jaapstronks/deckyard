/**
 * Organization member actions — the read side (organization UI, slice 3).
 *
 * Mutations (role changes, removal, leaving, ownership transfer) land in
 * slice 4; this module deliberately only reads.
 */

import { api } from '../../../lib/api.js';

/** How many members one request asks for. The server clamps `limit` to 100. */
export const MEMBERS_PAGE_SIZE = 100;

/**
 * Load the members of an organization.
 *
 * @param {string} organizationId - The organization to read.
 * @returns {Promise<{ members: Array<Object>, total: number }>}
 */
export async function fetchMembers(organizationId) {
  const res = await api(
    `/api/organizations/${encodeURIComponent(organizationId)}/members?limit=${MEMBERS_PAGE_SIZE}`
  );
  const members = Array.isArray(res?.members) ? res.members : [];
  // `total` is the count of the whole organization, not of this page — the
  // panel uses the difference to say out loud that the list is truncated.
  const total = Number.isFinite(res?.total) ? res.total : members.length;
  return { members, total };
}
