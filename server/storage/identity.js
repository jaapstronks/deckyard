/**
 * Identity resolution.
 *
 * Answers two questions that the rest of the storage layer deliberately does
 * not mix:
 *
 *   1. **Who is this?** `users.email` is globally unique (migration 001), so a
 *      person exists exactly once on an instance. Resolving them must NOT be
 *      filtered by organization: you are who you are regardless of which
 *      workspace you are currently looking at.
 *   2. **Which organization are they working in right now?** That comes from
 *      the session, verified against `user_organizations` membership — not
 *      from `users.organization_id`.
 *
 * `users.organization_id` is retained as the home organization a person lands
 * in when their session carries no workspace, and as the organization new rows
 * are created in. It is no longer the authority on where a person may work;
 * membership is. See docs/plans/briefs/finish-organizations.md (phase 0).
 */

import { normalizeEmail } from '../utils/normalize.js';
import { withDbGuard } from './utils/db-guard.js';
import { isMultiWorkspaceEnabled } from '../config/features.js';
import { getDefaultOrganizationId } from '../config/database.js';
import { listUserOrganizations } from './user-organizations/index.js';

/**
 * Look up a person by email, across all organizations.
 *
 * This is the lookup every authentication path must use. Filtering it by
 * organization is what previously made a user who had switched workspaces (or
 * whose home organization was not the default one) resolve to null and get a
 * 401 on every request.
 *
 * @param {string} email - The person's email address
 * @returns {Promise<Object|null>} - Raw `users` row, or null
 */
export async function getUserByEmailGlobal(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  return withDbGuard(null, async (db) => {
    const row = await db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', normalized)
      .executeTakeFirst();

    return row || null;
  });
}

/**
 * Resolve which organization a session is allowed to act in.
 *
 * In single-workspace mode this is a pure function of configuration: the
 * default organization, with no database access at all, so the behaviour and
 * the query count of every existing installation are unchanged.
 *
 * In multi-workspace mode the organization the session asks for is only
 * honoured when the person still holds a membership for it. Memberships can be
 * revoked while a session token lives on (14 days by default,
 * auth/auth.js:406), so this is re-verified per request rather than trusted
 * from the token. When the requested organization is gone, the person falls
 * back to their oldest remaining membership instead of being logged out
 * entirely or silently dropped into the default organization.
 *
 * @param {string} userId - `users.id` of the resolved person
 * @param {string} [requestedOrganizationId] - Organization from the session
 * @returns {Promise<string|null>} - Organization to act in, or null when the
 *   person holds no membership at all (the caller must refuse the request)
 */
export async function resolveActiveOrganization(userId, requestedOrganizationId) {
  if (!isMultiWorkspaceEnabled()) return getDefaultOrganizationId();
  if (!userId) return null;

  // Ordered by joined_at ascending, so the fallback is deterministic.
  const memberships = await listUserOrganizations(userId);
  if (!memberships.length) return null;

  if (requestedOrganizationId && memberships.some((org) => org.id === requestedOrganizationId)) {
    return requestedOrganizationId;
  }

  return memberships[0].id;
}
