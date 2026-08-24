/**
 * Middleware for public API v1.
 * Handles API key authentication, rate limiting, and usage tracking.
 */

import {
  validateApiKey,
  TIER_LIMITS,
  hasPermission,
} from '../../../storage/api-keys.js';
import {
  normalizePresentationVisibility,
  canActorAccessPresentation,
  hasIdentity,
  isOwnerOrCreator,
} from '../../../utils/presentation-authz.js';
import { resolveIdentityByEmail } from '../../../storage/identity-resolver.js';
import {
  incrementUsage,
  getRateLimitHeaders,
  checkAiRateLimit,
  checkExportRateLimit,
} from '../../../storage/api-usage.js';
import { allowRequest } from '../../../utils/rate-limit.js';
import { apiTierBucket } from '../../../config/rate-limits.js';
import {
  serveJson,
  readRequestBody,
  isJsonObject,
} from '../../../utils/http.js';
import { codeForStatus, getStatusCode } from '../../../utils/errors.js';
import { logError } from '../../../utils/logger.js';
import { getPresentation } from '../../../storage/presentations/index.js';

// ============================================================
// API KEY AUTHENTICATION
// ============================================================

/**
 * Extract bearer token from Authorization header.
 * @param {Object} req - HTTP request
 * @returns {string|null} - The token or null
 */
function extractBearerToken(req) {
  const auth = req.headers?.authorization || '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  return auth.slice(7).trim();
}

/**
 * Authenticate a request using API key.
 * Sets ctx.apiKey with key data if valid.
 * @param {Object} ctx - Request context
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function authenticateApiKey(ctx) {
  const { req, res } = ctx;

  const token = extractBearerToken(req);
  if (!token) {
    sendV1Error(
      res,
      401,
      'Missing or invalid Authorization header. Use: Bearer <api_key>',
      {
        code: 'unauthorized',
      },
    );
    return { ok: false, reason: 'missing_auth' };
  }

  const result = await validateApiKey(token);
  if (!result.ok) {
    if (result.reason === 'unavailable') {
      sendV1Error(res, 503, 'Database unavailable', {
        code: 'service_unavailable',
      });
    } else {
      sendV1Error(res, 401, 'Invalid or revoked API key', {
        code: 'unauthorized',
      });
    }
    return { ok: false, reason: result.reason };
  }

  // Attach API key data to context. An `api_keys` row identifies its owner by
  // email, so this is where that email becomes the stable `users.id` the
  // authorization layer keys on — resolved once per request rather than per
  // deck. A key whose owner has no user row (external/legacy) resolves to null,
  // and an actor with no id matches no ownership stamp; see
  // shared/identity-match.js.
  ctx.apiKey = result;
  const ownerResolution = await resolveIdentityByEmail(result.ownerEmail);
  ctx.authedUser = {
    id: ownerResolution?.userId || null,
    email: result.ownerEmail,
    role: 'user',
    // The organization this key acts in. Carried on the acting user (not read
    // off whatever deck is being checked) so the organization-wide grant is decided against
    // the key's own organization — see utils/presentation-authz/actor-access.js.
    organizationId: result.organizationId,
  };
  // A machine client acts in the organization its key belongs to. That is a
  // real answer rather than the default organization the storage layer used to
  // assume, so public-API reads and writes stay inside the key's organization.
  ctx.storageScope = {
    repoRoot: ctx.repoRoot ?? null,
    organizationId: result.organizationId,
    // Both halves of the acting identity, so a storage write can compare the id
    // (author locks) and stamp the address (display) without resolving again.
    actorUserId: ctx.authedUser.id,
    actorEmail: result.ownerEmail,
  };

  return { ok: true };
}

// ============================================================
// PERMISSION CHECKING
// ============================================================

/**
 * Check if the API key has the required permission.
 * @param {Object} ctx - Request context with apiKey
 * @param {string} permission - Required permission
 * @returns {boolean}
 */
export function requirePermission(ctx, permission) {
  const { res, apiKey } = ctx;

  if (!apiKey) {
    sendV1Error(res, 403, 'Authentication required', { code: 'forbidden' });
    return false;
  }

  if (!hasPermission(apiKey.permissions, permission)) {
    sendV1Error(res, 403, `API key lacks required permission: ${permission}`, {
      code: 'forbidden',
    });
    return false;
  }

  return true;
}

// ============================================================
// AUTHORIZATION HELPERS
// ============================================================

