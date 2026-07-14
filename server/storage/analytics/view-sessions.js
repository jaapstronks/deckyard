/**
 * View sessions storage for tracking presentation views.
 * Handles session lifecycle: create, heartbeat, end.
 */

import crypto from 'node:crypto';
import { sql } from 'kysely';
import { norm, nowIso, durationSinceSeconds } from '../../utils/normalize.js';
import { withDbGuard } from '../utils/db-guard.js';
import { ANALYTICS_CONFIG, applyDateFilters } from '../../analytics/helpers.js';

// Re-export GDPR functions from dedicated module
export {
  exportUserAnalyticsData,
  deleteUserAnalyticsData,
  anonymizeOldIpAddresses,
} from './view-sessions-gdpr.js';

// ============================================================
// CONSTANTS
// ============================================================

// Re-export source types from analytics-helpers for backwards compatibility
export { SOURCE_TYPES } from '../../analytics/helpers.js';

export const VIEWER_TYPES = {
  GUEST: 'guest',
  AUTHENTICATED: 'authenticated',
  ANONYMOUS: 'anonymous',
};

// ============================================================
// SESSION CRUD
// ============================================================

/**
 * Generate a unique session token.
 * @returns {string} 64-character hex token
 */
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a new view session.
 * @param {Object} data - Session data
 * @param {string} data.presentationId - The presentation being viewed
 * @param {string} data.sourceType - 'share_link' | 'follow' | 'embed'
 * @param {string} [data.sourceId] - Share link token or session ID
 * @param {string} [data.viewerType] - 'guest' | 'authenticated' | 'anonymous'
 * @param {string} [data.viewerEmail] - Viewer's email if authenticated
 * @param {string} [data.deviceId] - Client device ID from localStorage
 * @param {string} [data.ipAddress] - Client IP address
 * @param {string} [data.userAgent] - Client user agent
 * @param {string} [data.organizationId] - Organization ID (optional)
 * @param {boolean} [data.isInternal] - True if viewer is an authenticated team member
 * @param {boolean} [data.attributionAllowed] - True if viewer opts into having name shown
 * @returns {Promise<{ok: boolean, session?: Object, reason?: string}>}
 */
export async function createViewSession(data) {
  const presentationId = norm(data?.presentationId);
  const sourceType = norm(data?.sourceType);

  if (!presentationId || !sourceType) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const now = nowIso();
    const sessionToken = generateSessionToken();

    const row = await db
      .insertInto('view_sessions')
      .values({
        organization_id: data?.organizationId ?? null,
        presentation_id: presentationId,
        session_token: sessionToken,
        source_type: sourceType,
        source_id: data?.sourceId ?? null,
        viewer_type: data?.viewerType ?? VIEWER_TYPES.ANONYMOUS,
        viewer_email: data?.viewerEmail?.toLowerCase() ?? null,
        device_id: data?.deviceId ?? null,
        started_at: now,
        last_activity_at: now,
        duration_seconds: 0,
        ip_address: data?.ipAddress ?? null,
        user_agent: data?.userAgent ?? null,
        is_internal: data?.isInternal ?? false,
        attribution_allowed: data?.attributionAllowed ?? false,
        created_at: now,
      })
      .returningAll()
      .executeTakeFirst();

    return {
      ok: true,
      session: rowToSession(row),
    };
  });
}

/**
 * Update view session with heartbeat data.
 * @param {string} sessionToken - The session token
 * @param {Object} updates - Update data
 * @param {string} [updates.currentSlideId] - Current slide being viewed
 * @param {number} [updates.currentSlideIndex] - Current slide index
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function updateViewSession(sessionToken, updates = {}) {
  const token = norm(sessionToken);
  if (!token) return { ok: false, reason: 'invalid' };

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const now = nowIso();

    // Get current session to calculate duration
    const current = await db
      .selectFrom('view_sessions')
      .selectAll()
      .where('session_token', '=', token)
      .executeTakeFirst();

    if (!current) {
      return { ok: false, reason: 'not_found' };
    }

    // Calculate duration from start time using shared utility
    const durationSeconds = durationSinceSeconds(current.started_at);

    await db
      .updateTable('view_sessions')
      .set({
        last_activity_at: now,
        duration_seconds: durationSeconds,
        // Note: Don't update exit_slide_* on heartbeat - only set on session end
        // Track current slide position separately if needed for real-time display
      })
      .where('session_token', '=', token)
      .execute();

    return { ok: true };
  });
}

/**
 * End a view session.
 * @param {string} sessionToken - The session token
 * @param {Object} exitData - Exit data
 * @param {string} [exitData.exitSlideId] - Last viewed slide ID
 * @param {number} [exitData.exitSlideIndex] - Last viewed slide index
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function endViewSession(sessionToken, exitData = {}) {
  const token = norm(sessionToken);
  if (!token) return { ok: false, reason: 'invalid' };

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const now = nowIso();

    // Get current session
    const current = await db
      .selectFrom('view_sessions')
      .selectAll()
      .where('session_token', '=', token)
      .executeTakeFirst();

    if (!current) {
      return { ok: false, reason: 'not_found' };
    }

    // Calculate final duration using shared utility
    const durationSeconds = durationSinceSeconds(current.started_at);

    await db
      .updateTable('view_sessions')
      .set({
        ended_at: now,
        last_activity_at: now,
        duration_seconds: durationSeconds,
        exit_slide_id: exitData?.exitSlideId ?? current.exit_slide_id,
        exit_slide_index: exitData?.exitSlideIndex ?? current.exit_slide_index,
      })
      .where('session_token', '=', token)
      .execute();

    return { ok: true };
  });
}

/**
 * Get a view session by token.
 * @param {string} sessionToken - The session token
 * @returns {Promise<Object|null>}
 */
