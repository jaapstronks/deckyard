/**
 * View sessions storage for tracking presentation views.
 * Handles session lifecycle: create, heartbeat, end.
 */

import crypto from 'node:crypto';
import { norm, nowIso, durationSinceSeconds } from '../../utils/normalize.js';
import { normalizeEmail } from '../../../shared/email.js';
import { withDbGuard } from '../../db/client.js';
import { toStorageContext } from '../scope.js';
import { ANALYTICS_CONFIG, applyDateFilters } from '../../analytics/helpers.js';
import { keysetPage, keysetRows } from '../keyset.js';

async function presentationInScope(db, organizationId, presentationId) {
  return !!(await db
    .selectFrom('presentations')
    .select('id')
    .where('id', '=', presentationId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst());
}

// ============================================================
// CONSTANTS
// ============================================================

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
 * @param {boolean} [data.attributionAllowed] - True if viewer opts into having name shown
 * @param {boolean} [data.completed] - A server-side page visit, already complete
 * @returns {Promise<{ok: boolean, session?: Object, reason?: string}>}
 */
export async function createViewSession(scope, data) {
  const { organizationId } = toStorageContext(scope, 'createViewSession');
  const presentationId = norm(data?.presentationId);
  const sourceType = norm(data?.sourceType);

  if (!presentationId || !sourceType) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    if (!(await presentationInScope(db, organizationId, presentationId))) {
      return { ok: false, reason: 'not_found' };
    }
    const now = nowIso();
    const sessionToken = generateSessionToken();

    const row = await db
      .insertInto('view_sessions')
      .values({
        // No organization column: a view session inherits its organization from
        // the presentation it belongs to (tenant-isolation.md rule R2). The
        // column that used to sit here held a viewer-claimed organization and
        // was dropped in migration 065.
        presentation_id: presentationId,
        session_token: sessionToken,
        source_type: sourceType,
        source_id: data?.sourceId ?? null,
        viewer_type: data?.viewerType ?? VIEWER_TYPES.ANONYMOUS,
        viewer_email: normalizeEmail(data?.viewerEmail),
        device_id: data?.deviceId ?? null,
        started_at: now,
        last_activity_at: now,
        ended_at: data?.completed ? now : null,
        duration_seconds: 0,
        ip_address: data?.ipAddress ?? null,
        user_agent: data?.userAgent ?? null,
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
 * One page of a deck's view sessions in a date window (B825, D358): order
 * `(started_at desc, id desc)`, continued after `after`. The window is a
 * filter of the query, not of the page.
 *
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} presentationId - The presentation ID
 * @param {Object} opts
 * @param {number} opts.limit - Rows per page.
 * @param {{value: string, id: string}|null} [opts.after] - Last row seen.
 * @param {string} [opts.since] - Start date filter
 * @param {string} [opts.until] - End date filter
 * @returns {Promise<{items: Object[], next: {value: string, id: string}|null}>}
 */
export async function listViewSessions(scope, presentationId, opts) {
  const { organizationId } = toStorageContext(scope, 'listViewSessions');
  const presId = norm(presentationId);
  const empty = { items: [], next: null };
  if (!presId) return empty;

  return withDbGuard(empty, async (db) => {
    if (!(await presentationInScope(db, organizationId, presId))) {
      return empty;
    }
    const query = applyDateFilters(
      db
        .selectFrom('view_sessions')
        .selectAll()
        .where('presentation_id', '=', presId),
      opts,
    );
    const { rows, next } = keysetRows(
      await keysetPage(query, {
        column: 'started_at',
        after: opts.after ?? null,
        limit: opts.limit,
      }).execute(),
      opts.limit,
    );
    return { items: rows.map(rowToSession), next };
  });
}

/**
 * Get count of currently active viewers for a presentation.
 * @param {string} presentationId - The presentation ID
 * @returns {Promise<number>}
 */
export async function getActiveViewerCount(scope, presentationId) {
  const { organizationId } = toStorageContext(scope, 'getActiveViewerCount');
  const presId = norm(presentationId);
  if (!presId) return 0;

  return withDbGuard(0, async (db) => {
    if (!(await presentationInScope(db, organizationId, presId))) return 0;
    const threshold = new Date(
      Date.now() - ANALYTICS_CONFIG.ACTIVE_THRESHOLD_SECONDS * 1000,
    ).toISOString();

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
 * Delete old view sessions for cleanup.
 * @param {string} olderThan - ISO date string
 * @returns {Promise<{deleted: number}>}
 */
export async function deleteOldViewSessions(scope, olderThan) {
  const context = toStorageContext(
    scope,
    'deleteOldViewSessions',
    {},
    { allowCrossOrganization: true },
  );

  if (!context.crossOrganization)
    throw new TypeError(
      'deleteOldViewSessions() requires an instance retention scope',
    );
  return withDbGuard({ deleted: 0 }, async (db) => {
    const result = await db
      .deleteFrom('view_sessions')
      .where('created_at', '<', olderThan)
      .executeTakeFirst();

    return { deleted: Number(result.numDeletedRows) || 0 };
  });
}

/**
 * How many rows the analytics tables hold across the instance: view sessions
 * (their slide views hang off them) and saved reports. Read once at boot when
 * the cluster is off, so the operator learns the data is still there (D261).
 *
 * @param {import('../scope.js').StorageScope} scope - Cross-organization.
 * @returns {Promise<{sessions: number, reports: number}>} Zeros without a database.
 */
export async function countAnalyticsRows(scope) {
  toStorageContext(
    scope,
    'countAnalyticsRows',
    {},
    { allowCrossOrganization: true },
  );
  return withDbGuard({ sessions: 0, reports: 0 }, async (db) => {
    const count = async (table) => {
      const row = await db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll().as('n'))
        .executeTakeFirst();
      return Number(row?.n) || 0;
    };
    return {
      sessions: await count('view_sessions'),
      reports: await count('analytics_reports'),
    };
  });
}

// ============================================================
// HELPERS
// ============================================================

function rowToSession(row) {
  return {
    id: row.id,
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
    attributionAllowed: row.attribution_allowed ?? false,
    createdAt: row.created_at,
  };
}