/**
 * Synchronous ownership/visibility filter for presentation *listings* only.
 * Returns true if:
 * - Presentation has organization visibility
 * - API key owner matches presentation owner or creator
 *
 * No ownerless-legacy exception: per-deck reads would refuse those decks
 * anyway, so listing them only leaks titles (same invariant as the Home
 * collection filter).
 *
 * Note: this deliberately ignores the collaborator table (checking it per
 * deck in a list would be N queries). For per-deck access decisions use
 * getPresentationWithAccess, which is collaborator-aware and distinguishes
 * read from write access.
 * @param {Object} presentation - The presentation object
 * @param {Object} actor - The acting API-key owner (`ctx.authedUser`: `{id, email}`)
 * @returns {boolean}
 */
export function canAccessPresentation(presentation, actor) {
  if (!hasIdentity(actor)) return false;

  const visibility = normalizePresentationVisibility(presentation?.visibility);
  if (visibility === 'organization') return true;

  return isOwnerOrCreator(actor, presentation);
}

/**
 * Fetch a presentation and verify access in one call.
 * Sends appropriate error responses if presentation not found or access denied.
 *
 * Uses the same collaborator-aware canRead/canWritePresentation checks as the
 * editor routes: reads allow owner/creator, organization visibility, and any
 * collaborator; writes additionally require edit rights (owner/creator,
 * writable organization-visible deck, or a collaborator with edit/admin permission).
 * @param {Object} ctx - Request context with repoRoot, authedUser and apiKey
 * @param {string} presentationId - The presentation ID to fetch
 * @param {Object} [options]
 * @param {'read'|'write'} [options.access='read'] - Required access level
 * @returns {Promise<{ok: boolean, pres?: Object}>} - Result with presentation if successful
 */
export async function getPresentationWithAccess(
  ctx,
  presentationId,
  { access = 'read' } = {},
) {
  const { storageScope, authedUser } = ctx;

  const pres = await getPresentation(storageScope, presentationId);
  if (!pres) {
    await apiError(ctx, 404, 'Presentation not found');
    return { ok: false };
  }

  if (!(await canActorAccessPresentation(pres, authedUser, 'read'))) {
    await apiError(ctx, 403, 'Access denied to this presentation');
    return { ok: false };
  }

  if (
    access === 'write' &&
    !(await canActorAccessPresentation(pres, authedUser, 'write'))
  ) {
    await apiError(ctx, 403, 'You have read-only access to this presentation');
    return { ok: false };
  }

  return { ok: true, pres };
}

/**
 * Read a JSON body on the public `/api/v1` surface, answering that surface's
 * own error envelope (via `apiError`) rather than the internal one.
 *
 * Named for the surface on purpose: the internal `/api/*` routes have their own
 * body entry in `server/utils/http.js`, and the two contracts differ. One name
 * for both was a homonym: the same word for two error envelopes.
 *
 * @param {Object} ctx - Request context
 * @param {Object} req - HTTP request object
 * @param {Object} [opts]
 * @param {boolean} [opts.requireObject] Reject an absent or non-object body
 *   with a 400 instead of returning `null`. The opt-in mirrors the internal
 *   `requireJsonBody`'s object guarantee for the endpoints that need it, while
 *   the default stays null-tolerant — `/api/v1` is a published contract and
 *   endpoints that accept a missing payload today must keep doing so.
 * @returns {Promise<{ok: boolean, body?: Object}>} - Result with parsed body if successful
 */
export async function readApiV1Body(ctx, req, { requireObject = false } = {}) {
  let raw;
  try {
    raw = (await readRequestBody(req)).toString('utf8');
  } catch (err) {
    // The size cap throws; the v1 surface answers it in its own envelope.
    await apiError(
      ctx,
      err?.statusCode === 413 ? 413 : 400,
      'Request body too large',
    );
    return { ok: false };
  }
  // An absent body stays `null` here, unlike the internal `requireJsonBody`:
  // `/api/v1` is a published contract, and endpoints that tolerate a missing
  // payload today must keep doing so.
  if (!raw) {
    if (requireObject) {
      await apiError(ctx, 400, 'Request body must be a JSON object');
      return { ok: false };
    }
    return { ok: true, body: null };
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    await apiError(ctx, 400, 'Invalid JSON body');
    return { ok: false };
  }
  if (requireObject && !isJsonObject(body)) {
    await apiError(ctx, 400, 'Request body must be a JSON object');
    return { ok: false };
  }
  return { ok: true, body };
}

// ============================================================
// RATE LIMITING
// ============================================================

/**
 * Check per-minute rate limit for the API key.
 * Uses a Redis-backed (or in-memory fallback) token bucket.
 * @param {Object} ctx - Request context with apiKey
 * @returns {Promise<boolean>} - True if allowed, false if rate limited
 */
