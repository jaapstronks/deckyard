/**
 * Complex aggregation queries for analytics.
 */

import { sql } from 'kysely';
import { norm } from '../../utils/normalize.js';
import { withDbGuard } from '../utils/index.js';
import { applyDateFilters } from '../../analytics/helpers.js';

// ============================================================
// COMPLETION
// ============================================================

/**
 * Completion counts per presentation: how many sessions in the window reached
 * the deck's last slide. The last slide is the highest slide index any session
 * of that deck ever reached (over all time, not just the window), so a deck
 * nobody finished still has a last slide. This is the one completion
 * definition: the per-deck overview, the viewer journey and the dashboard all
 * read it, through `completionRate()`.
 *
 * @param {import('kysely').Kysely<any>} db - Database connection.
 * @param {string[]} presentationIds - The decks to count.
 * @param {Object} [opts] - Date window, applied to `slide_views.entered_at`.
 * @param {string} [opts.since]
 * @param {string} [opts.until]
 * @returns {Promise<Map<string, {sessions: number, completed: number}>>}
 *   Decks without a slide view in the window are absent.
 */
export async function getCompletionCounts(db, presentationIds, opts = {}) {
  if (!presentationIds.length) return new Map();

  let sessions = db
    .selectFrom('slide_views')
    .select([
      'presentation_id',
      'view_session_id',
      (eb) => eb.fn.max('slide_index').as('max_index'),
    ])
    .where('presentation_id', 'in', presentationIds)
    .groupBy(['presentation_id', 'view_session_id']);
  sessions = applyDateFilters(sessions, opts, 'entered_at');

  const lastSlide = db
    .selectFrom('slide_views')
    .select([
      'presentation_id',
      (eb) => eb.fn.max('slide_index').as('last_index'),
    ])
    .where('presentation_id', 'in', presentationIds)
    .groupBy('presentation_id');

  const rows = await db
    .selectFrom(sessions.as('s'))
    .innerJoin(lastSlide.as('l'), 'l.presentation_id', 's.presentation_id')
    .select([
      's.presentation_id',
      (eb) => eb.fn.countAll().as('sessions'),
      sql`COUNT(*) FILTER (WHERE s.max_index >= l.last_index)`.as('completed'),
    ])
    .groupBy('s.presentation_id')
    .execute();

  return new Map(
    rows.map((row) => [
      row.presentation_id,
      {
        sessions: Number(row.sessions) || 0,
        completed: Number(row.completed) || 0,
      },
    ]),
  );
}

/**
 * The share of sessions that reached the last slide, rounded to two decimals.
 * Several decks' counts pool: the dashboard's rate is all completed sessions
 * over all sessions, not an average of per-deck rates.
 *
 * @param {Iterable<{sessions: number, completed: number}>} counts
 * @returns {number} 0..1, and 0 without sessions.
 */
export function completionRate(counts) {
  let sessions = 0;
  let completed = 0;
  for (const c of counts) {
    sessions += c.sessions;
    completed += c.completed;
  }
  return sessions > 0 ? Math.round((completed / sessions) * 100) / 100 : 0;
}

// ============================================================
// COMPREHENSIVE OVERVIEW
// ============================================================

/**
 * Get a full analytics overview for a presentation.
 * @param {string} presentationId - The presentation ID
 * @param {Object} opts - Query options
 * @param {string} [opts.since] - Start date
 * @param {string} [opts.until] - End date
 * @returns {Promise<Object>}
 */
