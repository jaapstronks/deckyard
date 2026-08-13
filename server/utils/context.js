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
import { isMultiOrgEnabled } from '../config/features.js';
import { getClientIp } from './rate-limit.js';

// Re-export getClientIp for backward compatibility with existing imports
export { getClientIp };

/**
 * The request context handed to a route handler mounted **before** the
 * authentication gate in `routes/api/index.js` (login, password reset, magic
 * link, SSO, and the public follow/share/analytics endpoints). There is no
 * resolved user and no storage scope yet: the gate has not run.
 *
 * @typedef {object} PublicContext
 * @property {string} repoRoot
 * @property {import('http').IncomingMessage} req
 * @property {import('http').ServerResponse} res
 * @property {URL} url
 */

/**
 * The request context handed to a route handler mounted **after** the
 * authentication gate. It adds the two things the gate produces once, in
 * `routes/api/index.js`: the storage scope every query runs under, and the
 * resolved, capability-enriched user.
 *
 * The rule that goes with this shape (A7.19 C8, decision B3b): **a handler
 * mounted after the auth gate receives an `AuthedContext` and never calls
 * `getUserFromRequestAsync` itself** — the user and scope are already resolved,
 * and re-resolving them drops the enrichment and costs an extra round-trip.
 *
 * @typedef {PublicContext & {
 *   storageScope: object,
 *   authedUser: object|null,
 * }} AuthedContext
 */

/**
 * Get the organization ID a context acts in.
 *
 * There is no fallback: a context without an organization is a bug at the
 * call site, not something to paper over with the default organization. A
 * request-backed context gets its organization from {@link createStorageScope}
 * (which resolves it from the verified session); an entry point with no request
 * gets one from `singleOrganizationScope()` (server/storage/scope.js), which is
 * exact on a single-organization instance and refuses to guess on one that holds
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
        'Build it through createStorageScope (a request) or singleOrganizationScope ' +
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
 * request-to-organization binding: it decides which organization a request acts
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
 * Single-organization installations are unaffected: `resolveActiveOrganization()`
 * answers from configuration there without touching the database, so
 * `authedUser.organizationId` *is* the default organization and this resolves
 * to exactly the value it did before, at the same query cost.
 *
 * The last resort is {@link fallbackOrganizationId}, and it depends on whether
 * anyone is authenticated — see there.
 *
 * The context doubles as a storage scope (see server/storage/scope.js), so it
 * also carries the repository root when the caller has one. That is what lets
 * the presentations facade take a single "where and on whose behalf" object
 * instead of a bare `repoRoot` string plus an organization it invents itself.
 *
 * @param {Object} authedUser - The authenticated user object
 * @param {Object} [options] - Additional options
 * @param {string} [options.organizationId] - Override organization ID
 * @param {string|null} [options.repoRoot] - Repository root: the disk path for uploads, thumbnails and theme files
 * @returns {Object} - Context object with organizationId, actorEmail and repoRoot
 */
export function createStorageScope(authedUser, options = {}) {
  // Allow explicit override of organizationId (for multi-organization)
  const sessionOrganizationId = authedUser?._needsDbValidation
    ? null
    : authedUser?.organizationId;

  const organizationId =
    options.organizationId || sessionOrganizationId || fallbackOrganizationId(authedUser);

  return {
    organizationId,
    actorEmail: authedUser?.email,
    repoRoot: options.repoRoot ?? null,
  };
}

/**
 * The organization for a context that could name none — deliberately not the
 * same answer for a request with a person behind it and one without.
 *
 * **Nobody authenticated → the default organization.** These are the pre-auth
 * and system routes (login, password reset, magic link, SSO), which run before
 * there is a session to resolve an organization from. They pass `null`
 * explicitly, so this is a stated absence, not a lost value.
 *
 * **Someone authenticated but with no verified organization → nothing, once an
 * instance holds more than one organization.** The only user shape that reaches
 * here is one whose organization was deliberately discarded above (the
 * unverified synchronous path). Handing that request the *default* organization
 * would let a session act in an organization it was never resolved to — the L10
 * finding of the 2026-07 security audit. Under multi-organization it therefore
 * gets no organization at all, and `getOrgId()` refuses the query rather than
 * guessing; the request fails instead of reading someone else's organization.
 *
 * Single-organization installations keep the default in both branches, and are
 * unaffected: there is exactly one organization, so it is not a guess.
 *
 * @param {Object} [authedUser] - The authenticated user, if any
 * @returns {string|null}
 */
function fallbackOrganizationId(authedUser) {
  if (!authedUser) return getDefaultOrganizationId();
  return isMultiOrgEnabled() ? null : getDefaultOrganizationId();
}

