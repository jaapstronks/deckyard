/**
 * API key management endpoints.
 * Allows authenticated users to create and manage their API keys.
 *
 * GET /api/api-keys - List user's API keys
 * POST /api/api-keys - Create a new API key
 * GET /api/api-keys/:id - Get API key details
 * DELETE /api/api-keys/:id - Revoke an API key
 * GET /api/api-keys/:id/usage - Get usage statistics
 */

import {
  createApiKey,
  listApiKeys,
  getApiKeyById,
  revokeApiKey,
  AVAILABLE_PERMISSIONS,
} from '../../storage/api-keys.js';
import { getUsageHistory, getTodayUsage } from '../../storage/api-usage.js';
import { serveJson, methodNotAllowed, notFound, badRequest, requireJsonBody } from '../../utils/http.js';
import { dispatchRoutes } from '../../utils/router.js';

// GET /api/api-keys - List user's API keys
async function handleApiKeyList({ storageScope, res, url, authedUser }) {
  const includeRevoked = url.searchParams.get('includeRevoked') === 'true';
  const result = await listApiKeys(storageScope, { includeRevoked });

  if (!result.ok) {
    return badRequest(res, result.reason || 'Failed to list API keys');
  }

  serveJson(res, 200, {
    keys: result.keys,
    availablePermissions: AVAILABLE_PERMISSIONS,
  });
  return true;
}

// POST /api/api-keys - Create a new API key
async function handleApiKeyCreate({ storageScope, req, res, authedUser }) {
  // An empty body is a legitimate "create a key with the defaults".
  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;

  const { name, permissions } = parsed.body || {};

  const result = await createApiKey(storageScope, {
    name: name || 'API Key',
    ownerEmail: authedUser.email,
    permissions: permissions || ['read', 'write'],
  });

  if (!result.ok) {
    const messages = {
      invalid_email: 'Invalid email',
      name_required: 'Name is required',
      invalid_permissions: `Invalid permissions. Available: ${AVAILABLE_PERMISSIONS.join(', ')}`,
      unavailable: 'Database unavailable',
    };
    return badRequest(res, messages[result.reason] || 'Failed to create API key');
  }

  // Important: Return the full key only once at creation time
  serveJson(res, 201, {
    key: result.key, // Full API key - only shown once!
    id: result.id,
    name: result.name,
    prefix: result.prefix,
    permissions: result.permissions,
    createdAt: result.createdAt,
    message: 'Store this API key securely - it will not be shown again.',
  });
  return true;
}

// GET /api/api-keys/:id/usage - Get usage statistics
async function handleApiKeyUsage({ storageScope, res, url, authedUser }, keyId) {

  // Verify the key belongs to the user
  const keyResult = await getApiKeyById(storageScope, keyId);
  if (!keyResult.ok) {
    return notFound(res, 'API key not found');
  }

  const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10)));
  const historyResult = await getUsageHistory(keyId, { days });

  if (!historyResult.ok) {
    return badRequest(res, 'Failed to get usage statistics');
  }

  const todayResult = await getTodayUsage(keyId);

  serveJson(res, 200, {
    key: {
      id: keyResult.id,
      name: keyResult.name,
      prefix: keyResult.prefix,
      tier: keyResult.tier,
    },
    today: todayResult.ok ? {
      requestCount: todayResult.requestCount,
      aiRequestCount: todayResult.aiRequestCount,
      exportCount: todayResult.exportCount,
    } : null,
    history: historyResult.history,
    totals: historyResult.totals,
    days: historyResult.days,
  });
  return true;
}

// GET /api/api-keys/:id - Get API key details
async function handleApiKeyGet({ storageScope, res, authedUser }, keyId) {
  const result = await getApiKeyById(storageScope, keyId);

  if (!result.ok) {
    return notFound(res, 'API key not found');
  }

  serveJson(res, 200, {
    id: result.id,
    name: result.name,
    prefix: result.prefix,
    ownerEmail: result.ownerEmail,
    tier: result.tier,
    permissions: result.permissions,
    lastUsedAt: result.lastUsedAt,
    revokedAt: result.revokedAt,
    createdAt: result.createdAt,
  });
  return true;
}

// DELETE /api/api-keys/:id - Revoke an API key
async function handleApiKeyRevoke({ storageScope, res, authedUser }, keyId) {
  const result = await revokeApiKey(storageScope, keyId, authedUser.email);

  if (!result.ok) {
    const messages = {
      key_id_required: 'Key ID is required',
      not_found_or_already_revoked: 'API key not found or already revoked',
      unavailable: 'Database unavailable',
    };
    if (result.reason === 'not_found_or_already_revoked') {
      return notFound(res, messages[result.reason]);
    }
    return badRequest(res, messages[result.reason] || 'Failed to revoke API key');
  }

  serveJson(res, 200, {
    revoked: true,
    revokedAt: result.revokedAt,
  });
  return true;
}

/**
 * Declarative route table for `/api/api-keys*` (A7.19 C8). Order matches the
 * previous if-chain: the `/usage` row comes before the `/:id` rows, and the
 * trailing 405 catch-alls mirror the chain's "method not allowed for
 * recognized paths" tail — every recognized path 405s on a wrong method,
 * after all method-bearing rows have had their chance (Form B).
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: '/api/api-keys', handler: handleApiKeyList },
  { method: 'POST', pattern: '/api/api-keys', handler: handleApiKeyCreate },
  { method: 'GET', pattern: /^\/api\/api-keys\/([^/]+)\/usage$/, handler: handleApiKeyUsage },
  { method: 'GET', pattern: /^\/api\/api-keys\/([^/]+)$/, handler: handleApiKeyGet },
  { method: 'DELETE', pattern: /^\/api\/api-keys\/([^/]+)$/, handler: handleApiKeyRevoke },
  { pattern: '/api/api-keys', handler: ({ res }) => methodNotAllowed(res, ['GET', 'POST']) },
  { pattern: /^\/api\/api-keys\/[^/]+$/, handler: ({ res }) => methodNotAllowed(res, ['GET', 'DELETE']) },
  { pattern: /^\/api\/api-keys\/[^/]+\/usage$/, handler: ({ res }) => methodNotAllowed(res, ['GET']) },
];

/**
 * Handle API key management routes. The module-wide guards (path prefix,
 * authentication) run before dispatch, exactly as the original chain did —
 * an unauthenticated request falls through (`false`, not a 401) so the main
 * router answers.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export function handleApiKeys(ctx) {
  if (!ctx.url.pathname.startsWith('/api/api-keys')) return false;

  // Require authentication
  if (!ctx.authedUser?.email) {
    return false; // Let the main router handle unauthorized
  }

  return dispatchRoutes(ROUTES, ctx);
}