export async function getPresentationAnalyticsOverview(
  presentationId,
  opts = {},
) {
  const presId = norm(presentationId);
  if (!presId) {
    return {
      totalViews: 0,
      uniqueViewers: 0,
      avgDurationSeconds: 0,
      completionRate: 0,
      viewsByDay: [],
      topSourceTypes: [],
    };
  }

  return withDbGuard(
    {
      totalViews: 0,
      uniqueViewers: 0,
      avgDurationSeconds: 0,
      completionRate: 0,
      viewsByDay: [],
      topSourceTypes: [],
    },
    async (db) => {
      // Main metrics query
      let metricsQuery = db
        .selectFrom('view_sessions')
        .select([
          (eb) => eb.fn.count('id').as('total_views'),
          // Use raw SQL for COALESCE since device_id is varchar and id is uuid
          sql`COUNT(DISTINCT COALESCE(device_id, id::text))`.as(
            'unique_viewers',
          ),
          (eb) => eb.fn.avg('duration_seconds').as('avg_duration'),
        ])
        .where('presentation_id', '=', presId);

      metricsQuery = applyDateFilters(metricsQuery, opts);
      const metrics = await metricsQuery.executeTakeFirst();

      // Views by day
      let viewsByDayQuery = db
        .selectFrom('view_sessions')
        .select([
          sql`date_trunc('day', started_at)::date`.as('date'),
          (eb) => eb.fn.count('id').as('views'),
        ])
        .where('presentation_id', '=', presId)
        .groupBy(sql`date_trunc('day', started_at)`)
        .orderBy(sql`date_trunc('day', started_at)`, 'asc');

      viewsByDayQuery = applyDateFilters(viewsByDayQuery, opts);
      const viewsByDayRows = await viewsByDayQuery.execute();

      // Source types breakdown
      let sourceTypesQuery = db
        .selectFrom('view_sessions')
        .select(['source_type', (eb) => eb.fn.count('id').as('count')])
        .where('presentation_id', '=', presId)
        .groupBy('source_type')
        .orderBy((eb) => eb.fn.count('id'), 'desc');

      sourceTypesQuery = applyDateFilters(sourceTypesQuery, opts);
      const sourceTypesRows = await sourceTypesQuery.execute();

      const completion = await getCompletionCounts(db, [presId], opts);

      return {
        totalViews: Number(metrics?.total_views) || 0,
        uniqueViewers: Number(metrics?.unique_viewers) || 0,
        avgDurationSeconds: Math.round(Number(metrics?.avg_duration) || 0),
        completionRate: completionRate(completion.values()),
        viewsByDay: viewsByDayRows.map((row) => ({
          date: row.date?.toISOString?.()?.split('T')[0] || String(row.date),
          views: Number(row.views) || 0,
        })),
        topSourceTypes: sourceTypesRows.map((row) => ({
          type: row.source_type,
          count: Number(row.count) || 0,
        })),
      };
    },
  );
}

// ============================================================
// SLIDE ENGAGEMENT
// ============================================================

/**
 * Get detailed slide engagement metrics.
 * @param {string} presentationId - The presentation ID
 * @param {Object} opts - Query options
 * @returns {Promise<Array>}
 */
export async function getDetailedSlideEngagement(presentationId, opts = {}) {
  const presId = norm(presentationId);
  if (!presId) return [];

  return withDbGuard([], async (db) => {
    // Get slide view stats
    let slideQuery = db
      .selectFrom('slide_views')
      .select([
        'slide_id',
        'slide_index',
        (eb) => eb.fn.count('id').as('views'),
        (eb) => eb.fn.avg('duration_seconds').as('avg_time'),
        (eb) => eb.fn.sum('duration_seconds').as('total_time'),
        (eb) => eb.fn.max('duration_seconds').as('max_time'),
        (eb) => eb.fn.min('duration_seconds').as('min_time'),
        (eb) =>
          eb.fn
            .count(sql`CASE WHEN visit_number > 1 THEN 1 END`)
            .as('revisits'),
      ])
      .where('presentation_id', '=', presId)
      .groupBy(['slide_id', 'slide_index'])
      .orderBy('slide_index', 'asc');

    slideQuery = applyDateFilters(slideQuery, opts, 'entered_at');
    const slideRows = await slideQuery.execute();

    // Get dropoff stats per slide
    let dropoffQuery = db
      .selectFrom('view_sessions')
      .select(['exit_slide_id', (eb) => eb.fn.count('id').as('dropoffs')])
      .where('presentation_id', '=', presId)
      .where('exit_slide_id', 'is not', null)
      .groupBy('exit_slide_id');

    dropoffQuery = applyDateFilters(dropoffQuery, opts);
    const dropoffRows = await dropoffQuery.execute();
    const dropoffBySlide = new Map(
      dropoffRows.map((r) => [r.exit_slide_id, Number(r.dropoffs) || 0]),
    );

    // Get total sessions for rate calculation
    let totalQuery = db
      .selectFrom('view_sessions')
      .select((eb) => eb.fn.count('id').as('total'))
      .where('presentation_id', '=', presId);

    totalQuery = applyDateFilters(totalQuery, opts);
    const totalResult = await totalQuery.executeTakeFirst();
    const totalSessions = Number(totalResult?.total) || 1;

    return slideRows.map((row) => {
      const views = Number(row.views) || 0;
      const dropoffs = dropoffBySlide.get(row.slide_id) || 0;

      return {
        slideId: row.slide_id,
        slideIndex: Number(row.slide_index) || 0,
        views,
        avgTimeSeconds: Math.round(Number(row.avg_time) || 0),
        totalTimeSeconds: Number(row.total_time) || 0,
        maxTimeSeconds: Number(row.max_time) || 0,
        minTimeSeconds: Number(row.min_time) || 0,
        revisits: Number(row.revisits) || 0,
        dropoffCount: dropoffs,
        dropoffRate: totalSessions > 0 ? dropoffs / totalSessions : 0,
      };
    });
  });
}

// ============================================================
// HEATMAP DATA
// ============================================================

