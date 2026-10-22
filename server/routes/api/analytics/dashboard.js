/**
 * Analytics dashboard endpoints.
 */

import { jsonError, serveJson, unauthorized } from '../../../utils/http.js';
import { listPageResult, parseListPage } from '../../../services/list-page.js';
import {
  getDashboardSummary,
  getDashboardTimeline,
  getTopPresentations,
  getSourceBreakdown,
  listDashboardPresentations,
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
      getDashboardSummary(
        ctx.storageScope,
        authedUser.email,
        authedUser.organizationId,
        opts,
      ),
      getDashboardTimeline(
        ctx.storageScope,
        authedUser.email,
        authedUser.organizationId,
        opts,
      ),
      getTopPresentations(
        ctx.storageScope,
        authedUser.email,
        authedUser.organizationId,
        {
          ...opts,
          limit: 10,
        },
      ),
      getSourceBreakdown(
        ctx.storageScope,
        authedUser.email,
        authedUser.organizationId,
        opts,
      ),
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
 * GET /api/analytics/presentations - One page of the dashboard's decks with
 * their analytics over `period` (list-page contract, D358): `{ limit, cursor }`
 * in, `{ presentations, nextCursor }` out, in the one deck-list order, last
 * change first. `period` is the cursor's fingerprint. The retired `sort`
 * (`views`, `duration`, `recent`) is refused with 400 `invalid`,
 * `details.field = 'sort'`: a ranking by views is the dashboard's
 * `topPresentations`, not a list order.
 */
export async function handlePresentationsList(ctx) {
  const { res, url, authedUser } = ctx;

  if (!authedUser?.email) {
    return unauthorized(res, 'Authentication required');
  }

  const period = url.searchParams.get('period') || '30d';
  if (!VALID_PERIODS.includes(period)) {
    return invalidQuery(res, 'period', VALID_PERIODS);
  }
  if (url.searchParams.has('sort')) {
    return jsonError(
      res,
      400,
      'invalid',
      'Unknown parameter "sort": the list has one order, last change first',
      { details: { field: 'sort' } },
    );
  }
  const page = parseListPage(url.searchParams, {
    sortKey: 'modified_desc',
    filters: { period },
    defaultLimit: 20,
  });

  const result = await listDashboardPresentations(
    ctx.storageScope,
    authedUser.email,
    authedUser.organizationId,
    { period, limit: page.limit, after: page.after },
  );

  return (
    serveJson(res, 200, listPageResult('presentations', result, page)),
    true
  );
}
