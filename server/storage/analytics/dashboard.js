import { toStorageContext } from '../scope.js';
/**
 * Dashboard analytics storage for combined insights across all user presentations.
 * Provides aggregated metrics for the user's engagement dashboard.
 */

import { sql } from 'kysely';
import { withDbGuard } from '../../db/client.js';
import { normalizeEmail } from '../../../shared/email.js';
import { applyDateFilters } from '../../analytics/helpers.js';
import { completionRate, getCompletionCounts } from './aggregations.js';
import { keysetPage, keysetRows } from '../keyset.js';

function requireDashboardOrganization(scope, organizationId, operation) {
  const context = toStorageContext(scope, operation);
  if (context.organizationId !== organizationId) {
    throw new TypeError(`${operation}() organization does not match its scope`);
  }
}

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
  scope,
  userEmail,
  organizationId,
  opts = {},
) {
  requireDashboardOrganization(scope, organizationId, 'getDashboardSummary');
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
      const decks = dashboardDeckIds(scope, db, userEmail);
      if (!decks) {
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
        .where('presentation_id', 'in', decks);

      // Apply date filters
      currentQuery = applyDateFilters(currentQuery, dateRange);

      const currentResult = await currentQuery.executeTakeFirst();

      // Get previous period for comparison
      let previousQuery = db
        .selectFrom('view_sessions')
        .select((eb) => eb.fn.count('id').as('total_views'))
        .where('presentation_id', 'in', decks);

      previousQuery = applyDateFilters(previousQuery, previousRange);

      const previousResult = await previousQuery.executeTakeFirst();

      const completion = await getCompletionCounts(scope, db, decks, dateRange);

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
  scope,
  userEmail,
  organizationId,
  opts = {},
) {
  requireDashboardOrganization(scope, organizationId, 'getDashboardTimeline');
  const period = opts.period || '30d';
  const dateRange = getPeriodDateRange(period);

  return withDbGuard([], async (db) => {
    const decks = dashboardDeckIds(scope, db, userEmail);
    if (!decks) return [];

    let query = db
      .selectFrom('view_sessions')
      .select([
        sql`date_trunc('day', started_at)::date`.as('date'),
        (eb) => eb.fn.count('id').as('views'),
        sql`COUNT(DISTINCT COALESCE(device_id, id::text))`.as('unique_viewers'),
      ])
      .where('presentation_id', 'in', decks)
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
  scope,
  userEmail,
  organizationId,
  opts = {},
) {
  requireDashboardOrganization(scope, organizationId, 'getTopPresentations');
  const period = opts.period || '30d';
  const limit = opts.limit || 10;
  const dateRange = getPeriodDateRange(period);

  return withDbGuard([], async (db) => {
    const decks = dashboardDeckIds(scope, db, userEmail);
    if (!decks) return [];

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
      .where('view_sessions.presentation_id', 'in', decks)
      .groupBy(['presentations.id', 'presentations.title'])
      .orderBy((eb) => eb.fn.count('view_sessions.id'), 'desc')
      .orderBy('presentations.id', 'desc')
      .limit(limit);

    query = applyDateFilters(query, dateRange, 'view_sessions.started_at');

    const rows = await query.execute();
    const completion = await getCompletionCounts(
      scope,
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
export async function getSourceBreakdown(
  scope,
  userEmail,
  organizationId,
  opts = {},
) {
  requireDashboardOrganization(scope, organizationId, 'getSourceBreakdown');
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
      const decks = dashboardDeckIds(scope, db, userEmail);
      if (!decks) {
        return { shareLink: 0, published: 0, follow: 0, embed: 0 };
      }

      let query = db
        .selectFrom('view_sessions')
        .select(['source_type', (eb) => eb.fn.count('id').as('count')])
        .where('presentation_id', 'in', decks)
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
 * One page of the decks the dashboard covers, each with its analytics over
 * the period (B825, D358): order `(modified_at desc, id desc)`, the one order
 * of a deck list, continued after `after`. There is no other order: a sort on
 * views or duration would change between two pages as sessions arrive, so it
 * cannot be a keyset (the retired `sort` is refused at the route).
 *
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} userEmail - The user's email
 * @param {string} organizationId - The user's organization ID
 * @param {Object} opts
 * @param {string} [opts.period] - '7d' | '30d' | '90d' | '12m'
 * @param {number} opts.limit - Rows per page.
 * @param {{value: string, id: string}|null} [opts.after] - Last row seen.
 * @returns {Promise<{items: Object[], next: {value: string, id: string}|null}>}
 */
export async function listDashboardPresentations(
  scope,
  userEmail,
  organizationId,
  opts,
) {
  requireDashboardOrganization(
    scope,
    organizationId,
    'listDashboardPresentations',
  );
  const dateRange = getPeriodDateRange(opts.period || '30d');
  const empty = { items: [], next: null };

  return withDbGuard(empty, async (db) => {
    const decks = dashboardDeckIds(scope, db, userEmail);
    if (!decks) return empty;

    const query = db
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
      .where('presentations.id', 'in', decks)
      .groupBy([
        'presentations.id',
        'presentations.title',
        'presentations.modified_at',
      ]);

    const { rows, next } = keysetRows(
      await keysetPage(query, {
        column: 'presentations.modified_at',
        idColumn: 'presentations.id',
        after: opts.after ?? null,
        limit: opts.limit,
      }).execute(),
      opts.limit,
    );
    const completion = await getCompletionCounts(
      scope,
      db,
      rows.map((row) => row.id),
      dateRange,
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title || 'Untitled',
        updatedAt: row.modified_at,
        views: Number(row.views) || 0,
        uniqueViewers: Number(row.unique_viewers) || 0,
        avgDurationSeconds: Math.round(Number(row.avg_duration) || 0),
        completionRate: deckCompletionRate(completion, row.id),
      })),
      next,
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
 * The decks a person's dashboard covers, as one SQL subquery every dashboard
 * aggregation filters on (`presentation_id IN (…)`), so no id list is read
 * into JavaScript (B825).
 *
 * The right is narrower than reading a deck: the deck is in the organization
 * and the person owns it (`owner_email`) or holds a collaborator row with
 * `edit` or `admin`. Organization visibility and a `view`/`comment` row give
 * no dashboard, and neither does a revoked row (`revoked_at` set): a
 * revoked editor loses the deck's numbers like every other right (B841). A
 * trashed deck stays in. The weekly digest reads its decks through this same
 * predicate; both are pinned in `tests/pg/analytics-dashboard-scope.pgtest.js`.
 *
 * @param {import('../scope.js').StorageScope} scope - Its organization bounds the decks.
 * @param {import('kysely').Kysely<any>} db
 * @param {string} userEmail
 * @returns {import('kysely').SelectQueryBuilder<any, any, {id: string}>|null}
 *   null when there is no address to match, which covers no deck.
 */
export function dashboardDeckIds(scope, db, userEmail) {
  const { organizationId } = toStorageContext(scope, 'dashboardDeckIds');
  // D200: `owner_email` and `user_email` are normalised on write, so the
  // caller's address is normalised once here and compared bare below.
  const email = normalizeEmail(userEmail);
  if (!email) return null;
  return db
    .selectFrom('presentations')
    .select('presentations.id')
    .where('presentations.organization_id', '=', organizationId)
    .where((eb) =>
      eb.or([
        eb('presentations.owner_email', '=', email),
        eb.exists(
          eb
            .selectFrom('presentation_collaborators')
            .select('presentation_collaborators.id')
            .whereRef(
              'presentation_collaborators.presentation_id',
              '=',
              'presentations.id',
            )
            .where('presentation_collaborators.user_email', '=', email)
            .where('presentation_collaborators.permission', 'in', [
              'edit',
              'admin',
            ])
            .where('presentation_collaborators.revoked_at', 'is', null),
        ),
      ]),
    );
}
