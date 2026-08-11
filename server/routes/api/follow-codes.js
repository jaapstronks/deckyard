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
import { badRequest, methodNotAllowed, requireJsonBody, serveJson, serverError, unauthorized, rateLimited } from '../../utils/http.js';
import { getClientIp } from '../../utils/context.js';
import { dispatchRoutes } from '../../utils/router.js';
import { createLogger } from '../../utils/logger.js';
import { getString } from '../../utils/request-validators.js';
const log = createLogger('follow-codes');

// ============================================================
// RATE LIMITING
// In-memory rate limiting for follow codes
// ============================================================

const RATE_LIMIT_CREATE_PER_IP = 10; // per hour
const RATE_LIMIT_RESOLVE_PER_IP = 60; // per hour
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Map of IP -> { count, resetAt }
const createRateLimits = new Map();
const resolveRateLimits = new Map();

/**
 * Check and update rate limit for an IP address.
 * @param {Map} limitMap - The rate limit map
 * @param {string} ip - Client IP address
 * @param {number} maxRequests - Maximum requests per window
 * @returns {boolean} - True if rate limited
 */
function checkRateLimit(limitMap, ip, maxRequests) {
  const now = Date.now();
  const entry = limitMap.get(ip);

  // Clean up expired entries periodically
  if (limitMap.size > 10000) {
    for (const [key, val] of limitMap) {
      if (val.resetAt < now) limitMap.delete(key);
    }
  }

  if (!entry || entry.resetAt < now) {
    // New window
    limitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (entry.count >= maxRequests) {
    return true;
  }

  entry.count++;
  return false;
}

/**
 * POST /api/follow-codes - Mint a short letter code for a follow URL.
 * Requires authentication to prevent abuse.
 */
async function handleFollowCodeCreate({ repoRoot, req, res, authedUser }) {
  // Require authentication
  if (!authedUser?.email) {
    return unauthorized(res, 'Authentication required');
  }

  // Rate limit by IP
  const clientIp = getClientIp(req) || 'unknown';
  if (checkRateLimit(createRateLimits, clientIp, RATE_LIMIT_CREATE_PER_IP)) {
    rateLimited(res, 3600, 'Too many requests. Please try again later.');
    return true;
  }

  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;

  try {
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

    const code = await createFollowCode(repoRoot, followUrl.trim());
    if (!code) {
      // Codes live in Postgres; without it there is nothing to hand out.
      serverError(res, 'Follow codes are unavailable');
      return true;
    }
    serveJson(res, 200, { code });
    return true;
  } catch (error) {
    badRequest(res, `Failed to create code: ${error.message}`);
    return true;
  }
}

/**
 * GET /api/follow-codes/:code - Resolve a short letter code to a follow URL.
 */
async function handleFollowCodeResolve({ repoRoot, req, res }, codeParam) {
  // Rate limit resolution to prevent brute-force enumeration
  const clientIp = getClientIp(req) || 'unknown';
  if (checkRateLimit(resolveRateLimits, clientIp, RATE_LIMIT_RESOLVE_PER_IP)) {
    rateLimited(res, 3600, 'Too many requests. Please try again later.');
    return true;
  }

  const code = codeParam.toUpperCase();
  log.info(`[Follow Codes] Resolving code: ${code}`);

  try {
    const followUrl = await resolveFollowCode(repoRoot, code);

    if (!followUrl) {
      log.info(`[Follow Codes] Code not found: ${code}`);
      badRequest(res, 'Code not found or expired');
      return true;
    }

    log.info(`[Follow Codes] Resolved ${code} -> ${followUrl}`);
    serveJson(res, 200, { followUrl });
    return true;
  } catch (error) {
    log.error(`[Follow Codes] Error resolving ${code}:`, error);
    badRequest(res, `Failed to resolve code: ${error.message}`);
    return true;
  }
}

/**
 * Follow-code routes in the old chain's exact order, closed by the Form B
 * catch-all: any other path or method under the prefix answers 405 with
 * `Allow: GET, POST`, exactly as the old trailing `startsWith` branch did.
 *
 * The resolve pattern's length range stays tolerant ({4,6}) so codes minted
 * before a length change still resolve during rollout; the exact length is
 * set in storage/follow-codes.js.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'POST', pattern: '/api/follow-codes', handler: handleFollowCodeCreate },
  { method: 'GET', pattern: /^\/api\/follow-codes\/([A-Z]{4,6})$/i, handler: handleFollowCodeResolve },
  { pattern: /^\/api\/follow-codes(?:\/.*)?$/, handler: (ctx) => methodNotAllowed(ctx.res, ['GET', 'POST']) },
];

/**
 * Handle follow-code endpoints.
 * @param {import('../../utils/context.js').AuthedContext
 *   | import('../../utils/context.js').PublicContext} ctx - Authed on the
 *   post-gate mount; public (with `authedUser: null`) on the pre-gate
 *   resolve-only mount.
 */
export async function handleFollowCodes(ctx) {
  if (!ctx.url.pathname.startsWith('/api/follow-codes')) return false;
  log.info(`[Follow Codes] Handler called: ${ctx.req.method} ${ctx.url.pathname}`);
  return dispatchRoutes(ROUTES, ctx);
}
