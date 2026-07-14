/**
 * Weekly analytics summary for digest emails.
 * Aggregates engagement data for the past week.
 */

import { sql } from 'kysely';
import { withDbGuard } from '../utils/db-guard.js';
import { applyDateFilters } from '../../analytics/helpers.js';

// ============================================================
// DATE HELPERS
// ============================================================

/**
 * Get the date range for the past week (Mon-Sun or last 7 days).
 * @returns {{ since: string, until: string, weekStart: string, weekEnd: string }}
 */
export function getWeekDateRange() {
  const now = new Date();
  const until = now.toISOString();
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Format dates for display
  const weekStart = new Date(since).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const weekEnd = new Date(until).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  return { since, until, weekStart, weekEnd };
}

/**
 * Get the date range for the previous week (for comparison).
 * @returns {{ since: string, until: string }}
 */
export function getPreviousWeekDateRange() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  return {
    since: twoWeeksAgo.toISOString(),
    until: weekAgo.toISOString(),
  };
}

// ============================================================
// USER WEEKLY SUMMARY
// ============================================================

/**
 * Get weekly analytics for a specific user.
 * Used for the weekly digest email.
 * @param {string} userId - The user's ID
 * @param {string} userEmail - The user's email
 * @param {Object} opts - Options
 * @param {boolean} [opts.includeTeamAnalytics] - Include internal view stats
 * @returns {Promise<Object>}
 */
export async function getWeeklyAnalyticsForUser(userId, userEmail, opts = {}) {
  const { includeTeamAnalytics = true } = opts;
  const dateRange = getWeekDateRange();
  const previousRange = getPreviousWeekDateRange();

  return withDbGuard({
    userName: '',
    weekStart: dateRange.weekStart,
    weekEnd: dateRange.weekEnd,
    totalViews: 0,
    uniqueViewers: 0,
    avgDurationSeconds: 0,
    completionRate: 0,
    presentationCount: 0,
    topPresentations: [],
    insights: [],
    weekOverWeek: {
      views: { current: 0, previous: 0, percentChange: 0, direction: 'flat' },
      uniqueViewers: { current: 0, previous: 0, percentChange: 0, direction: 'flat' },
      avgDuration: { current: 0, previous: 0, percentChange: 0, direction: 'flat' },
    },
    hasActivity: false,
  }, async (db) => {
    // Get user info
    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'display_name'])
      .where('id', '=', userId)
      .executeTakeFirst();

    const userName = user?.display_name || userEmail.split('@')[0];

    // Get user's presentations
    const userPresentations = await getUserPresentationIds(db, userEmail);
    if (!userPresentations.length) {
      return {
        userName,
        weekStart: dateRange.weekStart,
        weekEnd: dateRange.weekEnd,
        totalViews: 0,
        uniqueViewers: 0,
        avgDurationSeconds: 0,
        completionRate: 0,
        presentationCount: 0,
        topPresentations: [],
        insights: [],
        weekOverWeek: {
          views: { current: 0, previous: 0, percentChange: 0, direction: 'flat' },
          uniqueViewers: { current: 0, previous: 0, percentChange: 0, direction: 'flat' },
          avgDuration: { current: 0, previous: 0, percentChange: 0, direction: 'flat' },
        },
        hasActivity: false,
      };
    }

    // Build base query conditions
    const buildBaseQuery = (query) => {
      query = query.where('presentation_id', 'in', userPresentations);
      if (!includeTeamAnalytics) {
        query = query.where('is_internal', '=', false);
      }
      return query;
    };

    // Current week summary
    let currentQuery = db
      .selectFrom('view_sessions')
      .select([
        (eb) => eb.fn.count('id').as('total_views'),
        sql`COUNT(DISTINCT COALESCE(device_id, id::text))`.as('unique_viewers'),
        (eb) => eb.fn.avg('duration_seconds').as('avg_duration'),
      ]);
    currentQuery = buildBaseQuery(currentQuery);
    currentQuery = applyDateFilters(currentQuery, dateRange);
    const currentResult = await currentQuery.executeTakeFirst();

    // Previous week summary
    let previousQuery = db
      .selectFrom('view_sessions')
      .select([
        (eb) => eb.fn.count('id').as('total_views'),
        sql`COUNT(DISTINCT COALESCE(device_id, id::text))`.as('unique_viewers'),
        (eb) => eb.fn.avg('duration_seconds').as('avg_duration'),
      ]);
    previousQuery = buildBaseQuery(previousQuery);
    previousQuery = applyDateFilters(previousQuery, previousRange);
    const previousResult = await previousQuery.executeTakeFirst();

    // Get top presentations
    let topQuery = db
      .selectFrom('view_sessions')
      .innerJoin('presentations', 'presentations.id', 'view_sessions.presentation_id')
      .select([
        'presentations.id',
        'presentations.title',
        (eb) => eb.fn.count('view_sessions.id').as('views'),
        sql`COUNT(DISTINCT COALESCE(view_sessions.device_id, view_sessions.id::text))`.as('unique_viewers'),
        (eb) => eb.fn.avg('view_sessions.duration_seconds').as('avg_duration'),
      ])
      .where('view_sessions.presentation_id', 'in', userPresentations)
      .groupBy(['presentations.id', 'presentations.title'])
      .orderBy((eb) => eb.fn.count('view_sessions.id'), 'desc')
      .limit(5);

    if (!includeTeamAnalytics) {
      topQuery = topQuery.where('view_sessions.is_internal', '=', false);
    }
    topQuery = applyDateFilters(topQuery, dateRange, 'view_sessions.started_at');
    const topRows = await topQuery.execute();

    // Get engagement insights
    const insights = await getWeeklyInsights(db, userPresentations, dateRange, includeTeamAnalytics);

    // Calculate values
    const currentViews = Number(currentResult?.total_views) || 0;
    const previousViews = Number(previousResult?.total_views) || 0;
    const currentUniqueViewers = Number(currentResult?.unique_viewers) || 0;
    const previousUniqueViewers = Number(previousResult?.unique_viewers) || 0;
    const currentAvgDuration = Math.round(Number(currentResult?.avg_duration) || 0);
    const previousAvgDuration = Math.round(Number(previousResult?.avg_duration) || 0);

    // Calculate week-over-week changes
    const calcChange = (current, previous) => {
      if (previous === 0) {
        return { current, previous, percentChange: current > 0 ? 100 : 0, direction: current > 0 ? 'up' : 'flat' };
      }
      const percentChange = Math.round(((current - previous) / previous) * 100);
      const direction = percentChange > 0 ? 'up' : percentChange < 0 ? 'down' : 'flat';
      return { current, previous, percentChange: Math.abs(percentChange), direction };
    };

    return {
      userName,
      weekStart: dateRange.weekStart,
      weekEnd: dateRange.weekEnd,
      totalViews: currentViews,
      uniqueViewers: currentUniqueViewers,
      avgDurationSeconds: currentAvgDuration,
      completionRate: 0, // TODO: Calculate from slide views
      presentationCount: userPresentations.length,
      topPresentations: topRows.map((row) => ({
        id: row.id,
        title: row.title || 'Untitled',
        views: Number(row.views) || 0,
        uniqueViewers: Number(row.unique_viewers) || 0,
        avgDurationSeconds: Math.round(Number(row.avg_duration) || 0),
      })),
      insights,
      weekOverWeek: {
        views: calcChange(currentViews, previousViews),
        uniqueViewers: calcChange(currentUniqueViewers, previousUniqueViewers),
        avgDuration: calcChange(currentAvgDuration, previousAvgDuration),
      },
      hasActivity: currentViews > 0,
    };
  });
}

