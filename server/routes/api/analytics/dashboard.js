/**
 * Analytics dashboard endpoints.
 */

import { sendErrorResponse, sendSuccessResponse } from '../../../analytics/helpers.js';
import {
  getDashboardSummary,
  getDashboardTimeline,
  getTopPresentations,
  getSourceBreakdown,
  getPresentationsWithAnalytics,
} from '../../../storage/analytics/dashboard.js';

const VALID_PERIODS = ['7d', '30d', '90d', '12m'];
const VALID_CATEGORIES = ['all', 'internal', 'external'];
const VALID_SORTS = ['views', 'duration', 'completion', 'recent'];

/**
 * GET /api/analytics/dashboard - Get combined analytics dashboard.
 */
export async function handleDashboard(ctx) {
  const { res, url, authedUser } = ctx;

  if (!authedUser?.email) {
    return sendErrorResponse(res, 401, 'Authentication required'), true;
  }

  const period = url.searchParams.get('period') || '30d';
  const category = url.searchParams.get('category') || 'all';

  if (!VALID_PERIODS.includes(period)) {
    return sendErrorResponse(res, 400, 'Invalid period. Use 7d, 30d, 90d, or 12m'), true;
  }

  if (!VALID_CATEGORIES.includes(category)) {
    return sendErrorResponse(res, 400, 'Invalid category. Use all, internal, or external'), true;
  }

  const opts = { period, category };

  // Fetch all dashboard data in parallel
  const [summary, timeline, topPresentations, sourceBreakdown] = await Promise.all([
    getDashboardSummary(authedUser.email, authedUser.organizationId, opts),
    getDashboardTimeline(authedUser.email, authedUser.organizationId, opts),
    getTopPresentations(authedUser.email, authedUser.organizationId, { ...opts, limit: 10 }),
    getSourceBreakdown(authedUser.email, authedUser.organizationId, opts),
  ]);

  return sendSuccessResponse(res, {
    summary: summary.summary,
    trend: summary.trend,
    timeline,
    topPresentations,
    sourceBreakdown,
  }), true;
}

/**
 * GET /api/analytics/presentations - Get presentations with analytics summary.
 */
export async function handlePresentationsList(ctx) {
  const { res, url, authedUser } = ctx;

  if (!authedUser?.email) {
    return sendErrorResponse(res, 401, 'Authentication required'), true;
  }

  const period = url.searchParams.get('period') || '30d';
  const sort = url.searchParams.get('sort') || 'views';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  if (!VALID_PERIODS.includes(period)) {
    return sendErrorResponse(res, 400, 'Invalid period. Use 7d, 30d, 90d, or 12m'), true;
  }

  if (!VALID_SORTS.includes(sort)) {
    return sendErrorResponse(res, 400, 'Invalid sort. Use views, duration, completion, or recent'), true;
  }

  const result = await getPresentationsWithAnalytics(
    authedUser.email,
    authedUser.organizationId,
    { period, sort, limit, offset }
  );

  return sendSuccessResponse(res, result), true;
}
