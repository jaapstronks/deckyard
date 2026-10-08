/**
 * Dashboard analytics storage for combined insights across all user presentations.
 * Provides aggregated metrics for the user's engagement dashboard.
 */

import { sql } from 'kysely';
import { withDbGuard } from '../utils/index.js';
import { applyDateFilters } from '../../analytics/helpers.js';
import { completionRate, getCompletionCounts } from './aggregations.js';

// ============================================================
// PERIOD HELPERS
// ============================================================

/**
 * Get date range for a given period string.
 * @param {string} period - '7d' | '30d' | '90d' | '12m'
 * @returns {{ since: string, until: string }}
 */
function getPeriodDateRange(period) {
  const now = new Date();
  const until = now.toISOString();
  let since;

  switch (period) {
    case '7d':
      since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      break;
    case '30d':
      since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      break;
    case '90d':
      since = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
      break;
    case '12m':
      since = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
      break;
    default:
      since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  return { since, until };
}

/**
 * Get previous period date range for comparison.
 * @param {string} period - '7d' | '30d' | '90d' | '12m'
 * @returns {{ since: string, until: string }}
 */
function getPreviousPeriodDateRange(period) {
  const current = getPeriodDateRange(period);
  const currentStart = new Date(current.since);
  const currentEnd = new Date(current.until);
  const durationMs = currentEnd.getTime() - currentStart.getTime();

  return {
    since: new Date(currentStart.getTime() - durationMs).toISOString(),
    until: current.since,
  };
}

// ============================================================
// DASHBOARD AGGREGATION QUERIES
// ============================================================

/**
 * Get combined analytics summary across all user presentations.
 * @param {string} userEmail - The user's email
 * @param {string} organizationId - The user's organization ID
 * @param {Object} opts - Query options
 * @param {string} opts.period - '7d' | '30d' | '90d' | '12m'
 * @returns {Promise<Object>}
 */
export async function getDashboardSummary(
  userEmail,
  organizationId,
  opts = {},
) {
  const period = opts.period || '30d';
  const dateRange = getPeriodDateRange(period);
  const previousRange = getPreviousPeriodDateRange(period);

  return withDbGuard(
    {
      summary: {
        totalViews: 0,
        uniqueViewers: 0,
        avgDurationSeconds: 0,
        completionRate: 0,
      },
      trend: { percentChange: 0, direction: 'flat' },
    },
    async (db) => {
      // Get user's presentations (owned + shared with edit/admin access)
      const userPresentations = await getUserPresentationIds(
        db,
        userEmail,
        organizationId,
      );
      if (!userPresentations.length) {
        return {
          summary: {
            totalViews: 0,
            uniqueViewers: 0,
            avgDurationSeconds: 0,
            completionRate: 0,
          },
          trend: { percentChange: 0, direction: 'flat' },
        };
      }

      // Build base query for current period
      let currentQuery = db
        .selectFrom('view_sessions')
        .select([
          (eb) => eb.fn.count('id').as('total_views'),
          sql`COUNT(DISTINCT COALESCE(device_id, id::text))`.as(
            'unique_viewers',
          ),
          (eb) => eb.fn.avg('duration_seconds').as('avg_duration'),
        ])
        .where('presentation_id', 'in', userPresentations);

      // Apply date filters
      currentQuery = applyDateFilters(currentQuery, dateRange);

      const currentResult = await currentQuery.executeTakeFirst();

      // Get previous period for comparison
      let previousQuery = db
        .selectFrom('view_sessions')
        .select((eb) => eb.fn.count('id').as('total_views'))
        .where('presentation_id', 'in', userPresentations);

      previousQuery = applyDateFilters(previousQuery, previousRange);

      const previousResult = await previousQuery.executeTakeFirst();

      const completion = await getCompletionCounts(
        db,
        userPresentations,
        dateRange,
      );

      const currentViews = Number(currentResult?.total_views) || 0;
      const previousViews = Number(previousResult?.total_views) || 0;

      let percentChange = 0;
      let direction = 'flat';
      if (previousViews > 0) {
        percentChange = Math.round(
          ((currentViews - previousViews) / previousViews) * 100,
        );
        direction =
          percentChange > 0 ? 'up' : percentChange < 0 ? 'down' : 'flat';
      } else if (currentViews > 0) {
        percentChange = 100;
        direction = 'up';
      }

      return {
        summary: {
          totalViews: currentViews,
          uniqueViewers: Number(currentResult?.unique_viewers) || 0,
          avgDurationSeconds: Math.round(
            Number(currentResult?.avg_duration) || 0,
          ),
          completionRate: completionRate(completion.values()),
        },
        trend: {
          percentChange: Math.abs(percentChange),
          direction,
        },
      };
    },
  );
}

/**
 * Get timeline data for the dashboard chart.
 * @param {string} userEmail - The user's email
 * @param {string} organizationId - The user's organization ID
 * @param {Object} opts - Query options
 * @returns {Promise<Array<{date: string, views: number, uniqueViewers: number}>>}
 */
export async function getDashboardTimeline(
  userEmail,
  organizationId,
  opts = {},
) {
  const period = opts.period || '30d';
  const dateRange = getPeriodDateRange(period);

  return withDbGuard([], async (db) => {
    const userPresentations = await getUserPresentationIds(
      db,
      userEmail,
      organizationId,
    );
    if (!userPresentations.length) return [];

    let query = db
      .selectFrom('view_sessions')
      .select([
        sql`date_trunc('day', started_at)::date`.as('date'),
        (eb) => eb.fn.count('id').as('views'),
        sql`COUNT(DISTINCT COALESCE(device_id, id::text))`.as('unique_viewers'),
      ])
      .where('presentation_id', 'in', userPresentations)
      .groupBy(sql`date_trunc('day', started_at)`)
      .orderBy(sql`date_trunc('day', started_at)`, 'asc');

    query = applyDateFilters(query, dateRange);

    const rows = await query.execute();

    return rows.map((row) => ({
      date: row.date?.toISOString?.()?.split('T')[0] || String(row.date),
      views: Number(row.views) || 0,
      uniqueViewers: Number(row.unique_viewers) || 0,
    }));
  });
}

/**
 * Get top performing presentations for the dashboard.
 * @param {string} userEmail - The user's email
 * @param {string} organizationId - The user's organization ID
 * @param {Object} opts - Query options
 * @returns {Promise<Array>}
 */
export async function getTopPresentations(
  userEmail,
  organizationId,
  opts = {},
) {
  const period = opts.period || '30d';
  const limit = opts.limit || 10;
  const dateRange = getPeriodDateRange(period);

  return withDbGuard([], async (db) => {
    const userPresentations = await getUserPresentationIds(
      db,
      userEmail,
      organizationId,
    );
    if (!userPresentations.length) return [];

    let query = db
      .selectFrom('view_sessions')
      .innerJoin(
        'presentations',
        'presentations.id',
        'view_sessions.presentation_id',
      )
      .select([
        'presentations.id',
        'presentations.title',
        (eb) => eb.fn.count('view_sessions.id').as('views'),
        sql`COUNT(DISTINCT COALESCE(view_sessions.device_id, view_sessions.id::text))`.as(
          'unique_viewers',
        ),
        (eb) => eb.fn.avg('view_sessions.duration_seconds').as('avg_duration'),
      ])
      .where('view_sessions.presentation_id', 'in', userPresentations)
      .groupBy(['presentations.id', 'presentations.title'])
      .orderBy((eb) => eb.fn.count('view_sessions.id'), 'desc')
      .limit(limit);

    query = applyDateFilters(query, dateRange, 'view_sessions.started_at');

    const rows = await query.execute();
    const completion = await getCompletionCounts(
      db,
      rows.map((row) => row.id),
      dateRange,
    );

    return rows.map((row) => ({
      id: row.id,
      title: row.title || 'Untitled',
      views: Number(row.views) || 0,
      uniqueViewers: Number(row.unique_viewers) || 0,
      avgDurationSeconds: Math.round(Number(row.avg_duration) || 0),
      completionRate: deckCompletionRate(completion, row.id),
    }));
  });
}

/**
 * Get source breakdown for the dashboard.
 * @param {string} userEmail - The user's email
 * @param {string} organizationId - The user's organization ID
 * @param {Object} opts - Query options
 * @returns {Promise<Object>}
 */
export async function getSourceBreakdown(userEmail, organizationId, opts = {}) {
  const period = opts.period || '30d';
  const dateRange = getPeriodDateRange(period);

  return withDbGuard(
    {
      shareLink: 0,
      published: 0,
      follow: 0,
      embed: 0,
    },
    async (db) => {
      const userPresentations = await getUserPresentationIds(
        db,
        userEmail,
        organizationId,
      );
      if (!userPresentations.length) {
        return { shareLink: 0, published: 0, follow: 0, embed: 0 };
      }

      let query = db
        .selectFrom('view_sessions')
        .select(['source_type', (eb) => eb.fn.count('id').as('count')])
        .where('presentation_id', 'in', userPresentations)
        .groupBy('source_type');

      query = applyDateFilters(query, dateRange);

      const rows = await query.execute();

      const breakdown = {
        shareLink: 0,
        published: 0,
        follow: 0,
        embed: 0,
      };

      for (const row of rows) {
        const sourceType = row.source_type;
        const count = Number(row.count) || 0;

        switch (sourceType) {
          case 'share_link':
            breakdown.shareLink = count;
            break;
          case 'published':
            breakdown.published = count;
            break;
          case 'follow':
            breakdown.follow = count;
            break;
          case 'embed':
            breakdown.embed = count;
            break;
        }
      }

      return breakdown;
    },
  );
}

/**
 * How `getPresentationsWithAnalytics()` can order its rows, keyed by the
 * `sort` value. Every order is one SQL `ORDER BY` over the joined sessions, so
 * the page is cut in the database. Completion is not here: it comes from
 * `slide_views` after the page is cut (`getCompletionCounts`), so ordering on
 * it would mean reading every deck's completion first (B622).
 */
const LIST_ORDERS = {
  views: (query) =>
    query.orderBy((eb) => eb.fn.count('view_sessions.id'), 'desc'),
  duration: (query) =>
    query.orderBy((eb) => eb.fn.avg('view_sessions.duration_seconds'), 'desc'),
  recent: (query) => query.orderBy('presentations.modified_at', 'desc'),
};

/** The `sort` values `getPresentationsWithAnalytics()` accepts. */
export const ANALYTICS_LIST_SORTS = Object.freeze(Object.keys(LIST_ORDERS));

/**
 * Get presentations list with analytics summary for the dashboard.
 * @param {string} userEmail - The user's email
 * @param {string} organizationId - The user's organization ID
 * @param {Object} opts - Query options; `sort` is one of
 *   `ANALYTICS_LIST_SORTS` (default `views`), anything else throws.
 * @returns {Promise<Array>}
 */
export async function getPresentationsWithAnalytics(
  userEmail,
  organizationId,
  opts = {},
) {
  const period = opts.period || '30d';
  const sort = opts.sort || 'views';
  const order = LIST_ORDERS[sort];
  if (!order) throw new Error(`Unknown analytics list sort: ${sort}`);
  const limit = opts.limit || 20;
  const offset = opts.offset || 0;
  const dateRange = getPeriodDateRange(period);

  return withDbGuard({ presentations: [], total: 0 }, async (db) => {
    const userPresentations = await getUserPresentationIds(
      db,
      userEmail,
      organizationId,
    );
    if (!userPresentations.length) {
      return { presentations: [], total: 0 };
    }

    // Get total count
    const countResult = await db
      .selectFrom('presentations')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('id', 'in', userPresentations)
      .executeTakeFirst();

    const total = Number(countResult?.count) || 0;

    // Get presentations with analytics
    let query = db
      .selectFrom('presentations')
      .leftJoin('view_sessions', (join) =>
        join
          .onRef('view_sessions.presentation_id', '=', 'presentations.id')
          .on('view_sessions.started_at', '>=', dateRange.since)
          .on('view_sessions.started_at', '<=', dateRange.until),
      )
      .select([
        'presentations.id',
        'presentations.title',
        'presentations.modified_at',
        (eb) => eb.fn.count('view_sessions.id').as('views'),
        sql`COUNT(DISTINCT COALESCE(view_sessions.device_id, view_sessions.id::text))`.as(
          'unique_viewers',
        ),
        (eb) => eb.fn.avg('view_sessions.duration_seconds').as('avg_duration'),
      ])
      .where('presentations.id', 'in', userPresentations)
      .groupBy([
        'presentations.id',
        'presentations.title',
        'presentations.modified_at',
      ]);

    query = order(query);

    query = query.limit(limit).offset(offset);

    const rows = await query.execute();
    const completion = await getCompletionCounts(
      db,
      rows.map((row) => row.id),
      dateRange,
    );

    return {
      presentations: rows.map((row) => ({
        id: row.id,
        title: row.title || 'Untitled',
        updatedAt: row.modified_at,
        views: Number(row.views) || 0,
        uniqueViewers: Number(row.unique_viewers) || 0,
        avgDurationSeconds: Math.round(Number(row.avg_duration) || 0),
        completionRate: deckCompletionRate(completion, row.id),
      })),
      total,
      limit,
      offset,
    };
  });
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * One deck's completion rate out of a `getCompletionCounts()` map.
 * @param {Map<string, {sessions: number, completed: number}>} completion
 * @param {string} id - The presentation ID.
 * @returns {number}
 */
function deckCompletionRate(completion, id) {
  const counts = completion.get(id);
  return completionRate(counts ? [counts] : []);
}

/**
 * Get presentation IDs that a user has access to (owned + shared with edit/admin).
 * @param {Object} db - Database connection
 * @param {string} userEmail - The user's email
 * @param {string} organizationId - The user's organization ID
 * @returns {Promise<string[]>}
 */
async function getUserPresentationIds(db, userEmail, organizationId) {
  // Get presentations where user is owner
  const ownedQuery = db
    .selectFrom('presentations')
    .select('id')
    .where('owner_email', '=', userEmail.toLowerCase());

  // Get presentations shared with user (edit or admin access)
  const sharedQuery = db
    .selectFrom('presentation_collaborators')
    .innerJoin(
      'presentations',
      'presentations.id',
      'presentation_collaborators.presentation_id',
    )
    .select('presentations.id')
    .where(
      'presentation_collaborators.user_email',
      '=',
      userEmail.toLowerCase(),
    )
    .where('presentation_collaborators.permission', 'in', ['edit', 'admin']);

  const [ownedRows, sharedRows] = await Promise.all([
    ownedQuery.execute(),
    sharedQuery.execute(),
  ]);

  const ids = new Set([
    ...ownedRows.map((r) => r.id),
    ...sharedRows.map((r) => r.id),
  ]);

  return Array.from(ids);
}