export async function getViewSessionByToken(sessionToken) {
  const token = norm(sessionToken);
  if (!token) return null;

  return withDbGuard(null, async (db) => {
    const row = await db
      .selectFrom('view_sessions')
      .selectAll()
      .where('session_token', '=', token)
      .executeTakeFirst();

    if (!row) return null;
    return rowToSession(row);
  });
}

// ============================================================
// QUERIES
// ============================================================

/**
 * Get view sessions for a presentation with pagination.
 * @param {string} presentationId - The presentation ID
 * @param {Object} opts - Query options
 * @param {number} [opts.limit] - Max results (default 50)
 * @param {number} [opts.offset] - Offset for pagination
 * @param {string} [opts.since] - Start date filter
 * @param {string} [opts.until] - End date filter
 * @returns {Promise<{sessions: Object[], total: number}>}
 */
export async function getViewSessionsForPresentation(presentationId, opts = {}) {
  const presId = norm(presentationId);
  if (!presId) return { sessions: [], total: 0 };

  return withDbGuard({ sessions: [], total: 0 }, async (db) => {
    let query = db
      .selectFrom('view_sessions')
      .selectAll()
      .where('presentation_id', '=', presId);

    // Apply date range filters
    query = applyDateFilters(query, opts);

    // Count total
    const countQuery = query
      .clearSelect()
      .select((eb) => eb.fn.count('id').as('count'));
    const countResult = await countQuery.executeTakeFirst();
    const total = Number(countResult?.count) || 0;

    // Apply pagination
    const limit = Math.min(opts?.limit || 50, 100);
    const offset = opts?.offset || 0;

    query = query
      .orderBy('started_at', 'desc')
      .limit(limit)
      .offset(offset);

    const rows = await query.execute();

    return {
      sessions: rows.map(rowToSession),
      total,
      limit,
      offset,
    };
  });
}

/**
 * Get count of currently active viewers for a presentation.
 * @param {string} presentationId - The presentation ID
 * @returns {Promise<number>}
 */
export async function getActiveViewerCount(presentationId) {
  const presId = norm(presentationId);
  if (!presId) return 0;

  return withDbGuard(0, async (db) => {
    const threshold = new Date(Date.now() - ANALYTICS_CONFIG.ACTIVE_THRESHOLD_SECONDS * 1000).toISOString();

    const result = await db
      .selectFrom('view_sessions')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('presentation_id', '=', presId)
      .where('ended_at', 'is', null)
      .where('last_activity_at', '>=', threshold)
      .executeTakeFirst();

    return Number(result?.count) || 0;
  });
}

/**
 * Get unique viewer count for a presentation in a date range.
 * @param {string} presentationId - The presentation ID
 * @param {Object} opts - Query options
 * @param {string} [opts.since] - Start date
 * @param {string} [opts.until] - End date
 * @returns {Promise<number>}
 */
export async function getUniqueViewerCount(presentationId, opts = {}) {
  const presId = norm(presentationId);
  if (!presId) return 0;

  return withDbGuard(0, async (db) => {
    let query = db
      .selectFrom('view_sessions')
      // Use raw SQL for COALESCE since device_id is varchar and id is uuid
      .select(sql`COUNT(DISTINCT COALESCE(device_id, id::text))`.as('count'))
      .where('presentation_id', '=', presId);

    query = applyDateFilters(query, opts);

    const result = await query.executeTakeFirst();
    return Number(result?.count) || 0;
  });
}

