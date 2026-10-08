/**
 * Analytics dashboard endpoints.
 */

import { jsonError, serveJson, unauthorized } from '../../../utils/http.js';
import {
  getDashboardSummary,
  getDashboardTimeline,
  getTopPresentations,
  getSourceBreakdown,
  getPresentationsWithAnalytics,
  ANALYTICS_LIST_SORTS,
} from '../../../storage/analytics/index.js';

const VALID_PERIODS = ['7d', '30d', '90d', '12m'];

/**
 * Refuse a query value outside its vocabulary, naming the parameter. An
 * unknown value is never read as the default (les 3, B622).
 */
function invalidQuery(res, field, allowed) {
  return jsonError(
    res,
    400,
    'invalid',
    `Invalid ${field}. Use ${allowed.join(', ')}`,
    { details: { field } },
  );
}

/**
 * GET /api/analytics/dashboard - Get combined analytics dashboard.
 */
export async function handleDashboard(ctx) {
  const { res, url, authedUser } = ctx;

  if (!authedUser?.email) {
    return unauthorized(res, 'Authentication required');
  }

  const period = url.searchParams.get('period') || '30d';

  if (!VALID_PERIODS.includes(period)) {
    return invalidQuery(res, 'period', VALID_PERIODS);
  }

  const opts = { period };

  // Fetch all dashboard data in parallel
  const [summary, timeline, topPresentations, sourceBreakdown] =
    await Promise.all([
      getDashboardSummary(authedUser.email, authedUser.organizationId, opts),
      getDashboardTimeline(authedUser.email, authedUser.organizationId, opts),
      getTopPresentations(authedUser.email, authedUser.organizationId, {
        ...opts,
        limit: 10,
      }),
      getSourceBreakdown(authedUser.email, authedUser.organizationId, opts),
    ]);

  return (
    serveJson(res, 200, {
      summary: summary.summary,
      trend: summary.trend,
      timeline,
      topPresentations,
      sourceBreakdown,
    }),
    true
  );
}

/**
 * GET /api/analytics/presentations - Get presentations with analytics summary.
 * `sort` is `views` (default), `duration` or `recent`; anything else,
 * `completion` included, is 400 `invalid` with `details.field = 'sort'`.
 */
export async function handlePresentationsList(ctx) {
  const { res, url, authedUser } = ctx;

  if (!authedUser?.email) {
    return unauthorized(res, 'Authentication required');
  }

  const period = url.searchParams.get('period') || '30d';
  const sort = url.searchParams.get('sort') || 'views';
  const limit = Math.min(
    parseInt(url.searchParams.get('limit') || '20', 10),
    100,
  );
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  if (!VALID_PERIODS.includes(period)) {
    return invalidQuery(res, 'period', VALID_PERIODS);
  }

  // `completion` is not a sort: the rate is computed after the page is cut
  // (B622, see `ANALYTICS_LIST_SORTS`).
  if (!ANALYTICS_LIST_SORTS.includes(sort)) {
    return invalidQuery(res, 'sort', ANALYTICS_LIST_SORTS);
  }

  const result = await getPresentationsWithAnalytics(
    authedUser.email,
    authedUser.organizationId,
    { period, sort, limit, offset },
  );

  return (serveJson(res, 200, result), true);
}
