/**
 * Slide views storage for tracking per-slide engagement.
 */

import { sql } from 'kysely';
import { norm, nowIso } from '../../utils/normalize.js';
import { withDbGuard } from '../utils/db-guard.js';
import { isValidSlideIndex } from '../../analytics/helpers.js';

// ============================================================
// SLIDE VIEW CRUD
// ============================================================

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
    return { ok: false, reason: 'invalid', field: 'slide_index' };
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
