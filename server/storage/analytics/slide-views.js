/**
 * Slide views storage for tracking per-slide engagement.
 */

import { sql } from 'kysely';
import { norm, nowIso, durationSinceSeconds } from '../../utils/normalize.js';
import { withDbGuard } from '../utils/db-guard.js';
import { isValidSlideIndex, applyDateFilters } from '../../analytics/helpers.js';

// ============================================================
// SLIDE VIEW CRUD
// ============================================================

/**
 * Record a slide view (when entering a slide).
 * @param {Object} data - Slide view data
 * @param {string} data.viewSessionId - The view session ID
 * @param {string} data.presentationId - The presentation ID
 * @param {string} data.slideId - The slide ID
 * @param {number} data.slideIndex - The slide index
 * @returns {Promise<{ok: boolean, slideView?: Object, reason?: string}>}
 */
export async function recordSlideView(data) {
  const viewSessionId = norm(data?.viewSessionId);
  const presentationId = norm(data?.presentationId);
  const slideId = norm(data?.slideId);
  const slideIndex = data?.slideIndex ?? 0;

  if (!viewSessionId || !presentationId || !slideId) {
    return { ok: false, reason: 'invalid' };
  }

  // Validate slide index using centralized validation
  if (!isValidSlideIndex(slideIndex)) {
    return { ok: false, reason: 'invalid_slide_index' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const now = nowIso();

    // Count how many times this slide has been visited in this session
    const visitCount = await db
      .selectFrom('slide_views')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('view_session_id', '=', viewSessionId)
      .where('slide_id', '=', slideId)
      .executeTakeFirst();

    const visitNumber = (Number(visitCount?.count) || 0) + 1;

    const row = await db
      .insertInto('slide_views')
      .values({
        view_session_id: viewSessionId,
        presentation_id: presentationId,
        slide_id: slideId,
        slide_index: slideIndex,
        entered_at: now,
        duration_seconds: 0,
        visit_number: visitNumber,
        created_at: now,
      })
      .returningAll()
      .executeTakeFirst();

    return {
      ok: true,
      slideView: rowToSlideView(row),
    };
  });
}

/**
 * Update slide view when exiting the slide.
 * @param {string} slideViewId - The slide view ID
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function endSlideView(slideViewId) {
  const id = norm(slideViewId);
  if (!id) return { ok: false, reason: 'invalid' };

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const now = nowIso();

    // Get current slide view
    const current = await db
      .selectFrom('slide_views')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!current) {
      return { ok: false, reason: 'not_found' };
    }

    // Calculate duration using shared utility
    const durationSeconds = durationSinceSeconds(current.entered_at);

    await db
      .updateTable('slide_views')
      .set({
        exited_at: now,
        duration_seconds: durationSeconds,
      })
      .where('id', '=', id)
      .execute();

    return { ok: true };
  });
}

/**
 * End all open slide views for a session.
 * Uses a single batch update instead of individual queries.
 * @param {string} viewSessionId - The view session ID
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function endAllSlideViewsForSession(viewSessionId) {
  const sessionId = norm(viewSessionId);
  if (!sessionId) return { ok: false, reason: 'invalid' };

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const now = nowIso();

    // Batch update all open slide views for this session
    // Calculate duration using SQL to avoid N+1 queries
    await db
      .updateTable('slide_views')
      .set({
        exited_at: now,
        // Calculate duration in seconds from entered_at to now
        duration_seconds: sql`GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (${sql.lit(now)}::timestamp - entered_at))))`,
      })
      .where('view_session_id', '=', sessionId)
      .where('exited_at', 'is', null)
      .execute();

    return { ok: true };
  });
}

/**
 * Get the current open slide view for a session.
 * @param {string} viewSessionId - The view session ID
 * @returns {Promise<Object|null>}
 */
