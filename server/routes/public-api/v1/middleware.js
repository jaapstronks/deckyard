/**
 * Middleware for public API v1.
 * Handles API key authentication, rate limiting, and usage tracking.
 */

import { validateApiKey, TIER_LIMITS, hasScope } from '../../../storage/api-keys.js';
import { normalizeEmail } from '../../../utils/normalize.js';
import { normalizePresentationScope } from '../../../utils/presentation-authz.js';
import { incrementUsage, getRateLimitHeaders, checkAiRateLimit, checkExportRateLimit } from '../../../storage/api-usage.js';
import { allowRequest, getClientIp } from '../../../utils/rate-limit.js';
import { serveJson, forbidden, rateLimited as sendRateLimited, json } from '../../../utils/http.js';
import { getPresentation } from '../../../storage/presentations.js';

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
    serveJson(res, 401, {
      error: 'Unauthorized',
      message: 'Missing or invalid Authorization header. Use: Bearer <api_key>',
    });
    return { ok: false, reason: 'missing_auth' };
  }

  const result = await validateApiKey(token);
  if (!result.ok) {
    const statusCode = result.reason === 'unavailable' ? 503 : 401;
    serveJson(res, statusCode, {
      error: result.reason === 'unavailable' ? 'Service Unavailable' : 'Unauthorized',
      message: result.reason === 'unavailable'
        ? 'Database unavailable'
        : 'Invalid or revoked API key',
    });
    return { ok: false, reason: result.reason };
  }

  // Attach API key data to context
  ctx.apiKey = result;
  ctx.authedUser = {
    email: result.ownerEmail,
    role: 'user',
  };

  return { ok: true };
}

// ============================================================
// SCOPE CHECKING
// ============================================================

/**
 * Check if the API key has the required scope.
 * @param {Object} ctx - Request context with apiKey
 * @param {string} scope - Required scope
 * @returns {boolean}
 */
export function requireScope(ctx, scope) {
  const { res, apiKey } = ctx;

  if (!apiKey) {
    forbidden(res, 'Authentication required');
    return false;
  }

  if (!hasScope(apiKey.scopes, scope)) {
    forbidden(res, `API key lacks required scope: ${scope}`);
    return false;
  }

  return true;
}

// ============================================================
// AUTHORIZATION HELPERS
// ============================================================

/**
 * Check if an API key owner can access a presentation.
 * Returns true if:
 * - Presentation has workspace scope
 * - API key owner matches presentation owner or creator
 * - Presentation has no owner/creator (legacy)
 * @param {Object} presentation - The presentation object
 * @param {string} ownerEmail - The API key owner's email
 * @returns {boolean}
 */
export function canAccessPresentation(presentation, ownerEmail) {
  const normalized = normalizeEmail(ownerEmail);
  if (!normalized) return false;

  const scope = normalizePresentationScope(presentation?.scope);
  if (scope === 'workspace') return true;

  const owner = normalizeEmail(presentation?.ownerEmail);
  const createdBy = normalizeEmail(presentation?.createdBy);

  if (owner && owner === normalized) return true;
  if (createdBy && createdBy === normalized) return true;
  if (!owner && !createdBy) return true;

  return false;
}

/**
 * Fetch a presentation and verify access in one call.
 * Sends appropriate error responses if presentation not found or access denied.
 * @param {Object} ctx - Request context with repoRoot and apiKey
 * @param {string} presentationId - The presentation ID to fetch
 * @returns {Promise<{ok: boolean, pres?: Object}>} - Result with presentation if successful
 */
export async function getPresentationWithAccess(ctx, presentationId) {
  const { repoRoot, apiKey } = ctx;

  const pres = await getPresentation(repoRoot, presentationId);
  if (!pres) {
    await apiError(ctx, 404, 'Presentation not found');
    return { ok: false };
  }

  if (!canAccessPresentation(pres, apiKey.ownerEmail)) {
    await apiError(ctx, 403, 'Access denied to this presentation');
    return { ok: false };
  }

  return { ok: true, pres };
}

