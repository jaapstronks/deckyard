/**
 * Context utilities for request handling.
 * Shared across server modules to avoid code duplication.
 *
 * The organization a request acts in comes from the session, never from the
 * hostname. That is deliberate: a hostname identifies an *instance*, while an
 * organization is a dimension *within* an instance, so deriving one from the
 * other conflates two things that are free to differ. An instance reachable at
 * its own hostname (`slides.example.com`) is deploy configuration — DNS, a
 * reverse proxy, `BASE_URL` — and needs nothing from this module.
 */

import { getDefaultOrganizationId } from '../config/database.js';
import { getClientIp } from './rate-limit.js';

// Re-export getClientIp for backward compatibility with existing imports
export { getClientIp };

/**
 * Get the organization ID a context acts in.
 *
 * There is no fallback: a context without an organization is a bug at the
 * call site, not something to paper over with the default organization. A
 * request-backed context gets its organization from {@link createRouteContext}
 * (which resolves it from the verified session); an entry point with no request
 * gets one from `singleWorkspaceScope()` (server/storage/scope.js), which is
 * exact on a single-workspace instance and refuses to guess on one that holds
 * several. Falling back here would hand an unfiltered query the default
 * organization — the same tenant-isolation leak `storage/scope.js` exists to
 * prevent, in another guise — so this throws in the same shape instead.
 *
 * @param {Object} ctx - Context object carrying an organizationId
 * @returns {string} - Organization ID
 * @throws {Error} When the context carries no organization.
 */
export function getOrgId(ctx) {
  if (!ctx?.organizationId) {
    throw new Error(
      'getOrgId was called with a context that has no organization to act in. ' +
        'Build it through createRouteContext (a request) or singleWorkspaceScope ' +
        '(an entry point without a request) rather than falling back to the default organization.'
    );
  }
  return ctx.organizationId;
}

/**
 * Create a route context object from an authenticated user.
 *
 * The organization on this context is what every storage query scopes on
 * (`getOrgId(ctx)` → `.where('organization_id', '=', orgId)`), so this is the
 * request-to-organization binding: it decides which workspace a request acts
 * in. It takes the organization the session is *already resolved* to rather
 * than defaulting to the instance's single organization.
 *
 * Two things keep that safe:
 *
 *   1. `authedUser.organizationId` is not the raw `orgId` claim from the
 *      cookie. `getUserFromRequestAsync` runs it through
 *      `resolveActiveOrganization()` (server/storage/identity.js), which
 *      re-verifies membership per request — a token outlives a revocation by
 *      up to 14 days — and refuses the request outright when the person holds
 *      no membership at all.
 *   2. The synchronous {@link getUserFromRequest} deliberately does NOT do that
 *      verification; it copies `payload.orgId` through unchecked and marks
 *      itself with `_needsDbValidation`. Such a user is ignored here, so the
 *      only organization that can reach a query is a membership-verified one.
 *
 * Single-workspace installations are unaffected: `resolveActiveOrganization()`
 * answers from configuration there without touching the database, so
 * `authedUser.organizationId` *is* the default organization and this resolves
 * to exactly the value it did before, at the same query cost.
 *
 * The context doubles as a storage scope (see server/storage/scope.js), so it
 * also carries the repository root when the caller has one. That is what lets
 * the presentations facade take a single "where and on whose behalf" object
 * instead of a bare `repoRoot` string plus an organization it invents itself.
 *
 * @param {Object} authedUser - The authenticated user object
 * @param {Object} [options] - Additional options
 * @param {string} [options.organizationId] - Override organization ID
 * @param {string|null} [options.repoRoot] - Repository root, for the file-backed fallback
 * @returns {Object} - Context object with organizationId, actorEmail and repoRoot
 */
export function createRouteContext(authedUser, options = {}) {
  // Allow explicit override of organizationId (for multi-workspace)
  const sessionOrganizationId = authedUser?._needsDbValidation
    ? null
    : authedUser?.organizationId;

  const organizationId =
    options.organizationId || sessionOrganizationId || getDefaultOrganizationId();

  return {
    organizationId,
    actorEmail: authedUser?.email,
    repoRoot: options.repoRoot ?? null,
  };
}

