/**
 * Analytics reports CRUD endpoints.
 */

import { json } from '../../../utils/http.js';
import { norm, validateDateRange } from '../../../utils/normalize.js';
import { parsePaginationParams } from '../../../utils/request-validators.js';
import { allowRequest } from '../../../utils/rate-limit.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';
import {
  AUTH_RATE_LIMITS,
  sendRateLimitResponse,
  sendErrorResponse,
  sendSuccessResponse,
  logSecurityEvent,
  SECURITY_EVENTS,
} from '../../../analytics/helpers.js';
import {
  createAnalyticsReport,
  getAnalyticsReport,
  listAnalyticsReports,
  updateAnalyticsReport,
  deleteAnalyticsReport,
  regenerateShareToken,
} from '../../../storage/analytics/reports.js';
import {
  getPresentationAnalyticsOverview,
  getDetailedSlideEngagement,
  getInteractionHeatmapData,
  getViewerJourneyData,
} from '../../../storage/analytics/aggregations.js';

/**
 * Generate report data based on type.
 */
async function generateReportData(presentationId, reportType, opts) {
  const overview = await getPresentationAnalyticsOverview(presentationId, opts);
  const journey = await getViewerJourneyData(presentationId, opts);

  const baseData = {
    overview,
    journey,
    generatedAt: new Date().toISOString(),
  };

  if (reportType === 'summary') {
    return baseData;
  }

  // Add slide engagement for detailed and engagement reports
  const slideEngagement = await getDetailedSlideEngagement(presentationId, opts);
  const heatmap = await getInteractionHeatmapData(presentationId, opts);

  if (reportType === 'detailed') {
    return {
      ...baseData,
      slideEngagement,
      heatmap,
    };
  }

  if (reportType === 'engagement') {
    return {
      ...baseData,
      slideEngagement,
      heatmap,
      // TODO: Add poll results, Q&A summary, feedback when integrated
    };
  }

  return baseData;
}

/**
 * GET /api/presentations/:id/analytics/reports - List reports.
 */
export async function handleListReports(ctx, presentationId) {
  const { res, url, authedUser } = ctx;

  const pres = await withPresentationAuth({
    repoRoot: ctx.repoRoot,
    id: presentationId,
    authedUser,
    res,
    permission: 'read',
  });
  if (!pres) return true;

  const { limit, offset } = parsePaginationParams(url.searchParams, { defaultLimit: 20 });

  const result = await listAnalyticsReports(presentationId, ctx, { limit, offset });
  return sendSuccessResponse(res, result), true;
}

/**
 * POST /api/presentations/:id/analytics/reports - Create report.
 */
export async function handleCreateReport(ctx, presentationId, rateLimitKey) {
  const { req, res, url, authedUser } = ctx;
  const path = url.pathname;

  // Stricter rate limit for report creation (expensive operation)
  if (!(await allowRequest(`analytics:report:create:${rateLimitKey}`, AUTH_RATE_LIMITS.expensive))) {
    logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
      endpoint: path,
      user: authedUser?.email,
      limitType: 'reportCreate',
    });
    return sendRateLimitResponse(res, 'Rate limit exceeded for report creation', 5), true;
  }

  const pres = await withPresentationAuth({
    repoRoot: ctx.repoRoot,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  let body;
  try {
    body = await json(req);
  } catch (err) {
    return sendErrorResponse(res, 400, 'Invalid JSON body'), true;
  }

  const title = norm(body?.title);
  const reportType = norm(body?.reportType) || 'summary';
  const startDate = norm(body?.startDate);
  const endDate = norm(body?.endDate);

  if (!title || !startDate || !endDate) {
    return sendErrorResponse(res, 400, 'Missing required fields'), true;
  }

  // Validate report type
  const validReportTypes = ['summary', 'detailed', 'engagement'];
  if (!validReportTypes.includes(reportType)) {
    return sendErrorResponse(res, 400, 'Invalid report type'), true;
  }

  // Validate date range
  const dateValidation = validateDateRange(startDate, endDate);
  if (!dateValidation.valid) {
    return sendErrorResponse(res, 400, dateValidation.error), true;
  }

  // Generate report data
  const reportData = await generateReportData(presentationId, reportType, { since: startDate, until: endDate });

  const result = await createAnalyticsReport({
    presentationId,
    title,
    reportType,
    startDate,
    endDate,
    reportData,
    isPublic: body?.isPublic ?? false,
    expiresInDays: body?.expiresInDays ?? null,
    createdBy: authedUser?.email ?? 'unknown',
  }, ctx);

  if (!result.ok) {
    return sendErrorResponse(res, 500, result.reason || 'Failed to create report'), true;
  }

  return sendSuccessResponse(res, result.report), true;
}

/**
 * GET /api/presentations/:id/analytics/reports/:reportId - Get single report.
 */
export async function handleGetReport(ctx, presentationId, reportId) {
  const { res, authedUser } = ctx;

  const pres = await withPresentationAuth({
    repoRoot: ctx.repoRoot,
    id: presentationId,
    authedUser,
    res,
    permission: 'read',
  });
  if (!pres) return true;

  const report = await getAnalyticsReport(reportId, ctx);

  if (!report) {
    return sendErrorResponse(res, 404, 'Report not found'), true;
  }

  // Verify report belongs to the presentation
  if (report.presentationId !== presentationId) {
    return sendErrorResponse(res, 404, 'Report not found'), true;
  }

  return sendSuccessResponse(res, report), true;
}

/**
 * PATCH /api/presentations/:id/analytics/reports/:reportId - Update report.
 */
export async function handleUpdateReport(ctx, presentationId, reportId) {
  const { req, res, authedUser } = ctx;

  const pres = await withPresentationAuth({
    repoRoot: ctx.repoRoot,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  let body;
  try {
    body = await json(req);
  } catch (err) {
    return sendErrorResponse(res, 400, 'Invalid JSON body'), true;
  }

  const result = await updateAnalyticsReport(reportId, body, ctx);

  if (!result.ok) {
    const statusCode = result.reason === 'not_found' ? 404 : 500;
    return sendErrorResponse(res, statusCode, result.reason || 'Failed to update report'), true;
  }

  return sendSuccessResponse(res, { ok: true }), true;
}

/**
 * DELETE /api/presentations/:id/analytics/reports/:reportId - Delete report.
 */
export async function handleDeleteReport(ctx, presentationId, reportId) {
  const { res, authedUser } = ctx;

  const pres = await withPresentationAuth({
    repoRoot: ctx.repoRoot,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  const result = await deleteAnalyticsReport(reportId, ctx);

  if (!result.ok) {
    const statusCode = result.reason === 'not_found' ? 404 : 500;
    return sendErrorResponse(res, statusCode, result.reason || 'Failed to delete report'), true;
  }

  return sendSuccessResponse(res, { ok: true }), true;
}

/**
 * POST /api/presentations/:id/analytics/reports/:reportId/regenerate-token - Regenerate share token.
 */
export async function handleRegenerateToken(ctx, presentationId, reportId) {
  const { res, authedUser } = ctx;

  const pres = await withPresentationAuth({
    repoRoot: ctx.repoRoot,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  const result = await regenerateShareToken(reportId, ctx);

  if (!result.ok) {
    const statusCode = result.reason === 'not_found' ? 404 : 500;
    return sendErrorResponse(res, statusCode, result.reason || 'Failed to regenerate token'), true;
  }

  return sendSuccessResponse(res, { shareToken: result.shareToken }), true;
}
