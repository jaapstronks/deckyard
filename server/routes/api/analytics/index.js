/**
 * Analytics API routes - main dispatcher.
 */

import { getClientIp, allowRequest } from '../../../utils/rate-limit.js';
import {
  AUTH_RATE_LIMITS,
  sendRateLimitResponse,
  logSecurityEvent,
  SECURITY_EVENTS,
} from '../../../analytics/helpers.js';
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
 * Handle authenticated analytics routes.
 * @param {Object} ctx - Request context with authedUser
 * @returns {Promise<boolean>} True if handled
 */
export async function handleAnalytics(ctx) {
  const { req, res, url, authedUser } = ctx;
  const path = url.pathname;

  // Apply user-based rate limiting for authenticated endpoints
  const rateLimitKey = authedUser?.email || authedUser?.id || getClientIp(req);
  if (!(await allowRequest(`analytics:auth:${rateLimitKey}`, AUTH_RATE_LIMITS.standard))) {
    logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
      endpoint: path,
      user: authedUser?.email,
      limitType: 'authenticated',
    });
    return sendRateLimitResponse(res, 'Rate limit exceeded', 1), true;
  }

  // ============================================================
  // COMBINED DASHBOARD ENDPOINTS
  // ============================================================

  if (req.method === 'GET' && path === '/api/analytics/dashboard') {
    return handleDashboard(ctx);
  }

  if (req.method === 'GET' && path === '/api/analytics/presentations') {
    return handlePresentationsList(ctx);
  }

  // ============================================================
  // PRESENTATION-SPECIFIC ANALYTICS ENDPOINTS
  // ============================================================

  // GET /api/presentations/:id/analytics
  const overviewMatch = path.match(/^\/api\/presentations\/([^/]+)\/analytics$/);
  if (req.method === 'GET' && overviewMatch) {
    return handleOverview(ctx, overviewMatch[1]);
  }

  // GET /api/presentations/:id/analytics/slides
  const slidesMatch = path.match(/^\/api\/presentations\/([^/]+)\/analytics\/slides$/);
  if (req.method === 'GET' && slidesMatch) {
    return handleSlides(ctx, slidesMatch[1]);
  }

  // GET /api/presentations/:id/analytics/heatmap
  const heatmapMatch = path.match(/^\/api\/presentations\/([^/]+)\/analytics\/heatmap$/);
  if (req.method === 'GET' && heatmapMatch) {
    return handleHeatmap(ctx, heatmapMatch[1]);
  }

  // GET /api/presentations/:id/analytics/journey
  const journeyMatch = path.match(/^\/api\/presentations\/([^/]+)\/analytics\/journey$/);
  if (req.method === 'GET' && journeyMatch) {
    return handleJourney(ctx, journeyMatch[1]);
  }

  // GET /api/presentations/:id/analytics/sessions
  const sessionsMatch = path.match(/^\/api\/presentations\/([^/]+)\/analytics\/sessions$/);
  if (req.method === 'GET' && sessionsMatch) {
    return handleSessions(ctx, sessionsMatch[1]);
  }

  // GET /api/presentations/:id/analytics/realtime (SSE)
  const realtimeMatch = path.match(/^\/api\/presentations\/([^/]+)\/analytics\/realtime$/);
  if (req.method === 'GET' && realtimeMatch) {
    return handleRealtime(ctx, realtimeMatch[1]);
  }

  // ============================================================
  // REPORT CRUD ENDPOINTS
  // ============================================================

  // GET/POST /api/presentations/:id/analytics/reports
  const listReportsMatch = path.match(/^\/api\/presentations\/([^/]+)\/analytics\/reports$/);
  if (listReportsMatch) {
    const presentationId = listReportsMatch[1];
    if (req.method === 'GET') {
      return handleListReports(ctx, presentationId);
    }
    if (req.method === 'POST') {
      return handleCreateReport(ctx, presentationId, rateLimitKey);
    }
  }

  // GET/PATCH/DELETE /api/presentations/:id/analytics/reports/:reportId
  const reportMatch = path.match(/^\/api\/presentations\/([^/]+)\/analytics\/reports\/([^/]+)$/);
  if (reportMatch) {
    const presentationId = reportMatch[1];
    const reportId = reportMatch[2];
    if (req.method === 'GET') {
      return handleGetReport(ctx, presentationId, reportId);
    }
    if (req.method === 'PATCH') {
      return handleUpdateReport(ctx, presentationId, reportId);
    }
    if (req.method === 'DELETE') {
      return handleDeleteReport(ctx, presentationId, reportId);
    }
  }

  // POST /api/presentations/:id/analytics/reports/:reportId/regenerate-token
  const regenerateMatch = path.match(/^\/api\/presentations\/([^/]+)\/analytics\/reports\/([^/]+)\/regenerate-token$/);
  if (req.method === 'POST' && regenerateMatch) {
    return handleRegenerateToken(ctx, regenerateMatch[1], regenerateMatch[2]);
  }

  // ============================================================
  // GDPR DATA ACCESS ENDPOINTS
  // ============================================================

  if (req.method === 'GET' && path === '/api/analytics/my-data') {
    return handleExportMyData(ctx);
  }

  if (req.method === 'DELETE' && path === '/api/analytics/my-data') {
    return handleDeleteMyData(ctx);
  }

  return false;
}

// Re-export public handler
export { handleAnalyticsReportPublic } from './public.js';