// ============================================================
// TEAM WEEKLY SUMMARY (FOR ADMINS)
// ============================================================

/**
 * Get weekly analytics for an entire organization.
 * Used for admin team digest emails.
 * @param {string} organizationId - The organization ID
 * @returns {Promise<Object>}
 */
export async function getTeamWeeklyAnalytics(organizationId) {
  const dateRange = getWeekDateRange();
  const previousRange = getPreviousWeekDateRange();

  return withDbGuard({
    weekStart: dateRange.weekStart,
    weekEnd: dateRange.weekEnd,
    totalViews: 0,
    uniqueViewers: 0,
    presentationCount: 0,
    activePresenters: 0,
    topPresentations: [],
    topPresenters: [],
    weekOverWeek: {
      views: { current: 0, previous: 0, percentChange: 0, direction: 'flat' },
    },
    hasActivity: false,
  }, async (db) => {
    // Get all presentations for this organization
    const orgPresentations = await db
      .selectFrom('presentations')
      .select('id')
      .where('organization_id', '=', organizationId)
      .execute();

    const presentationIds = orgPresentations.map((p) => p.id);
    if (!presentationIds.length) {
      return {
        weekStart: dateRange.weekStart,
        weekEnd: dateRange.weekEnd,
        totalViews: 0,
        uniqueViewers: 0,
        presentationCount: 0,
        activePresenters: 0,
        topPresentations: [],
        topPresenters: [],
        weekOverWeek: {
          views: { current: 0, previous: 0, percentChange: 0, direction: 'flat' },
        },
        hasActivity: false,
      };
    }

    // Current week summary
    let currentQuery = db
      .selectFrom('view_sessions')
      .select([
        (eb) => eb.fn.count('id').as('total_views'),
        sql`COUNT(DISTINCT COALESCE(device_id, id::text))`.as('unique_viewers'),
      ])
      .where('presentation_id', 'in', presentationIds);
    currentQuery = applyDateFilters(currentQuery, dateRange);
    const currentResult = await currentQuery.executeTakeFirst();

    // Previous week summary
    let previousQuery = db
      .selectFrom('view_sessions')
      .select((eb) => eb.fn.count('id').as('total_views'))
      .where('presentation_id', 'in', presentationIds);
    previousQuery = applyDateFilters(previousQuery, previousRange);
    const previousResult = await previousQuery.executeTakeFirst();

    // Top presentations for the org
    let topPresentationsQuery = db
      .selectFrom('view_sessions')
      .innerJoin('presentations', 'presentations.id', 'view_sessions.presentation_id')
      .select([
        'presentations.id',
        'presentations.title',
        'presentations.owner_email',
        (eb) => eb.fn.count('view_sessions.id').as('views'),
      ])
      .where('view_sessions.presentation_id', 'in', presentationIds)
      .groupBy(['presentations.id', 'presentations.title', 'presentations.owner_email'])
      .orderBy((eb) => eb.fn.count('view_sessions.id'), 'desc')
      .limit(5);
    topPresentationsQuery = applyDateFilters(topPresentationsQuery, dateRange, 'view_sessions.started_at');
    const topPresentationRows = await topPresentationsQuery.execute();

    // Top presenters (users with most engagement)
    let topPresentersQuery = db
      .selectFrom('view_sessions')
      .innerJoin('presentations', 'presentations.id', 'view_sessions.presentation_id')
      .leftJoin('users', 'users.email', 'presentations.owner_email')
      .select([
        'presentations.owner_email',
        sql`COALESCE(users.display_name, split_part(presentations.owner_email, '@', 1))`.as('presenter_name'),
        (eb) => eb.fn.count('view_sessions.id').as('total_views'),
        sql`COUNT(DISTINCT view_sessions.presentation_id)`.as('presentation_count'),
      ])
      .where('view_sessions.presentation_id', 'in', presentationIds)
      .groupBy(['presentations.owner_email', 'users.display_name'])
      .orderBy((eb) => eb.fn.count('view_sessions.id'), 'desc')
      .limit(5);
    topPresentersQuery = applyDateFilters(topPresentersQuery, dateRange, 'view_sessions.started_at');
    const topPresenterRows = await topPresentersQuery.execute();

    // Active presenters count (users with at least 1 view this week)
    let activePresentersQuery = db
      .selectFrom('view_sessions')
      .innerJoin('presentations', 'presentations.id', 'view_sessions.presentation_id')
      .select(sql`COUNT(DISTINCT presentations.owner_email)`.as('count'))
      .where('view_sessions.presentation_id', 'in', presentationIds);
    activePresentersQuery = applyDateFilters(activePresentersQuery, dateRange, 'view_sessions.started_at');
    const activePresentersResult = await activePresentersQuery.executeTakeFirst();

    const currentViews = Number(currentResult?.total_views) || 0;
    const previousViews = Number(previousResult?.total_views) || 0;

    const percentChange = previousViews > 0
      ? Math.round(((currentViews - previousViews) / previousViews) * 100)
      : (currentViews > 0 ? 100 : 0);
    const direction = percentChange > 0 ? 'up' : percentChange < 0 ? 'down' : 'flat';

    return {
      weekStart: dateRange.weekStart,
      weekEnd: dateRange.weekEnd,
      totalViews: currentViews,
      uniqueViewers: Number(currentResult?.unique_viewers) || 0,
      presentationCount: presentationIds.length,
      activePresenters: Number(activePresentersResult?.count) || 0,
      topPresentations: topPresentationRows.map((row) => ({
        id: row.id,
        title: row.title || 'Untitled',
        ownerEmail: row.owner_email,
        views: Number(row.views) || 0,
      })),
      topPresenters: topPresenterRows.map((row) => ({
        email: row.owner_email,
        name: row.presenter_name,
        totalViews: Number(row.total_views) || 0,
        presentationCount: Number(row.presentation_count) || 0,
      })),
      weekOverWeek: {
        views: {
          current: currentViews,
          previous: previousViews,
          percentChange: Math.abs(percentChange),
          direction,
        },
      },
      hasActivity: currentViews > 0,
    };
  });
}

