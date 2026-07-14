/**
 * Presentation-specific analytics metrics endpoints.
 */

import { extractValidatedDateRange, parsePaginationParams } from '../../../utils/request-validators.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';
import { sendErrorResponse, sendSuccessResponse } from '../../../analytics/helpers.js';
import { getViewSessionsForPresentation } from '../../../storage/analytics/view-sessions.js';
import {
  getPresentationAnalyticsOverview,
  getDetailedSlideEngagement,
  getInteractionHeatmapData,
  getViewerJourneyData,
} from '../../../storage/analytics/aggregations.js';

/**
 * GET /api/presentations/:id/analytics - Get overview metrics.
 */
export async function handleOverview(ctx, presentationId) {
  const { res, url, authedUser } = ctx;

  const pres = await withPresentationAuth({
    repoRoot: ctx.repoRoot,
    id: presentationId,
    authedUser,
    res,
    permission: 'read',
  });
  if (!pres) return true;

  const dateRange = extractValidatedDateRange(url.searchParams, res, {
    sendError: (r, msg) => sendErrorResponse(r, 400, msg),
  });
  if (!dateRange) return true;

  const overview = await getPresentationAnalyticsOverview(presentationId, dateRange);
  return sendSuccessResponse(res, overview), true;
}

/**
 * GET /api/presentations/:id/analytics/slides - Get per-slide engagement.
 */
export async function handleSlides(ctx, presentationId) {
  const { res, url, authedUser } = ctx;

  const pres = await withPresentationAuth({
    repoRoot: ctx.repoRoot,
    id: presentationId,
    authedUser,
    res,
    permission: 'read',
  });
  if (!pres) return true;

  const dateRange = extractValidatedDateRange(url.searchParams, res, {
    sendError: (r, msg) => sendErrorResponse(r, 400, msg),
  });
  if (!dateRange) return true;

  const slides = await getDetailedSlideEngagement(presentationId, dateRange);
  return sendSuccessResponse(res, { slides }), true;
}

/**
 * GET /api/presentations/:id/analytics/heatmap - Get interaction heatmap.
 */
export async function handleHeatmap(ctx, presentationId) {
  const { res, url, authedUser } = ctx;

  const pres = await withPresentationAuth({
    repoRoot: ctx.repoRoot,
    id: presentationId,
    authedUser,
    res,
    permission: 'read',
  });
  if (!pres) return true;

  const dateRange = extractValidatedDateRange(url.searchParams, res, {
    sendError: (r, msg) => sendErrorResponse(r, 400, msg),
  });
  if (!dateRange) return true;

  const heatmap = await getInteractionHeatmapData(presentationId, dateRange);
  return sendSuccessResponse(res, { slides: heatmap }), true;
}

/**
 * GET /api/presentations/:id/analytics/journey - Get viewer journey data.
 */
export async function handleJourney(ctx, presentationId) {
  const { res, url, authedUser } = ctx;

  const pres = await withPresentationAuth({
    repoRoot: ctx.repoRoot,
    id: presentationId,
    authedUser,
    res,
    permission: 'read',
  });
  if (!pres) return true;

  const dateRange = extractValidatedDateRange(url.searchParams, res, {
    sendError: (r, msg) => sendErrorResponse(r, 400, msg),
  });
  if (!dateRange) return true;

  const journey = await getViewerJourneyData(presentationId, dateRange);
  return sendSuccessResponse(res, journey), true;
}

/**
 * GET /api/presentations/:id/analytics/sessions - Get viewer session list.
 */
export async function handleSessions(ctx, presentationId) {
  const { res, url, authedUser } = ctx;

  const pres = await withPresentationAuth({
    repoRoot: ctx.repoRoot,
    id: presentationId,
    authedUser,
    res,
    permission: 'read',
  });
  if (!pres) return true;

  const { limit, offset } = parsePaginationParams(url.searchParams);
  const dateRange = extractValidatedDateRange(url.searchParams, res, {
    sendError: (r, msg) => sendErrorResponse(r, 400, msg),
  });
  if (!dateRange) return true;

  const result = await getViewSessionsForPresentation(presentationId, {
    limit,
    offset,
    ...dateRange,
  });

  return sendSuccessResponse(res, result), true;
}
