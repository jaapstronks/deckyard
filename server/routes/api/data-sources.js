/**
 * API routes for live data sources.
 *
 * Endpoints:
 *   POST   /api/data-sources/preview       - Preview data from a source (no binding)
 *   POST   /api/data-sources/refresh       - Refresh a slide's data from its source
 *   GET    /api/data-sources/providers     - List available providers
 */

import { badRequest, methodNotAllowed, serveJson, unauthorized, forbidden, jsonError, requireJsonBody , withErrorHandler } from '../../utils/http.js';
import { isLiveDataEnabled } from '../../config/features.js';
import { validateDataSource, DATA_SOURCE_PROVIDERS, BINDABLE_SLIDE_TYPES } from '../../../shared/data-source.js';
import { refreshSlideData, fetchProviderData } from '../../utils/data-source/index.js';
import { broadcastToPresentation, DataSourceEventTypes } from '../../services/comment-events.js';
import { dispatchRoutes } from '../../utils/router.js';

// GET /api/data-sources/providers — list available providers and bindable slide types
function handleProviders({ res }) {
  serveJson(res, 200, {
    providers: DATA_SOURCE_PROVIDERS,
    bindableSlideTypes: BINDABLE_SLIDE_TYPES,
  });
  return true;
}

// POST /api/data-sources/preview — fetch raw data from a provider (for mapping UI)
async function handleDataSourcePreview({ req, res }) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  if (!body?.provider || !body?.config) {
    return badRequest(res, 'provider and config are required');
  }

  if (!DATA_SOURCE_PROVIDERS.includes(body.provider)) {
    return badRequest(res, `Unknown provider: ${body.provider}`);
  }

  try {
    const data = await fetchProviderData(body.provider, body.config);
    serveJson(res, 200, { data });
    return true;
  } catch (err) {
    const status = err.statusCode || 502;
    jsonError(res, status, 'data_source_error', err.message);
    return true;
  }
}

// POST /api/data-sources/refresh — refresh a slide's data from its source
async function handleDataSourceRefresh({ req, res }) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  if (!body?.dataSource || !body?.content) {
    return badRequest(res, 'dataSource and content are required');
  }

  const validation = validateDataSource(body.dataSource);
  if (!validation.valid) {
    return badRequest(res, validation.error);
  }

  try {
    const result = await refreshSlideData(body.dataSource, body.content);

    // Broadcast update via SSE if a presentationId is provided
    if (body.presentationId && body.slideId) {
      broadcastToPresentation(body.presentationId, DataSourceEventTypes.REFRESHED, {
        slideId: body.slideId,
        content: result.content,
        lastSync: result.lastSync,
      });
    }

    serveJson(res, 200, {
      content: result.content,
      applied: result.applied,
      errors: result.errors,
      lastSync: result.lastSync,
    });
    return true;
  } catch (err) {
    const status = err.statusCode || 500;
    jsonError(res, status, 'data_source_error', err.message);
    return true;
  }
}

/**
 * Declarative route table for `/api/data-sources/*` (A7.19 C8). Order matches
 * the previous if-chain. `/providers` is GET-only and falls through on a method
 * mismatch (no 405 in the original); `/preview` and `/refresh` were POST-only
 * with an explicit 405, preserved here as trailing catch-all rows.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: '/api/data-sources/providers', handler: handleProviders },
  { method: 'POST', pattern: '/api/data-sources/preview', handler: handleDataSourcePreview },
  { pattern: '/api/data-sources/preview', handler: ({ res }) => methodNotAllowed(res, ['POST']) },
  { method: 'POST', pattern: '/api/data-sources/refresh', handler: handleDataSourceRefresh },
  { pattern: '/api/data-sources/refresh', handler: ({ res }) => methodNotAllowed(res, ['POST']) },
];

/**
 * Handle live data-source endpoints. The module-wide guards (prefix, auth,
 * feature flag) run before dispatch, exactly as the original chain did.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleDataSources = withErrorHandler('data-sources', (ctx) => {
  if (!ctx.url.pathname.startsWith('/api/data-sources')) return false;
  if (!ctx.authedUser) return unauthorized(ctx.res);

  if (!isLiveDataEnabled()) {
    forbidden(ctx.res, 'Live data sources are not enabled');
    return true;
  }

  return dispatchRoutes(ROUTES, ctx);
});