// ============================================================
// INSIGHTS GENERATION
// ============================================================

/**
 * Generate engagement insights for the weekly digest.
 * @param {Object} db - Database connection
 * @param {string[]} presentationIds - User's presentation IDs
 * @param {Object} dateRange - Date range object
 * @param {boolean} includeTeamAnalytics - Include internal views
 * @returns {Promise<Array<{type: string, text: string, data: Object}>>}
 */
async function getWeeklyInsights(db, presentationIds, dateRange, includeTeamAnalytics) {
  const insights = [];

  // Insight 1: Peak engagement days
  let peakDaysQuery = db
    .selectFrom('view_sessions')
    .select([
      sql`to_char(started_at, 'Day')`.as('day_name'),
      sql`EXTRACT(DOW FROM started_at)`.as('day_of_week'),
      (eb) => eb.fn.count('id').as('views'),
    ])
    .where('presentation_id', 'in', presentationIds)
    .groupBy([sql`to_char(started_at, 'Day')`, sql`EXTRACT(DOW FROM started_at)`])
    .orderBy((eb) => eb.fn.count('id'), 'desc')
    .limit(2);

  if (!includeTeamAnalytics) {
    peakDaysQuery = peakDaysQuery.where('is_internal', '=', false);
  }
  peakDaysQuery = applyDateFilters(peakDaysQuery, dateRange);
  const peakDays = await peakDaysQuery.execute();

  if (peakDays.length >= 2) {
    const dayNames = peakDays.map((d) => d.day_name?.trim()).join(' and ');
    insights.push({
      type: 'peak_days',
      text: `${dayNames} saw peak engagement - consider sharing new content early in the week`,
      data: { days: peakDays.map((d) => ({ name: d.day_name?.trim(), views: Number(d.views) })) },
    });
  }

  // Insight 2: Returning viewers
  let returningQuery = db
    .selectFrom('view_sessions')
    .innerJoin('presentations', 'presentations.id', 'view_sessions.presentation_id')
    .select([
      'presentations.title',
      'view_sessions.device_id',
      (eb) => eb.fn.count('view_sessions.id').as('visit_count'),
    ])
    .where('view_sessions.presentation_id', 'in', presentationIds)
    .where('view_sessions.device_id', 'is not', null)
    .groupBy(['presentations.title', 'view_sessions.device_id'])
    .having((eb) => eb.fn.count('view_sessions.id'), '>', 1)
    .orderBy((eb) => eb.fn.count('view_sessions.id'), 'desc')
    .limit(1);

  if (!includeTeamAnalytics) {
    returningQuery = returningQuery.where('view_sessions.is_internal', '=', false);
  }
  returningQuery = applyDateFilters(returningQuery, dateRange, 'view_sessions.started_at');
  const returningViewers = await returningQuery.execute();

  if (returningViewers.length > 0) {
    const row = returningViewers[0];
    const visits = Number(row.visit_count) || 0;
    if (visits >= 3) {
      insights.push({
        type: 'returning_viewers',
        text: `Viewers returned multiple times to "${row.title}"`,
        data: { title: row.title, visits },
      });
    }
  }

  // Insight 3: Most engaging slides (if we have slide view data)
  // This would require slide_views table - placeholder for now
  // const slideInsight = await getTopSlideInsight(db, presentationIds, dateRange);
  // if (slideInsight) insights.push(slideInsight);

  return insights;
}

