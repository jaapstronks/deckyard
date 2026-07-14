/**
 * Complex aggregation queries for analytics.
 */

import { sql } from 'kysely';
import { norm } from '../../utils/normalize.js';
import { withDbGuard } from '../utils/db-guard.js';
import { applyDateFilters } from '../../analytics/helpers.js';

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
export async function getPresentationAnalyticsOverview(presentationId, opts = {}) {
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

  return withDbGuard({
    totalViews: 0,
    uniqueViewers: 0,
    avgDurationSeconds: 0,
    completionRate: 0,
    viewsByDay: [],
    topSourceTypes: [],
  }, async (db) => {
    // Main metrics query
    let metricsQuery = db
      .selectFrom('view_sessions')
      .select([
        (eb) => eb.fn.count('id').as('total_views'),
        // Use raw SQL for COALESCE since device_id is varchar and id is uuid
        sql`COUNT(DISTINCT COALESCE(device_id, id::text))`.as('unique_viewers'),
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
      .select([
        'source_type',
        (eb) => eb.fn.count('id').as('count'),
      ])
      .where('presentation_id', '=', presId)
      .groupBy('source_type')
      .orderBy((eb) => eb.fn.count('id'), 'desc');

    sourceTypesQuery = applyDateFilters(sourceTypesQuery, opts);
    const sourceTypesRows = await sourceTypesQuery.execute();

    return {
      totalViews: Number(metrics?.total_views) || 0,
      uniqueViewers: Number(metrics?.unique_viewers) || 0,
      avgDurationSeconds: Math.round(Number(metrics?.avg_duration) || 0),
      completionRate: 0, // Calculate separately based on slide progression
      viewsByDay: viewsByDayRows.map((row) => ({
        date: row.date?.toISOString?.()?.split('T')[0] || String(row.date),
        views: Number(row.views) || 0,
      })),
      topSourceTypes: sourceTypesRows.map((row) => ({
        type: row.source_type,
        count: Number(row.count) || 0,
      })),
    };
  });
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
        (eb) => eb.fn.count(sql`CASE WHEN visit_number > 1 THEN 1 END`).as('revisits'),
      ])
      .where('presentation_id', '=', presId)
      .groupBy(['slide_id', 'slide_index'])
      .orderBy('slide_index', 'asc');

    slideQuery = applyDateFilters(slideQuery, opts, 'entered_at');
    const slideRows = await slideQuery.execute();

    // Get dropoff stats per slide
    let dropoffQuery = db
      .selectFrom('view_sessions')
      .select([
        'exit_slide_id',
        (eb) => eb.fn.count('id').as('dropoffs'),
      ])
      .where('presentation_id', '=', presId)
      .where('exit_slide_id', 'is not', null)
      .groupBy('exit_slide_id');

    dropoffQuery = applyDateFilters(dropoffQuery, opts);
    const dropoffRows = await dropoffQuery.execute();
    const dropoffBySlide = new Map(dropoffRows.map((r) => [r.exit_slide_id, Number(r.dropoffs) || 0]));

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
      const engagementScore = (timeScore * 0.6) + (viewsScore * 0.4);

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

  return withDbGuard({
    slideProgression: [],
    avgCompletionIndex: 0,
    completionRate: 0,
  }, async (db) => {
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
      progressionCounts.set(maxIndex, (progressionCounts.get(maxIndex) || 0) + 1);
    }

    const avgCompletionIndex = totalMaxIndex / sessionRows.length;

    // Get total slides in presentation for completion rate
    let slidesQuery = db
      .selectFrom('slide_views')
      .select((eb) => eb.fn.max('slide_index').as('max_slide'))
      .where('presentation_id', '=', presId);

    const slidesResult = await slidesQuery.executeTakeFirst();
    const totalSlides = (Number(slidesResult?.max_slide) || 0) + 1;

    // Count sessions that reached the last slide
    const lastSlideIndex = totalSlides - 1;
    const completedSessions = sessionRows.filter((r) => Number(r.max_index) >= lastSlideIndex).length;
    const completionRate = sessionRows.length > 0 ? completedSessions / sessionRows.length : 0;

    // Build progression array
    const slideProgression = [];
    for (let i = 0; i < totalSlides; i++) {
      const reached = sessionRows.filter((r) => Number(r.max_index) >= i).length;
      slideProgression.push({
        slideIndex: i,
        viewersReached: reached,
        reachRate: sessionRows.length > 0 ? reached / sessionRows.length : 0,
      });
    }

    return {
      slideProgression,
      avgCompletionIndex: Math.round(avgCompletionIndex * 10) / 10,
      completionRate: Math.round(completionRate * 100) / 100,
    };
  });
}

// ============================================================
// TIME-BASED ANALYSIS
// ============================================================

/**
 * Get views by hour of day (for understanding peak usage times).
 * @param {string} presentationId - The presentation ID
 * @param {Object} opts - Query options
 * @returns {Promise<Array<{hour: number, views: number}>>}
 */
export async function getViewsByHourOfDay(presentationId, opts = {}) {
  const presId = norm(presentationId);
  if (!presId) return [];

  return withDbGuard([], async (db) => {
    let query = db
      .selectFrom('view_sessions')
      .select([
        sql`extract(hour from started_at)`.as('hour'),
        (eb) => eb.fn.count('id').as('views'),
      ])
      .where('presentation_id', '=', presId)
      .groupBy(sql`extract(hour from started_at)`)
      .orderBy(sql`extract(hour from started_at)`, 'asc');

    query = applyDateFilters(query, opts);
    const rows = await query.execute();

    return rows.map((row) => ({
      hour: Number(row.hour) || 0,
      views: Number(row.views) || 0,
    }));
  });
}

/**
 * Get views by day of week.
 * @param {string} presentationId - The presentation ID
 * @param {Object} opts - Query options
 * @returns {Promise<Array<{dayOfWeek: number, dayName: string, views: number}>>}
 */
export async function getViewsByDayOfWeek(presentationId, opts = {}) {
  const presId = norm(presentationId);
  if (!presId) return [];

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  return withDbGuard([], async (db) => {
    let query = db
      .selectFrom('view_sessions')
      .select([
        sql`extract(dow from started_at)`.as('dow'),
        (eb) => eb.fn.count('id').as('views'),
      ])
      .where('presentation_id', '=', presId)
      .groupBy(sql`extract(dow from started_at)`)
      .orderBy(sql`extract(dow from started_at)`, 'asc');

    query = applyDateFilters(query, opts);
    const rows = await query.execute();

    return rows.map((row) => {
      const dow = Number(row.dow) || 0;
      return {
        dayOfWeek: dow,
        dayName: dayNames[dow] || 'Unknown',
        views: Number(row.views) || 0,
      };
    });
  });
}