export async function checkRequestRateLimit(ctx) {
  const { res, apiKey } = ctx;

  if (!apiKey) return true; // Should not happen after auth

  const tier = apiKey.tier || 'free';
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.free;
  const key = `api:${apiKey.id}`;

  const allowed = await allowRequest(
    key,
    apiTierBucket(limits.requestsPerMinute),
  );

  if (!allowed) {
    sendV1Error(
      res,
      429,
      'Rate limit exceeded. Please slow down your requests.',
      {
        code: 'rate_limited',
        headers: { 'Retry-After': '60' },
      },
    );
    return false;
  }

  return true;
}

/**
 * Check daily AI request limit.
 * @param {Object} ctx - Request context with apiKey
 * @returns {Promise<boolean>} - True if allowed
 */
export async function checkAiLimit(ctx) {
  const { res, apiKey } = ctx;

  if (!apiKey) return true;

  const result = await checkAiRateLimit(apiKey.id, apiKey.tier);
  if (!result.ok) {
    sendV1Error(res, 503, 'Service unavailable', {
      code: 'service_unavailable',
    });
    return false;
  }

  if (result.limited) {
    const headers = await getRateLimitHeaders(apiKey.id, apiKey.tier, 'ai');
    sendV1Error(res, 429, 'Daily AI request limit exceeded', {
      code: 'rate_limited',
      headers,
      details: {
        limit: result.limit,
        used: result.used,
        resetAt: headers['X-RateLimit-Reset'],
      },
    });
    return false;
  }

  return true;
}

/**
 * Check daily export limit.
 * @param {Object} ctx - Request context with apiKey
 * @returns {Promise<boolean>} - True if allowed
 */
export async function checkExportLimit(ctx) {
  const { res, apiKey } = ctx;

  if (!apiKey) return true;

  const result = await checkExportRateLimit(apiKey.id, apiKey.tier);
  if (!result.ok) {
    sendV1Error(res, 503, 'Service unavailable', {
      code: 'service_unavailable',
    });
    return false;
  }

  if (result.limited) {
    const headers = await getRateLimitHeaders(
      apiKey.id,
      apiKey.tier,
      'exports',
    );
    sendV1Error(res, 429, 'Daily export limit exceeded', {
      code: 'rate_limited',
      headers,
      details: {
        limit: result.limit,
        used: result.used,
        resetAt: headers['X-RateLimit-Reset'],
      },
    });
    return false;
  }

  return true;
}

// ============================================================
// USAGE TRACKING
// ============================================================

/**
 * Track a standard API request.
 * @param {Object} ctx - Request context with apiKey
 */
export async function trackRequest(ctx) {
  if (!ctx.apiKey) return;
  await incrementUsage(ctx.apiKey.id, { requests: 1 });
}

/**
 * Track an AI request.
 * @param {Object} ctx - Request context with apiKey
 */
export async function trackAiRequest(ctx) {
  if (!ctx.apiKey) return;
  await incrementUsage(ctx.apiKey.id, { requests: 1, aiRequests: 1 });
}

/**
 * Track an export request.
 * @param {Object} ctx - Request context with apiKey
 */
export async function trackExportRequest(ctx) {
  if (!ctx.apiKey) return;
  await incrementUsage(ctx.apiKey.id, { requests: 1, exports: 1 });
}

// ============================================================
// RESPONSE HELPERS
// ============================================================

/**
 * Send a standardized API response with rate limit headers.
 * @param {Object} ctx - Request context
 * @param {number} status - HTTP status code
 * @param {Object} data - Response data
 * @param {string} [limitType] - Type of limit for headers
 */
async function apiResponse(ctx, status, data, limitType = 'requests') {
  const { res, apiKey } = ctx;

  const headers = {};

  // Add rate limit headers if we have an API key
  if (apiKey) {
    const limitHeaders = await getRateLimitHeaders(
      apiKey.id,
      apiKey.tier,
      limitType,
    );
    Object.assign(headers, limitHeaders);
  }

  serveJson(res, status, data, headers);
}

/**
 * Send a success response.
 * @param {Object} ctx - Request context
 * @param {Object} data - Response data
 */
export async function apiSuccess(ctx, data) {
  await apiResponse(ctx, 200, data);
}

/**
 * Send a created response.
 * @param {Object} ctx - Request context
 * @param {Object} data - Response data
 */
export async function apiCreated(ctx, data) {
  await apiResponse(ctx, 201, data);
}

// ============================================================
// ERROR ENVELOPE (the one public /api/v1 error shape)
// ============================================================