/**
 * Parse JSON body from request with error handling.
 * Sends 400 error response if JSON is invalid.
 * @param {Object} ctx - Request context
 * @param {Object} req - HTTP request object
 * @returns {Promise<{ok: boolean, body?: Object}>} - Result with parsed body if successful
 */
export async function parseJsonBody(ctx, req) {
  try {
    const body = await json(req);
    return { ok: true, body };
  } catch {
    await apiError(ctx, 400, 'Invalid JSON body');
    return { ok: false };
  }
}

/**
 * Parse pagination parameters from URL search params.
 * @param {URL} url - The request URL object
 * @param {Object} [options] - Optional configuration
 * @param {number} [options.defaultLimit=50] - Default limit if not specified
 * @param {number} [options.maxLimit=100] - Maximum allowed limit
 * @returns {{limit: number, offset: number}} - Parsed pagination parameters
 */
export function parsePaginationParams(url, options = {}) {
  const { defaultLimit = 50, maxLimit = 100 } = options;
  const limit = Math.min(maxLimit, Math.max(1, parseInt(url.searchParams.get('limit') || String(defaultLimit), 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));
  return { limit, offset };
}

// ============================================================
// RATE LIMITING
// ============================================================

/**
 * Check per-minute rate limit for the API key.
 * Uses in-memory token bucket algorithm.
 * @param {Object} ctx - Request context with apiKey
 * @returns {boolean} - True if allowed, false if rate limited
 */
export function checkRequestRateLimit(ctx) {
  const { res, apiKey } = ctx;

  if (!apiKey) return true; // Should not happen after auth

  const tier = apiKey.tier || 'free';
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.free;
  const key = `api:${apiKey.id}`;

  // Token bucket: capacity = requests per minute, refill = capacity / 60
  const allowed = allowRequest(key, {
    capacity: limits.requestsPerMinute,
    refillPerSec: limits.requestsPerMinute / 60,
  });

  if (!allowed) {
    sendRateLimited(res, 60, 'Rate limit exceeded. Please slow down your requests.');
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
    serveJson(res, 503, { error: 'Service unavailable' });
    return false;
  }

  if (result.limited) {
    const headers = await getRateLimitHeaders(apiKey.id, apiKey.tier, 'ai');
    serveJson(res, 429, {
      error: 'Daily AI request limit exceeded',
      limit: result.limit,
      used: result.used,
      resetAt: headers['X-RateLimit-Reset'],
    }, headers);
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
    serveJson(res, 503, { error: 'Service unavailable' });
    return false;
  }

  if (result.limited) {
    const headers = await getRateLimitHeaders(apiKey.id, apiKey.tier, 'exports');
    serveJson(res, 429, {
      error: 'Daily export limit exceeded',
      limit: result.limit,
      used: result.used,
      resetAt: headers['X-RateLimit-Reset'],
    }, headers);
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
 * Add rate limit headers to response.
 * @param {Object} ctx - Request context with apiKey
 * @param {Object} res - Response object
 * @param {string} [limitType] - Type of limit for headers
 */
export async function addRateLimitHeaders(ctx, res, limitType = 'requests') {
  if (!ctx.apiKey) return;

  const headers = await getRateLimitHeaders(ctx.apiKey.id, ctx.apiKey.tier, limitType);
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
}

/**
 * Send a standardized API response with rate limit headers.
 * @param {Object} ctx - Request context
 * @param {number} status - HTTP status code
 * @param {Object} data - Response data
 * @param {string} [limitType] - Type of limit for headers
 */
export async function apiResponse(ctx, status, data, limitType = 'requests') {
  const { res, apiKey } = ctx;

  const headers = {};

  // Add rate limit headers if we have an API key
  if (apiKey) {
    const limitHeaders = await getRateLimitHeaders(apiKey.id, apiKey.tier, limitType);
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

/**
 * Send an error response.
 * @param {Object} ctx - Request context
 * @param {number} status - HTTP status code
 * @param {string} error - Error message
 * @param {Object} [details] - Additional error details
 */
export async function apiError(ctx, status, error, details = {}) {
  await apiResponse(ctx, status, { error, ...details });
}
