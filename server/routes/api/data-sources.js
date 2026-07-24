/**
 * API routes for live data sources.
 *
 * Endpoints:
 *   POST   /api/data-sources/preview       - Preview data from a source (no binding)
 *   POST   /api/data-sources/refresh       - Refresh a slide's data from its source
 *   GET    /api/data-sources/providers     - List available providers
 */

import { badRequest, json, methodNotAllowed, serveJson, unauthorized, forbidden, jsonError } from '../../utils/http.js';
import { isLiveDataEnabled } from '../../config/features.js';
import { validateDataSource, DATA_SOURCE_PROVIDERS, BINDABLE_SLIDE_TYPES } from '../../../shared/data-source.js';
import { refreshSlideData, fetchProviderData } from '../../utils/data-source/index.js';
import { broadcastToPresentation, DataSourceEventTypes } from '../../services/comment-events.js';

export async function handleDataSources({ req, res, url, authedUser }) {
  if (!url.pathname.startsWith('/api/data-sources')) return false;
  if (!authedUser) return unauthorized(res);

  if (!isLiveDataEnabled()) {
    forbidden(res, 'Live data sources are not enabled');
    return true;
  }

  // GET /api/data-sources/providers — list available providers and bindable slide types
  if (url.pathname === '/api/data-sources/providers' && req.method === 'GET') {
    serveJson(res, 200, {
      providers: DATA_SOURCE_PROVIDERS,
      bindableSlideTypes: BINDABLE_SLIDE_TYPES,
    });
    return true;
  }

  // POST /api/data-sources/preview — fetch raw data from a provider (for mapping UI)
  if (url.pathname === '/api/data-sources/preview') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    const body = await json(req);
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
  if (url.pathname === '/api/data-sources/refresh') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    const body = await json(req);
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

  return false;
}