/**
 * Get presentation overview metrics.
 * @param {string} presentationId - The presentation ID
 * @param {Object} opts - Query options
 * @param {string} [opts.since] - Start date
 * @param {string} [opts.until] - End date
 * @returns {Promise<Object>}
 */
export async function getPresentationOverviewMetrics(presentationId, opts = {}) {
  const presId = norm(presentationId);
  if (!presId) {
    return {
      totalViews: 0,
      uniqueViewers: 0,
      avgDurationSeconds: 0,
      completionRate: 0,
    };
  }

  return withDbGuard({
    totalViews: 0,
    uniqueViewers: 0,
    avgDurationSeconds: 0,
    completionRate: 0,
  }, async (db) => {
    let query = db
      .selectFrom('view_sessions')
      .select([
        (eb) => eb.fn.count('id').as('total_views'),
        // Use raw SQL for COALESCE since device_id is varchar and id is uuid
        sql`COUNT(DISTINCT COALESCE(device_id, id::text))`.as('unique_viewers'),
        (eb) => eb.fn.avg('duration_seconds').as('avg_duration'),
      ])
      .where('presentation_id', '=', presId);

    query = applyDateFilters(query, opts);

    const result = await query.executeTakeFirst();

    return {
      totalViews: Number(result?.total_views) || 0,
      uniqueViewers: Number(result?.unique_viewers) || 0,
      avgDurationSeconds: Math.round(Number(result?.avg_duration) || 0),
      completionRate: 0, // TODO: Calculate based on slide views
    };
  });
}

/**
 * Get views by day for a presentation.
 * @param {string} presentationId - The presentation ID
 * @param {Object} opts - Query options
 * @param {string} [opts.since] - Start date
 * @param {string} [opts.until] - End date
 * @returns {Promise<Array<{date: string, views: number}>>}
 */
export async function getViewsByDay(presentationId, opts = {}) {
  const presId = norm(presentationId);
  if (!presId) return [];

  return withDbGuard([], async (db) => {
    let query = db
      .selectFrom('view_sessions')
      .select([
        sql`date_trunc('day', started_at)::date`.as('date'),
        (eb) => eb.fn.count('id').as('views'),
      ])
      .where('presentation_id', '=', presId)
      .groupBy(sql`date_trunc('day', started_at)`)
      .orderBy(sql`date_trunc('day', started_at)`, 'asc');

    query = applyDateFilters(query, opts);

    const rows = await query.execute();

    return rows.map((row) => ({
      date: row.date?.toISOString?.()?.split('T')[0] || String(row.date),
      views: Number(row.views) || 0,
    }));
  });
}

/**
 * Get views by source type for a presentation.
 * @param {string} presentationId - The presentation ID
 * @param {Object} opts - Query options
 * @returns {Promise<Array<{type: string, count: number}>>}
 */
export async function getViewsBySourceType(presentationId, opts = {}) {
  const presId = norm(presentationId);
  if (!presId) return [];

  return withDbGuard([], async (db) => {
    let query = db
      .selectFrom('view_sessions')
      .select([
        'source_type',
        (eb) => eb.fn.count('id').as('count'),
      ])
      .where('presentation_id', '=', presId)
      .groupBy('source_type')
      .orderBy((eb) => eb.fn.count('id'), 'desc');

    query = applyDateFilters(query, opts);

    const rows = await query.execute();

    return rows.map((row) => ({
      type: row.source_type,
      count: Number(row.count) || 0,
    }));
  });
}

/**
 * Delete old view sessions for cleanup.
 * @param {string} olderThan - ISO date string
 * @returns {Promise<{deleted: number}>}
 */
export async function deleteOldViewSessions(olderThan) {
  return withDbGuard({ deleted: 0 }, async (db) => {
    const result = await db
      .deleteFrom('view_sessions')
      .where('created_at', '<', olderThan)
      .executeTakeFirst();

    return { deleted: Number(result.numDeletedRows) || 0 };
  });
}

// ============================================================
// HELPERS
// ============================================================

function rowToSession(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    presentationId: row.presentation_id,
    sessionToken: row.session_token,
    sourceType: row.source_type,
    sourceId: row.source_id,
    viewerType: row.viewer_type,
    viewerEmail: row.viewer_email,
    deviceId: row.device_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    lastActivityAt: row.last_activity_at,
    durationSeconds: row.duration_seconds,
    exitSlideId: row.exit_slide_id,
    exitSlideIndex: row.exit_slide_index,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    isInternal: row.is_internal ?? false,
    attributionAllowed: row.attribution_allowed ?? false,
    createdAt: row.created_at,
  };
}