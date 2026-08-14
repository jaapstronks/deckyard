/**
 * Follow-code routes (A7.19 C8 — ROUTES table).
 *
 * Split around the auth gate in `routes/api/index.js`: the public mount lets
 * only `GET /api/follow-codes/:code` through (via the pre-gate regex there,
 * with `authedUser: null`); everything else reaches this module through the
 * authed mount. The create handler additionally requires a session itself —
 * minting codes is never anonymous.
 *
 * Form B (route-dispatch.md): the old chain answered **405 with
 * `Allow: GET, POST`** for any other path or method under the
 * `/api/follow-codes` prefix, so the table ends in an explicit catch-all row.
 * Table order mirrors the old branch order exactly.
 */

import { createFollowCode, resolveFollowCode } from '../../storage/follow-codes.js';
import { crossOrganizationScope } from '../../storage/scope.js';
import { badRequest, methodNotAllowed, requireJsonBody, serveJson, serverError, unauthorized, rateLimited, withErrorHandler } from '../../utils/http.js';
import { getClientIp } from '../../utils/context.js';
import { allowRequest } from '../../utils/rate-limit.js';
import { FOLLOW_CODE_LIMITS } from '../../config/rate-limits.js';
import { dispatchRoutes } from '../../utils/router.js';
import { createLogger } from '../../utils/logger.js';
import { getString } from '../../utils/request-validators.js';
const log = createLogger('follow-codes');

/**
 * POST /api/follow-codes - Mint a short letter code for a follow URL.
 * Requires authentication to prevent abuse.
 */
async function handleFollowCodeCreate({ storageScope, req, res, authedUser }) {
  // Require authentication
  if (!authedUser?.email) {
    return unauthorized(res, 'Authentication required');
  }

  // Rate limit by IP
  const clientIp = getClientIp(req) || 'unknown';
  if (!(await allowRequest(`follow-codes:create:${clientIp}`, FOLLOW_CODE_LIMITS.create))) {
    rateLimited(res, 3600, 'Too many requests. Please try again later.');
    return true;
  }

  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;

  const body = parsed.body || {};
  const followUrl = getString(body, 'followUrl');

  if (!followUrl.trim()) {
    badRequest(res, 'followUrl is required');
    return true;
  }

  // Validate that it's a follow URL
  if (!followUrl.startsWith('/follow/')) {
    badRequest(res, 'Invalid follow URL format');
    return true;
  }

  // An unexpected throw here is infrastructure failing, not the caller's
  // request: it falls through to the withErrorHandler wrapper as a 500.
  const code = await createFollowCode(storageScope, followUrl.trim());
  if (!code) {
    // Codes live in Postgres; without it there is nothing to hand out.
    serverError(res, 'Follow codes are unavailable');
    return true;
  }
  serveJson(res, 200, { code });
  return true;
}

/**
 * GET /api/follow-codes/:code - Resolve a short letter code to a follow URL.
 */
async function handleFollowCodeResolve({ repoRoot, req, res }, codeParam) {
  // Rate limit resolution to prevent brute-force enumeration
  const clientIp = getClientIp(req) || 'unknown';
  if (!(await allowRequest(`follow-codes:resolve:${clientIp}`, FOLLOW_CODE_LIMITS.resolve))) {
    rateLimited(res, 3600, 'Too many requests. Please try again later.');
    return true;
  }

  const code = codeParam.toUpperCase();
  log.info(`[Follow Codes] Resolving code: ${code}`);

  // An unexpected throw here is infrastructure failing, not the caller's
  // request: it falls through to the withErrorHandler wrapper as a 500.
  const followUrl = await resolveFollowCode(
    crossOrganizationScope(repoRoot, 'follow code resolve: the typed code is the authorization'),
    code
  );

  if (!followUrl) {
    log.info(`[Follow Codes] Code not found: ${code}`);
    badRequest(res, 'Code not found or expired');
    return true;
  }

  log.info(`[Follow Codes] Resolved ${code} -> ${followUrl}`);
  serveJson(res, 200, { followUrl });
  return true;
}

/**
 * The code-resolve pattern. The length range stays tolerant ({4,6}) so codes
 * minted before a length change still resolve during rollout; the exact
 * length is set in storage/follow-codes.js.
 */
const RESOLVE_PATTERN = /^\/api\/follow-codes\/([A-Z]{4,6})$/i;

/**
 * Follow-code routes in the old chain's exact order, closed by the Form B
 * catch-all: any other method on the bare path or anything under
 * `/api/follow-codes/` answers 405 with `Allow: GET, POST`, as the old
 * trailing `startsWith` branch did. One deliberate narrowing: the old branch
 * also caught prefix-typo paths like `/api/follow-codesfoo` (an accidental
 * 405); those now fall through and 404 at the root, like every other module
 * whose entry guard is a bare `startsWith` prefilter.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'POST', pattern: '/api/follow-codes', handler: handleFollowCodeCreate },
  { method: 'GET', pattern: RESOLVE_PATTERN, handler: handleFollowCodeResolve },
  { pattern: /^\/api\/follow-codes(?:\/.*)?$/, handler: (ctx) => methodNotAllowed(ctx.res, ['GET', 'POST']) },
];

/**
 * The pre-gate surface: exactly the anonymous code-resolve read, nothing
 * else. Which follow-code reads skip the login gate is decided by this
 * table — an explicit, reviewable row — not by a regex inside the root
 * dispatcher (route-dispatch.md § the closing gate). `routes/api/index.js`
 * mounts this before the auth gate with `authedUser: null`; minting and the
 * 405 surface stay behind the gate in {@link ROUTES}.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const PUBLIC_ROUTES = [
  { method: 'GET', pattern: RESOLVE_PATTERN, handler: handleFollowCodeResolve },
];

/**
 * Handle the anonymous (pre-gate) follow-code reads.
 * @param {import('../../utils/context.js').PublicContext & { authedUser: null }} ctx
 */
export const handleFollowCodesPublic = withErrorHandler('follow-codes', (ctx) =>
  dispatchRoutes(PUBLIC_ROUTES, ctx)
);

/**
 * Handle follow-code endpoints.
 * @param {import('../../utils/context.js').AuthedContext
 *   | import('../../utils/context.js').PublicContext} ctx - Authed on the
 *   post-gate mount; public (with `authedUser: null`) on the pre-gate
 *   resolve-only mount.
 */
export const handleFollowCodes = withErrorHandler('follow-codes', (ctx) => {
  if (!ctx.url.pathname.startsWith('/api/follow-codes')) return false;
  log.info(`[Follow Codes] Handler called: ${ctx.req.method} ${ctx.url.pathname}`);
  return dispatchRoutes(ROUTES, ctx);
});
