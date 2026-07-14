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
  AVAILABLE_SCOPES,
} from '../../storage/api-keys.js';
import { getUsageHistory, getTodayUsage } from '../../storage/api-usage.js';
import { serveJson, methodNotAllowed, notFound, badRequest } from '../../utils/http.js';
import { parseJsonBody } from '../../utils/http.js';
import { createRouteContext } from '../../utils/context.js';

/**
 * Handle API key management routes.
 */
export async function handleApiKeys({ req, res, url, authedUser }) {
  if (!url.pathname.startsWith('/api/api-keys')) return false;

  // Require authentication
  if (!authedUser?.email) {
    return false; // Let the main router handle unauthorized
  }

  const ctx = createRouteContext(authedUser);

  // ============================================================
  // GET /api/api-keys - List user's API keys
  // ============================================================
  if (url.pathname === '/api/api-keys' && req.method === 'GET') {
    const includeRevoked = url.searchParams.get('includeRevoked') === 'true';
    const result = await listApiKeys({ includeRevoked }, ctx);

    if (!result.ok) {
      return badRequest(res, result.reason || 'Failed to list API keys');
    }

    serveJson(res, 200, {
      keys: result.keys,
      availableScopes: AVAILABLE_SCOPES,
    });
    return true;
  }

  // ============================================================
  // POST /api/api-keys - Create a new API key
  // ============================================================
  if (url.pathname === '/api/api-keys' && req.method === 'POST') {
    const parsed = await parseJsonBody(req);
    if (!parsed.ok) {
      return badRequest(res, parsed.error || 'Invalid request body');
    }

    const { name, scopes } = parsed.body || {};

    const result = await createApiKey({
      name: name || 'API Key',
      ownerEmail: authedUser.email,
      scopes: scopes || ['read', 'write'],
    }, ctx);

    if (!result.ok) {
      const messages = {
        invalid_email: 'Invalid email',
        name_required: 'Name is required',
        invalid_scopes: `Invalid scopes. Available: ${AVAILABLE_SCOPES.join(', ')}`,
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
      scopes: result.scopes,
      createdAt: result.createdAt,
      message: 'Store this API key securely - it will not be shown again.',
    });
    return true;
  }

  // ============================================================
  // Usage stats endpoint (before :id routes)
  // ============================================================
  const usageMatch = url.pathname.match(/^\/api\/api-keys\/([^/]+)\/usage$/);
  if (usageMatch && req.method === 'GET') {
    const keyId = usageMatch[1];

    // Verify the key belongs to the user
    const keyResult = await getApiKeyById(keyId, ctx);
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

  // ============================================================
  // GET /api/api-keys/:id - Get API key details
  // ============================================================
  const getMatch = url.pathname.match(/^\/api\/api-keys\/([^/]+)$/);
  if (getMatch && req.method === 'GET') {
    const keyId = getMatch[1];
    const result = await getApiKeyById(keyId, ctx);

    if (!result.ok) {
      return notFound(res, 'API key not found');
    }

    serveJson(res, 200, {
      id: result.id,
      name: result.name,
      prefix: result.prefix,
      ownerEmail: result.ownerEmail,
      tier: result.tier,
      scopes: result.scopes,
      lastUsedAt: result.lastUsedAt,
      revokedAt: result.revokedAt,
      createdAt: result.createdAt,
    });
    return true;
  }

  // ============================================================
  // DELETE /api/api-keys/:id - Revoke an API key
  // ============================================================
  const deleteMatch = url.pathname.match(/^\/api\/api-keys\/([^/]+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    const keyId = deleteMatch[1];
    const result = await revokeApiKey(keyId, authedUser.email, ctx);

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

  // Method not allowed for recognized paths
  if (url.pathname === '/api/api-keys') {
    return methodNotAllowed(res, ['GET', 'POST']);
  }

  if (url.pathname.match(/^\/api\/api-keys\/[^/]+$/)) {
    return methodNotAllowed(res, ['GET', 'DELETE']);
  }

  if (url.pathname.match(/^\/api\/api-keys\/[^/]+\/usage$/)) {
    return methodNotAllowed(res, ['GET']);
  }

  return false;
}