export async function getCurrentSlideView(viewSessionId) {
  const sessionId = norm(viewSessionId);
  if (!sessionId) return null;

  return withDbGuard(null, async (db) => {
    const row = await db
      .selectFrom('slide_views')
      .selectAll()
      .where('view_session_id', '=', sessionId)
      .where('exited_at', 'is', null)
      .orderBy('entered_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!row) return null;
    return rowToSlideView(row);
  });
}

/**
 * Atomically transition from current slide to a new slide.
 * This ends any current open slide view and records the new one in a single transaction.
 * @param {Object} data - Transition data
 * @param {string} data.viewSessionId - The view session ID
 * @param {string} data.presentationId - The presentation ID
 * @param {string} data.slideId - The new slide ID
 * @param {number} data.slideIndex - The new slide index
 * @returns {Promise<{ok: boolean, slideView?: Object, reason?: string}>}
 */
export async function transitionToSlide(data) {
  const viewSessionId = norm(data?.viewSessionId);
  const presentationId = norm(data?.presentationId);
  const slideId = norm(data?.slideId);
  const slideIndex = data?.slideIndex ?? 0;

  if (!viewSessionId || !presentationId || !slideId) {
    return { ok: false, reason: 'invalid' };
  }

  // Validate slide index using centralized validation
  if (!isValidSlideIndex(slideIndex)) {
    return { ok: false, reason: 'invalid_slide_index' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    // Use a transaction to ensure atomicity
    return db.transaction().execute(async (trx) => {
      const now = nowIso();

      // End any current open slide view in this transaction
      await trx
        .updateTable('slide_views')
        .set({
          exited_at: now,
          duration_seconds: sql`GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (${sql.lit(now)}::timestamp - entered_at))))`,
        })
        .where('view_session_id', '=', viewSessionId)
        .where('exited_at', 'is', null)
        .execute();

      // Count how many times this slide has been visited in this session
      const visitCount = await trx
        .selectFrom('slide_views')
        .select((eb) => eb.fn.count('id').as('count'))
        .where('view_session_id', '=', viewSessionId)
        .where('slide_id', '=', slideId)
        .executeTakeFirst();

      const visitNumber = (Number(visitCount?.count) || 0) + 1;

      // Record new slide view
      const row = await trx
        .insertInto('slide_views')
        .values({
          view_session_id: viewSessionId,
          presentation_id: presentationId,
          slide_id: slideId,
          slide_index: slideIndex,
          entered_at: now,
          duration_seconds: 0,
          visit_number: visitNumber,
          created_at: now,
        })
        .returningAll()
        .executeTakeFirst();

      return {
        ok: true,
        slideView: rowToSlideView(row),
      };
    });
  });
}

// ============================================================
// QUERIES
// ============================================================

/**
 * Get slide views for a session.
 * @param {string} viewSessionId - The view session ID
 * @returns {Promise<Object[]>}
 */
export async function getSlideViewsForSession(viewSessionId) {
  const sessionId = norm(viewSessionId);
  if (!sessionId) return [];

  return withDbGuard([], async (db) => {
    const rows = await db
      .selectFrom('slide_views')
      .selectAll()
      .where('view_session_id', '=', sessionId)
      .orderBy('entered_at', 'asc')
      .execute();

    return rows.map(rowToSlideView);
  });
}

/**
 * Get slide engagement metrics for a presentation.
 * @param {string} presentationId - The presentation ID
 * @param {Object} opts - Query options
 * @param {string} [opts.since] - Start date
 * @param {string} [opts.until] - End date
 * @returns {Promise<Array<{slideId: string, slideIndex: number, views: number, avgTimeSeconds: number, totalTimeSeconds: number, revisits: number}>>}
 */
export async function getSlideEngagementMetrics(presentationId, opts = {}) {
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
        (eb) => eb.fn.count(sql`CASE WHEN visit_number > 1 THEN 1 END`).as('revisits'),
      ])
      .where('presentation_id', '=', presId)
      .groupBy(['slide_id', 'slide_index'])
      .orderBy('slide_index', 'asc');

    query = applyDateFilters(query, opts, 'entered_at');

    const rows = await query.execute();

    return rows.map((row) => ({
      slideId: row.slide_id,
      slideIndex: Number(row.slide_index) || 0,
      views: Number(row.views) || 0,
      avgTimeSeconds: Math.round(Number(row.avg_time) || 0),
      totalTimeSeconds: Number(row.total_time) || 0,
      revisits: Number(row.revisits) || 0,
    }));
  });
}

/**
 * Get dropoff data for slides.
 * Identifies slides where viewers exit the presentation.
 * @param {string} presentationId - The presentation ID
 * @param {Object} opts - Query options
 * @returns {Promise<Array<{slideId: string, slideIndex: number, dropoffCount: number, dropoffRate: number}>>}
 */
export async function getSlideDropoffData(presentationId, opts = {}) {
  const presId = norm(presentationId);
  if (!presId) return [];

  return withDbGuard([], async (db) => {
    // Get total views per slide
    let viewsQuery = db
      .selectFrom('slide_views')
      .select([
        'slide_id',
        'slide_index',
        (eb) => eb.fn.count('id').as('views'),
      ])
      .where('presentation_id', '=', presId)
      .groupBy(['slide_id', 'slide_index']);

    viewsQuery = applyDateFilters(viewsQuery, opts, 'entered_at');

    const viewsRows = await viewsQuery.execute();
    const viewsBySlide = new Map(viewsRows.map((r) => [r.slide_id, {
      slideIndex: Number(r.slide_index) || 0,
      views: Number(r.views) || 0,
    }]));

    // Get dropoff counts (sessions that ended on each slide)
    let dropoffQuery = db
      .selectFrom('view_sessions')
      .select([
        'exit_slide_id',
        'exit_slide_index',
        (eb) => eb.fn.count('id').as('dropoffs'),
      ])
      .where('presentation_id', '=', presId)
      .where('exit_slide_id', 'is not', null)
      .groupBy(['exit_slide_id', 'exit_slide_index']);

    dropoffQuery = applyDateFilters(dropoffQuery, opts);

    const dropoffRows = await dropoffQuery.execute();

    return dropoffRows.map((row) => {
      const slideData = viewsBySlide.get(row.exit_slide_id) || { views: 0, slideIndex: 0 };
      const dropoffCount = Number(row.dropoffs) || 0;
      const views = slideData.views || 1;

      return {
        slideId: row.exit_slide_id,
        slideIndex: row.exit_slide_index != null ? Number(row.exit_slide_index) : slideData.slideIndex,
        dropoffCount,
        dropoffRate: views > 0 ? dropoffCount / views : 0,
      };
    }).sort((a, b) => a.slideIndex - b.slideIndex);
  });
}

/**
 * Delete old slide views for cleanup.
 * @param {string} olderThan - ISO date string
 * @returns {Promise<{deleted: number}>}
 */
export async function deleteOldSlideViews(olderThan) {
  return withDbGuard({ deleted: 0 }, async (db) => {
    const result = await db
      .deleteFrom('slide_views')
      .where('created_at', '<', olderThan)
      .executeTakeFirst();

    return { deleted: Number(result.numDeletedRows) || 0 };
  });
}

// ============================================================
// HELPERS
// ============================================================

function rowToSlideView(row) {
  return {
    id: row.id,
    viewSessionId: row.view_session_id,
    presentationId: row.presentation_id,
    slideId: row.slide_id,
    slideIndex: row.slide_index,
    enteredAt: row.entered_at,
    exitedAt: row.exited_at,
    durationSeconds: row.duration_seconds,
    visitNumber: row.visit_number,
    createdAt: row.created_at,
  };
}