/**
 * Get interaction heatmap data for visualization.
 * Returns a normalized engagement score (0-1) for each slide.
 * @param {string} presentationId - The presentation ID
 * @param {Object} opts - Query options
 * @returns {Promise<Array<{slideId: string, slideIndex: number, engagementScore: number, views: number, avgTime: number}>>}
 */
export async function getInteractionHeatmapData(presentationId, opts = {}) {
  const presId = norm(presentationId);
  if (!presId) return [];

  return withDbGuard([], async (db) => {
    let query = db
      .selectFrom('slide_views')
      .select([
        'slide_id',
        'slide_index',
        (eb) => eb.fn.count('id').as('views'),
        (eb) => eb.fn.avg('duration_seconds').as('avg_time'),
        (eb) => eb.fn.sum('duration_seconds').as('total_time'),
      ])
      .where('presentation_id', '=', presId)
      .groupBy(['slide_id', 'slide_index'])
      .orderBy('slide_index', 'asc');

    query = applyDateFilters(query, opts, 'entered_at');
    const rows = await query.execute();

    if (rows.length === 0) return [];

    // Calculate max values for normalization
    const maxViews = Math.max(...rows.map((r) => Number(r.views) || 0));
    const maxAvgTime = Math.max(...rows.map((r) => Number(r.avg_time) || 0));

    return rows.map((row) => {
      const views = Number(row.views) || 0;
      const avgTime = Number(row.avg_time) || 0;

      // Engagement score is a weighted combination of views and time
      // 60% time weight, 40% views weight
      const viewsScore = maxViews > 0 ? views / maxViews : 0;
      const timeScore = maxAvgTime > 0 ? avgTime / maxAvgTime : 0;
      const engagementScore = timeScore * 0.6 + viewsScore * 0.4;

      return {
        slideId: row.slide_id,
        slideIndex: Number(row.slide_index) || 0,
        engagementScore: Math.round(engagementScore * 100) / 100,
        views,
        avgTime: Math.round(avgTime),
      };
    });
  });
}

// ============================================================
// VIEWER JOURNEY
// ============================================================

/**
 * Get viewer journey/flow data showing how viewers progress through slides.
 * @param {string} presentationId - The presentation ID
 * @param {Object} opts - Query options
 * @returns {Promise<Object>}
 */
export async function getViewerJourneyData(presentationId, opts = {}) {
  const presId = norm(presentationId);
  if (!presId) {
    return {
      slideProgression: [],
      avgCompletionIndex: 0,
      completionRate: 0,
    };
  }

  return withDbGuard(
    {
      slideProgression: [],
      avgCompletionIndex: 0,
      completionRate: 0,
    },
    async (db) => {
      // Get max slide index reached per session
      let sessionQuery = db
        .selectFrom('slide_views')
        .select([
          'view_session_id',
          (eb) => eb.fn.max('slide_index').as('max_index'),
        ])
        .where('presentation_id', '=', presId)
        .groupBy('view_session_id');

      sessionQuery = applyDateFilters(sessionQuery, opts, 'entered_at');

      const sessionRows = await sessionQuery.execute();

      if (sessionRows.length === 0) {
        return {
          slideProgression: [],
          avgCompletionIndex: 0,
          completionRate: 0,
        };
      }

      // Calculate progression histogram
      const progressionCounts = new Map();
      let totalMaxIndex = 0;

      for (const row of sessionRows) {
        const maxIndex = Number(row.max_index) || 0;
        totalMaxIndex += maxIndex;
        progressionCounts.set(
          maxIndex,
          (progressionCounts.get(maxIndex) || 0) + 1,
        );
      }

      const avgCompletionIndex = totalMaxIndex / sessionRows.length;

      // The deck's length as far as viewers got, for the progression
      let slidesQuery = db
        .selectFrom('slide_views')
        .select((eb) => eb.fn.max('slide_index').as('max_slide'))
        .where('presentation_id', '=', presId);

      const slidesResult = await slidesQuery.executeTakeFirst();
      const totalSlides = (Number(slidesResult?.max_slide) || 0) + 1;

      const completion = await getCompletionCounts(db, [presId], opts);

      // Build progression array
      const slideProgression = [];
      for (let i = 0; i < totalSlides; i++) {
        const reached = sessionRows.filter(
          (r) => Number(r.max_index) >= i,
        ).length;
        slideProgression.push({
          slideIndex: i,
          viewersReached: reached,
          reachRate: sessionRows.length > 0 ? reached / sessionRows.length : 0,
        });
      }

      return {
        slideProgression,
        avgCompletionIndex: Math.round(avgCompletionIndex * 10) / 10,
        completionRate: completionRate(completion.values()),
      };
    },
  );
}

// ============================================================
// TIME-BASED ANALYSIS
// ============================================================
