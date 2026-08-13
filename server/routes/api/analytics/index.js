/**
 * Analytics API routes - main dispatcher.
 */

import { getClientIp, allowRequest } from '../../../utils/rate-limit.js';
import { dispatchRoutes } from '../../../utils/router.js';
import {
  sendRateLimitResponse,
  logSecurityEvent,
  SECURITY_EVENTS,
} from '../../../analytics/helpers.js';
import { AUTH_RATE_LIMITS } from '../../../config/rate-limits.js';
import { handleDashboard, handlePresentationsList } from './dashboard.js';
import { handleOverview, handleSlides, handleHeatmap, handleJourney, handleSessions } from './metrics.js';
import { handleRealtime } from './realtime.js';
import {
  handleListReports,
  handleCreateReport,
  handleGetReport,
  handleUpdateReport,
  handleDeleteReport,
  handleRegenerateToken,
} from './reports.js';
import { handleExportMyData, handleDeleteMyData } from './gdpr.js';

/**
 * Declarative route table for the authenticated analytics surface (A7.19 C8).
 *
 * Two path prefixes live here — `/api/analytics/*` (dashboard + GDPR) and the
 * per-presentation `/api/presentations/:id/analytics/*` sub-tree — so the module
 * has no single prefix guard; the entry function applies the module-wide rate
 * limit before dispatch instead (route-dispatch.md § module-wide guards).
 *
 * Form A throughout: every route is method-bearing and a method mismatch falls
 * through (the original if-chain sent no 405, it fell to `false` → 404). Order
 * mirrors the previous chain line for line — `/reports` before `/reports/:id`,
 * `/reports/:id` before `/reports/:id/regenerate-token` (the `([^/]+)` captures
 * never span a slash, so these do not overlap, but the order is preserved
 * regardless). `handleCreateReport` re-derives its rate-limit key from the
 * context rather than receiving it as a positional argument.
 *
 * @type {import('../../../utils/router.js').Route[]}
 */
export const ROUTES = [
  // Combined dashboard endpoints
  { method: 'GET', pattern: '/api/analytics/dashboard', handler: handleDashboard },
  { method: 'GET', pattern: '/api/analytics/presentations', handler: handlePresentationsList },

  // Presentation-specific analytics endpoints
  { method: 'GET', pattern: /^\/api\/presentations\/([^/]+)\/analytics$/, handler: handleOverview },
  { method: 'GET', pattern: /^\/api\/presentations\/([^/]+)\/analytics\/slides$/, handler: handleSlides },
  { method: 'GET', pattern: /^\/api\/presentations\/([^/]+)\/analytics\/heatmap$/, handler: handleHeatmap },
  { method: 'GET', pattern: /^\/api\/presentations\/([^/]+)\/analytics\/journey$/, handler: handleJourney },
  { method: 'GET', pattern: /^\/api\/presentations\/([^/]+)\/analytics\/sessions$/, handler: handleSessions },
  { method: 'GET', pattern: /^\/api\/presentations\/([^/]+)\/analytics\/realtime$/, handler: handleRealtime },

  // Report CRUD endpoints
  { method: 'GET', pattern: /^\/api\/presentations\/([^/]+)\/analytics\/reports$/, handler: handleListReports },
  { method: 'POST', pattern: /^\/api\/presentations\/([^/]+)\/analytics\/reports$/, handler: handleCreateReport },
  { method: 'GET', pattern: /^\/api\/presentations\/([^/]+)\/analytics\/reports\/([^/]+)$/, handler: handleGetReport },
  { method: 'PATCH', pattern: /^\/api\/presentations\/([^/]+)\/analytics\/reports\/([^/]+)$/, handler: handleUpdateReport },
  { method: 'DELETE', pattern: /^\/api\/presentations\/([^/]+)\/analytics\/reports\/([^/]+)$/, handler: handleDeleteReport },
  { method: 'POST', pattern: /^\/api\/presentations\/([^/]+)\/analytics\/reports\/([^/]+)\/regenerate-token$/, handler: handleRegenerateToken },

  // GDPR data access endpoints
  { method: 'GET', pattern: '/api/analytics/my-data', handler: handleExportMyData },
  { method: 'DELETE', pattern: '/api/analytics/my-data', handler: handleDeleteMyData },
];

/**
 * Handle authenticated analytics routes.
 * @param {import('../../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>} True if handled
 */
export async function handleAnalytics(ctx) {
  const { req, res, url, authedUser } = ctx;

  // Apply user-based rate limiting for authenticated endpoints. This runs for
  // every request that reaches the module (there is no prefix guard), exactly
  // as the original chain did before its first path compare.
  const rateLimitKey = authedUser?.email || authedUser?.id || getClientIp(req);
  if (!(await allowRequest(`analytics:auth:${rateLimitKey}`, AUTH_RATE_LIMITS.standard))) {
    logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
      endpoint: url.pathname,
      user: authedUser?.email,
      limitType: 'authenticated',
    });
    return sendRateLimitResponse(res, 'Rate limit exceeded', 1), true;
  }

  return dispatchRoutes(ROUTES, ctx);
}

// Re-export public handler
export { handleAnalyticsReportPublic } from './public.js';
