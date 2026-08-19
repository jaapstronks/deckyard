/**
 * Storage scope for tests.
 *
 * The presentations facade takes a scope rather than a `repoRoot` string, and
 * refuses to invent an organization when the caller states none (see
 * server/storage/scope.js). A test *is* the session, so it declares the
 * organization it acts in — which for the file-backed suite is the instance
 * default, exactly as it was before scopes existed.
 *
 * Use {@link otherOrganizationScope} when a test needs to assert that work in
 * one organization stays invisible from another.
 */

import { getDefaultOrganizationId } from '../../server/config/database.js';

/**
 * A scope acting in the instance's default organization.
 * @param {string|null} [repoRoot] - Repository root for the file-backed fallback.
 * @param {Object} [extra] - Additional scope fields (e.g. actorEmail).
 * @returns {import('../../server/storage/scope.js').StorageScope}
 */
export function testScope(repoRoot = null, extra = {}) {
  return {
    repoRoot,
    ...extra,
    organizationId: getDefaultOrganizationId(),
  };
}

/**
 * A scope acting in some other organization, for isolation assertions.
 * @param {string|null} [repoRoot] - Repository root for the file-backed fallback.
 * @param {string} [organizationId] - The other organization's id.
 * @returns {import('../../server/storage/scope.js').StorageScope}
 */
export function otherOrganizationScope(
  repoRoot = null,
  organizationId = 'org-other',
) {
  return { repoRoot, organizationId };
}