/**
 * Emit the canonical public-API v1 error envelope, synchronously:
 *
 *   { "error": "<machine_code>", "message": "<human text>", "details"?: … }
 *
 * `error` is a stable snake_case machine code clients branch on (the same
 * A7.19 vocabulary the internal `/api/*` layer uses — `not_found`, `forbidden`,
 * `rate_limited`, … — minus the internal envelope's `ok:false`, which the
 * public surface never carried). `message` is the human-readable text; safe to
 * show a user, never a stack trace. `details` is optional structured extra.
 *
 * This is the single low-level emitter: `apiError` layers rate-limit headers on
 * top of it, and the pre-dispatch guards (auth, permission, method, 404) call
 * it directly. One envelope, produced one way — see docs/openapi.yaml § Errors
 * and docs/reference/api-error-format.md § Scope.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} status - HTTP status code.
 * @param {string} [message] - Human-readable message.
 * @param {Object} [opts]
 * @param {string} [opts.code] - Machine code; defaults from the HTTP status.
 * @param {*} [opts.details] - Structured extra (omitted when null/undefined).
 * @param {Object} [opts.headers] - Extra response headers (e.g. Retry-After).
 * @returns {true}
 */
export function sendV1Error(
  res,
  status,
  message,
  { code, details, headers } = {},
) {
  const body = { error: code || codeForStatus(status) };
  if (message != null && message !== '') body.message = message;
  if (details != null) body.details = details;
  serveJson(res, status, body, headers || {});
  return true;
}

/**
 * 405 for the v1 surface: the canonical envelope plus the `Allow` header.
 * @param {import('node:http').ServerResponse} res
 * @param {string[]} allowed - Accepted methods.
 * @returns {true}
 */
export function v1MethodNotAllowed(res, allowed) {
  return sendV1Error(res, 405, 'Method not allowed', {
    code: 'method_not_allowed',
    headers: { Allow: allowed.join(', ') },
  });
}

/**
 * 404 for the v1 surface in the canonical envelope.
 * @param {import('node:http').ServerResponse} res
 * @param {string} [message]
 * @returns {true}
 */
export function v1NotFound(res, message = 'Not found') {
  return sendV1Error(res, 404, message, { code: 'not_found' });
}

/**
 * Send an error response with rate-limit headers, in the canonical v1 envelope.
 * The endpoint-facing helper (the sub-handlers call this); `error` is derived
 * from the status unless `code` is passed.
 *
 * @param {Object} ctx - Request context.
 * @param {number} status - HTTP status code.
 * @param {string} [message] - Human-readable message.
 * @param {Object} [opts]
 * @param {string} [opts.code] - Machine code; defaults from the HTTP status.
 * @param {*} [opts.details] - Structured extra (omitted when null/undefined).
 * @param {Object} [opts.headers] - Extra response headers.
 */
export async function apiError(
  ctx,
  status,
  message,
  { code, details, headers } = {},
) {
  const { res, apiKey } = ctx;
  const merged = {};
  if (apiKey) {
    Object.assign(
      merged,
      await getRateLimitHeaders(apiKey.id, apiKey.tier, 'requests'),
    );
  }
  Object.assign(merged, headers || {});
  sendV1Error(res, status, message, { code, details, headers: merged });
}

/**
 * Wrap the v1 feature dispatch so every *un*handled throw still answers in the
 * canonical v1 envelope — never the internal `{ ok:false, … }` one the
 * top-level server handler would otherwise emit for the public surface.
 *
 * This is the v1 analogue of `withErrorHandler` (server/utils/http.js): the
 * public API had zero wrappers and hand-rolled try/catch per handler (B39 deel
 * 3, bevinding 11 — the "third envelope grows back" risk). Wrapping the
 * mount-level dispatch covers every sub-handler it routes to (including any
 * that forgot a catch). A thrown `AppError`/status-bearing error keeps its
 * status, machine code and details; anything ≥500 answers a generic
 * `internal_error` without leaking internals.
 *
 * @param {string} moduleName - Label for the error log.
 * @param {Function} handler - Async dispatch function `(ctx, …) => Promise<boolean>`.
 * @returns {Function}
 */
export function withV1ErrorHandler(moduleName, handler) {
  return async (ctx, ...args) => {
    try {
      return await handler(ctx, ...args);
    } catch (err) {
      const { res } = ctx;
      const reqCtx = [ctx?.req?.method, ctx?.url?.pathname]
        .filter(Boolean)
        .join(' ');
      logError(
        moduleName,
        reqCtx ? `Error handling ${reqCtx}:` : 'Error:',
        err,
      );

      // Headers already flushed (e.g. a streaming export): just close.
      if (res.headersSent || res.writableEnded) {
        try {
          res.end();
        } catch {
          // ignore close errors
        }
        return true;
      }

      const status = getStatusCode(err);
      if (status >= 500) {
        // Never leak internal detail on a server-side failure.
        sendV1Error(res, status, 'Internal server error', {
          code: codeForStatus(status),
        });
      } else {
        sendV1Error(res, status, err?.message, {
          code: err?.code || codeForStatus(status),
          details: err?.details ?? undefined,
        });
      }
      return true;
    }
  };
}
