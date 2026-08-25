/**
 * Analytics reports CRUD endpoints.
 */

import {
  badRequest,
  notFound,
  rateLimited,
  requireJsonBody,
  serveJson,
  storageError,
} from '../../../utils/http.js';
import { norm, validateDateRange } from '../../../utils/normalize.js';
import { parsePaginationParams } from '../../../utils/request-validators.js';
import { allowRequest, getClientIp } from '../../../utils/rate-limit.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';
import {
  logSecurityEvent,
  SECURITY_EVENTS,
} from '../../../analytics/helpers.js';
import { AUTH_RATE_LIMITS } from '../../../config/rate-limits.js';
import {
  createAnalyticsReport,
  getAnalyticsReport,
  listAnalyticsReports,
  updateAnalyticsReport,
  deleteAnalyticsReport,
  regenerateShareToken,
  getPresentationAnalyticsOverview,
  getDetailedSlideEngagement,
  getInteractionHeatmapData,
  getViewerJourneyData,
} from '../../../storage/analytics/index.js';

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
  const slideEngagement = await getDetailedSlideEngagement(
    presentationId,
    opts,
  );
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
    storageScope: ctx.storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'read',
  });
  if (!pres) return true;

  const { limit, offset } = parsePaginationParams(url.searchParams, {
    defaultLimit: 20,
  });

  const result = await listAnalyticsReports(ctx.storageScope, presentationId, {
    limit,
    offset,
  });
  return (serveJson(res, 200, result), true);
}

/**
 * POST /api/presentations/:id/analytics/reports - Create report.
 */
export async function handleCreateReport(ctx, presentationId) {
  const { req, res, url, authedUser } = ctx;
  const path = url.pathname;

  // Re-derive the same rate-limit key the module entry function uses, rather
  // than threading it through the ROUTES table as a positional argument
  // (A7.19 C8). Identical to `analytics/index.js`'s derivation.
  const rateLimitKey = authedUser?.email || authedUser?.id || getClientIp(req);

  // Stricter rate limit for report creation (expensive operation)
  if (
    !(await allowRequest(
      `analytics:report:create:${rateLimitKey}`,
      AUTH_RATE_LIMITS.expensive,
    ))
  ) {
    logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
      endpoint: path,
      user: authedUser?.email,
      limitType: 'reportCreate',
    });
    return rateLimited(res, 5, 'Rate limit exceeded for report creation');
  }

  const pres = await withPresentationAuth({
    storageScope: ctx.storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;

  const title = norm(body?.title);
  const reportType = norm(body?.reportType) || 'summary';
  const startDate = norm(body?.startDate);
  const endDate = norm(body?.endDate);

  if (!title || !startDate || !endDate) {
    return badRequest(res, 'Missing required fields');
  }

  // Validate report type
  const validReportTypes = ['summary', 'detailed', 'engagement'];
  if (!validReportTypes.includes(reportType)) {
    return badRequest(res, 'Invalid report type');
  }

  // Validate date range
  const dateValidation = validateDateRange(startDate, endDate);
  if (!dateValidation.valid) {
    return badRequest(res, dateValidation.error);
  }

  // Generate report data
  const reportData = await generateReportData(presentationId, reportType, {
    since: startDate,
    until: endDate,
  });

  const result = await createAnalyticsReport(ctx.storageScope, {
    presentationId,
    title,
    reportType,
    startDate,
    endDate,
    reportData,
    isPublic: body?.isPublic ?? false,
    expiresInDays: body?.expiresInDays ?? null,
    createdBy: authedUser?.email ?? 'unknown',
  });

  if (!result.ok) {
    return storageError(res, result, 'Failed to create report');
  }

  return (serveJson(res, 200, result.report), true);
}

/**
 * Load a report and require that it belongs to the given presentation.
 * The deck authorization already granted covers only this deck's reports, so a
 * report id from another deck is a 404 — for writes just as for reads.
 * Writes the 404 and returns null when the report is missing or foreign.
 *
 * @param {Object} ctx - Route context (storageScope, res)
 * @param {string} presentationId - The presentation the caller was authorized on
 * @param {string} reportId - The report ID from the path
 * @returns {Promise<Object|null>}
 */
async function requireReportOnPresentation(ctx, presentationId, reportId) {
  const report = await getAnalyticsReport(ctx.storageScope, reportId);
  if (!report || report.presentationId !== presentationId) {
    notFound(ctx.res, 'Report not found');
    return null;
  }
  return report;
}

/**
 * GET /api/presentations/:id/analytics/reports/:reportId - Get single report.
 */
export async function handleGetReport(ctx, presentationId, reportId) {
  const { res, authedUser } = ctx;

  const pres = await withPresentationAuth({
    storageScope: ctx.storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'read',
  });
  if (!pres) return true;

  const report = await requireReportOnPresentation(
    ctx,
    presentationId,
    reportId,
  );
  if (!report) return true;

  return (serveJson(res, 200, report), true);
}

/**
 * PATCH /api/presentations/:id/analytics/reports/:reportId - Update report.
 */
export async function handleUpdateReport(ctx, presentationId, reportId) {
  const { req, res, authedUser } = ctx;

  const pres = await withPresentationAuth({
    storageScope: ctx.storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  if (!(await requireReportOnPresentation(ctx, presentationId, reportId)))
    return true;

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;

  const result = await updateAnalyticsReport(ctx.storageScope, reportId, body);

  if (!result.ok) {
    return storageError(res, result, 'Failed to update report');
  }

  return (serveJson(res, 200, { ok: true }), true);
}

/**
 * DELETE /api/presentations/:id/analytics/reports/:reportId - Delete report.
 */
export async function handleDeleteReport(ctx, presentationId, reportId) {
  const { res, authedUser } = ctx;

  const pres = await withPresentationAuth({
    storageScope: ctx.storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  if (!(await requireReportOnPresentation(ctx, presentationId, reportId)))
    return true;

  const result = await deleteAnalyticsReport(ctx.storageScope, reportId);

  if (!result.ok) {
    return storageError(res, result, 'Failed to delete report');
  }

  return (serveJson(res, 200, { ok: true }), true);
}

/**
 * POST /api/presentations/:id/analytics/reports/:reportId/regenerate-token - Regenerate share token.
 */
export async function handleRegenerateToken(ctx, presentationId, reportId) {
  const { res, authedUser } = ctx;

  const pres = await withPresentationAuth({
    storageScope: ctx.storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  if (!(await requireReportOnPresentation(ctx, presentationId, reportId)))
    return true;

  const result = await regenerateShareToken(ctx.storageScope, reportId);

  if (!result.ok) {
    return storageError(res, result, 'Failed to regenerate token');
  }

  return (serveJson(res, 200, { shareToken: result.shareToken }), true);
}
