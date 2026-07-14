/**
 * GDPR Data Access Functions for View Sessions
 *
 * Handles GDPR compliance operations:
 * - Data export (right to access)
 * - Data deletion (right to erasure)
 * - Data anonymization (retention policy)
 */

import { withDbGuard } from '../utils/db-guard.js';

/**
 * Export all analytics data for a user (GDPR data export).
 * Finds data by email address or device ID, scoped to organization.
 * @param {Object} identifier - User identifier
 * @param {string} [identifier.email] - User's email address
 * @param {string} [identifier.deviceId] - User's device ID
 * @param {string} [identifier.organizationId] - Organization ID to scope the query (recommended for multi-tenant)
 * @returns {Promise<{ok: boolean, data?: Object, reason?: string}>}
 */
export async function exportUserAnalyticsData({ email, deviceId, organizationId }) {
  const normalizedEmail = email?.toLowerCase()?.trim();
  const normalizedDeviceId = deviceId?.trim();
  const normalizedOrgId = organizationId?.trim() || null;

  if (!normalizedEmail && !normalizedDeviceId) {
    return { ok: false, reason: 'No identifier provided' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    // Build query to find sessions by email or device ID
    let sessionsQuery = db.selectFrom('view_sessions').selectAll();

    // Scope to organization if provided (recommended for multi-tenant security)
    if (normalizedOrgId) {
      sessionsQuery = sessionsQuery.where('organization_id', '=', normalizedOrgId);
    }

    if (normalizedEmail && normalizedDeviceId) {
      sessionsQuery = sessionsQuery.where((eb) =>
        eb.or([
          eb('viewer_email', '=', normalizedEmail),
          eb('device_id', '=', normalizedDeviceId),
        ])
      );
    } else if (normalizedEmail) {
      sessionsQuery = sessionsQuery.where('viewer_email', '=', normalizedEmail);
    } else {
      sessionsQuery = sessionsQuery.where('device_id', '=', normalizedDeviceId);
    }

    const sessions = await sessionsQuery.orderBy('started_at', 'desc').execute();

    if (sessions.length === 0) {
      return { ok: true, data: { sessions: [], slideViews: [] } };
    }

    // Get session IDs for slide view lookup
    const sessionIds = sessions.map((s) => s.id);

    // Get slide views for these sessions
    const slideViews = await db
      .selectFrom('slide_views')
      .selectAll()
      .where('view_session_id', 'in', sessionIds)
      .orderBy('entered_at', 'desc')
      .execute();

    // Format data for export (remove internal IDs, tokens)
    const exportedSessions = sessions.map((row) => ({
      presentationId: row.presentation_id,
      sourceType: row.source_type,
      viewerType: row.viewer_type,
      viewerEmail: row.viewer_email,
      deviceId: row.device_id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationSeconds: row.duration_seconds,
      exitSlideIndex: row.exit_slide_index,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: row.created_at,
    }));

    const exportedSlideViews = slideViews.map((row) => ({
      presentationId: row.presentation_id,
      slideId: row.slide_id,
      slideIndex: row.slide_index,
      enteredAt: row.entered_at,
      exitedAt: row.exited_at,
      durationSeconds: row.duration_seconds,
      visitNumber: row.visit_number,
    }));

    return {
      ok: true,
      data: {
        exportedAt: new Date().toISOString(),
        identifier: { email: normalizedEmail, deviceId: normalizedDeviceId },
        sessions: exportedSessions,
        slideViews: exportedSlideViews,
        totalSessions: exportedSessions.length,
        totalSlideViews: exportedSlideViews.length,
      },
    };
  });
}

/**
 * Delete all analytics data for a user (GDPR right to erasure).
 * Deletes by email address or device ID, scoped to organization.
 * @param {Object} identifier - User identifier
 * @param {string} [identifier.email] - User's email address
 * @param {string} [identifier.deviceId] - User's device ID
 * @param {string} [identifier.organizationId] - Organization ID to scope the deletion (recommended for multi-tenant)
 * @returns {Promise<{ok: boolean, deleted?: {sessions: number, slideViews: number}, reason?: string}>}
 */
export async function deleteUserAnalyticsData({ email, deviceId, organizationId }) {
  const normalizedEmail = email?.toLowerCase()?.trim();
  const normalizedDeviceId = deviceId?.trim();
  const normalizedOrgId = organizationId?.trim() || null;

  if (!normalizedEmail && !normalizedDeviceId) {
    return { ok: false, reason: 'No identifier provided' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    return db.transaction().execute(async (trx) => {
      // Find sessions to delete
      let findQuery = trx.selectFrom('view_sessions').select('id');

      // Scope to organization if provided (recommended for multi-tenant security)
      if (normalizedOrgId) {
        findQuery = findQuery.where('organization_id', '=', normalizedOrgId);
      }

      if (normalizedEmail && normalizedDeviceId) {
        findQuery = findQuery.where((eb) =>
          eb.or([
            eb('viewer_email', '=', normalizedEmail),
            eb('device_id', '=', normalizedDeviceId),
          ])
        );
      } else if (normalizedEmail) {
        findQuery = findQuery.where('viewer_email', '=', normalizedEmail);
      } else {
        findQuery = findQuery.where('device_id', '=', normalizedDeviceId);
      }

      const sessions = await findQuery.execute();
      const sessionIds = sessions.map((s) => s.id);

      let deletedSlideViews = 0;
      let deletedSessions = 0;

      if (sessionIds.length > 0) {
        // Delete slide views first (foreign key constraint)
        const slideViewResult = await trx
          .deleteFrom('slide_views')
          .where('view_session_id', 'in', sessionIds)
          .executeTakeFirst();
        deletedSlideViews = Number(slideViewResult.numDeletedRows) || 0;

        // Delete sessions
        const sessionResult = await trx
          .deleteFrom('view_sessions')
          .where('id', 'in', sessionIds)
          .executeTakeFirst();
        deletedSessions = Number(sessionResult.numDeletedRows) || 0;
      }

      return {
        ok: true,
        deleted: {
          sessions: deletedSessions,
          slideViews: deletedSlideViews,
        },
      };
    });
  });
}

/**
 * Anonymize IP addresses for old sessions.
 * Replaces IP addresses with hashed versions after retention period.
 * @param {string} olderThan - ISO date string
 * @returns {Promise<{anonymized: number}>}
 */
export async function anonymizeOldIpAddresses(olderThan) {
  return withDbGuard({ anonymized: 0 }, async (db) => {
    // Update sessions older than threshold to have anonymized IPs
    // We set them to null since hashing would still be linkable
    const result = await db
      .updateTable('view_sessions')
      .set({ ip_address: null })
      .where('created_at', '<', olderThan)
      .where('ip_address', 'is not', null)
      .executeTakeFirst();

    return { anonymized: Number(result.numUpdatedRows) || 0 };
  });
}