// ============================================================
// USERS WITH DIGEST ENABLED
// ============================================================

/**
 * Get users who should receive a digest on a specific day of the week.
 * @param {number} dayOfWeek - 0=Sunday, 1=Monday, etc.
 * @returns {Promise<Array<{id: string, email: string, organizationId: string, role: string}>>}
 */
export async function getUsersWithDigestDay(dayOfWeek) {
  return withDbGuard([], async (db) => {
    const users = await db
      .selectFrom('users')
      .select(['id', 'email', 'organization_id', 'role', 'settings'])
      .execute();

    return users.filter((user) => {
      const settings = user.settings || {};
      const digest = settings.digest || {};
      // Default: enabled on Monday (day 1)
      const isEnabled = digest.enabled !== false;
      const preferredDay = typeof digest.dayOfWeek === 'number' ? digest.dayOfWeek : 1;
      return isEnabled && preferredDay === dayOfWeek;
    }).map((user) => ({
      id: user.id,
      email: user.email,
      organizationId: user.organization_id,
      role: user.role,
      includeTeamAnalytics: user.settings?.digest?.includeTeamAnalytics !== false,
    }));
  });
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Get presentation IDs that a user has access to.
 * @param {Object} db - Database connection
 * @param {string} userEmail - The user's email
 * @returns {Promise<string[]>}
 */
async function getUserPresentationIds(db, userEmail) {
  // Get presentations where user is owner
  const ownedQuery = db
    .selectFrom('presentations')
    .select('id')
    .where('owner_email', '=', userEmail.toLowerCase());

  // Get presentations shared with user (edit or admin access)
  const sharedQuery = db
    .selectFrom('presentation_collaborators')
    .innerJoin('presentations', 'presentations.id', 'presentation_collaborators.presentation_id')
    .select('presentations.id')
    .where('presentation_collaborators.user_email', '=', userEmail.toLowerCase())
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

/**
 * Format seconds into a human-readable duration string.
 * @param {number} seconds - Duration in seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  if (!seconds || seconds < 60) return `${seconds || 0}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
