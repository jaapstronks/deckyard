/**
 * Analytics reports storage for shareable report data.
 */

import crypto from 'node:crypto';
import { norm, nowIso } from '../../utils/normalize.js';
import { withDbGuard } from '../utils/db-guard.js';
import { getOrgId } from '../../utils/context.js';

// ============================================================
// CONSTANTS
// ============================================================

export const REPORT_TYPES = {
  SUMMARY: 'summary',
  DETAILED: 'detailed',
  ENGAGEMENT: 'engagement',
};

// ============================================================
// REPORT CRUD
// ============================================================

/**
 * Generate a unique share token.
 * @returns {string} 64-character hex token
 */
function generateShareToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a new analytics report.
 * @param {Object} data - Report data
 * @param {string} data.presentationId - The presentation ID
 * @param {string} data.title - Report title
 * @param {string} data.reportType - 'summary' | 'detailed' | 'engagement'
 * @param {string} data.startDate - Report start date
 * @param {string} data.endDate - Report end date
 * @param {Object} data.reportData - Pre-computed report data
 * @param {boolean} [data.isPublic] - Whether report is publicly accessible
 * @param {number} [data.expiresInDays] - Days until share link expires
 * @param {string} data.createdBy - Email of creator
 * @param {Object} ctx - Request context
 * @returns {Promise<{ok: boolean, report?: Object, reason?: string}>}
 */
export async function createAnalyticsReport(data, ctx) {
  const presentationId = norm(data?.presentationId);
  const title = norm(data?.title);
  const reportType = norm(data?.reportType);
  const startDate = norm(data?.startDate);
  const endDate = norm(data?.endDate);
  const createdBy = norm(data?.createdBy)?.toLowerCase();

  if (!presentationId || !title || !reportType || !startDate || !endDate || !createdBy) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const now = nowIso();
    const shareToken = data?.isPublic ? generateShareToken() : null;

    // Calculate expiration if specified
    let shareExpiresAt = null;
    if (data?.isPublic && data?.expiresInDays) {
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + data.expiresInDays);
      shareExpiresAt = expirationDate.toISOString();
    }

    const row = await db
      .insertInto('analytics_reports')
      .values({
        organization_id: orgId,
        presentation_id: presentationId,
        title: title,
        report_type: reportType,
        start_date: startDate,
        end_date: endDate,
        share_token: shareToken,
        share_expires_at: shareExpiresAt,
        is_public: data?.isPublic || false,
        report_data: data?.reportData || {},
        generated_at: now,
        created_by: createdBy,
        created_at: now,
      })
      .returningAll()
      .executeTakeFirst();

    return {
      ok: true,
      report: rowToReport(row),
    };
  });
}

/**
 * Get an analytics report by ID.
 * @param {string} reportId - The report ID
 * @param {Object} ctx - Request context
 * @returns {Promise<Object|null>}
 */
export async function getAnalyticsReport(reportId, ctx) {
  const id = norm(reportId);
  if (!id) return null;

  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .selectFrom('analytics_reports')
      .selectAll()
      .where('id', '=', id)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (!row) return null;
    return rowToReport(row);
  });
}

/**
 * Constant-time comparison for token strings.
 * Prevents timing attacks by ensuring comparison takes same time regardless of match.
 * @param {string} a - First token
 * @param {string} b - Second token
 * @returns {boolean} True if tokens match
 */
function constantTimeTokenCompare(a, b) {
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Get an analytics report by share token (public access).
 * @param {string} shareToken - The share token
 * @returns {Promise<Object|null>}
 */
export async function getAnalyticsReportByToken(shareToken) {
  const token = norm(shareToken);
  if (!token) return null;

  return withDbGuard(null, async (db) => {
    const row = await db
      .selectFrom('analytics_reports')
      .selectAll()
      .where('share_token', '=', token)
      .where('is_public', '=', true)
      .executeTakeFirst();

    if (!row) return null;

    // Defense in depth: verify token match with constant-time comparison
    // to prevent any potential timing side-channel attacks
    if (!constantTimeTokenCompare(row.share_token, token)) {
      return null;
    }

    // Check expiration
    if (row.share_expires_at) {
      const expiresAt = new Date(row.share_expires_at);
      if (expiresAt < new Date()) {
        return null; // Expired
      }
    }

    return rowToReport(row);
  });
}

/**
 * List analytics reports for a presentation.
 * @param {string} presentationId - The presentation ID
 * @param {Object} ctx - Request context
 * @param {Object} opts - Query options
 * @returns {Promise<{reports: Object[], total: number}>}
 */
export async function listAnalyticsReports(presentationId, ctx, opts = {}) {
  const presId = norm(presentationId);
  if (!presId) return { reports: [], total: 0 };

  return withDbGuard({ reports: [], total: 0 }, async (db) => {
    const orgId = getOrgId(ctx);

    let query = db
      .selectFrom('analytics_reports')
      .selectAll()
      .where('presentation_id', '=', presId)
      .where('organization_id', '=', orgId);

    // Count total
    const countQuery = query
      .clearSelect()
      .select((eb) => eb.fn.count('id').as('count'));
    const countResult = await countQuery.executeTakeFirst();
    const total = Number(countResult?.count) || 0;

    // Apply pagination
    const limit = Math.min(opts?.limit || 20, 50);
    const offset = opts?.offset || 0;

    query = query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    const rows = await query.execute();

    return {
      reports: rows.map(rowToReport),
      total,
      limit,
      offset,
    };
  });
}

/**
 * Update an analytics report.
 * @param {string} reportId - The report ID
 * @param {Object} updates - Update data
 * @param {Object} ctx - Request context
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function updateAnalyticsReport(reportId, updates, ctx) {
  const id = norm(reportId);
  if (!id) return { ok: false, reason: 'invalid' };

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    const updateData = {};

    if (updates?.title != null) {
      updateData.title = norm(updates.title);
    }

    if (updates?.isPublic != null) {
      updateData.is_public = Boolean(updates.isPublic);
      // Generate new token if becoming public
      if (updates.isPublic && !updates.keepToken) {
        updateData.share_token = generateShareToken();
      }
      // Clear token if becoming private
      if (!updates.isPublic) {
        updateData.share_token = null;
        updateData.share_expires_at = null;
      }
    }

    if (updates?.expiresInDays != null) {
      if (updates.expiresInDays === 0 || updates.expiresInDays === null) {
        updateData.share_expires_at = null;
      } else {
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + updates.expiresInDays);
        updateData.share_expires_at = expirationDate.toISOString();
      }
    }

    if (Object.keys(updateData).length === 0) {
      return { ok: true }; // Nothing to update
    }

    await db
      .updateTable('analytics_reports')
      .set(updateData)
      .where('id', '=', id)
      .where('organization_id', '=', orgId)
      .execute();

    return { ok: true };
  });
}

/**
 * Delete an analytics report.
 * @param {string} reportId - The report ID
 * @param {Object} ctx - Request context
 * @returns {Promise<{ok: boolean, deleted?: boolean, reason?: string}>}
 */
export async function deleteAnalyticsReport(reportId, ctx) {
  const id = norm(reportId);
  if (!id) return { ok: false, reason: 'invalid' };

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    const result = await db
      .deleteFrom('analytics_reports')
      .where('id', '=', id)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    const deleted = Number(result.numDeletedRows) > 0;

    return { ok: true, deleted };
  });
}

/**
 * Regenerate share token for a report.
 * @param {string} reportId - The report ID
 * @param {Object} ctx - Request context
 * @returns {Promise<{ok: boolean, shareToken?: string, reason?: string}>}
 */
export async function regenerateShareToken(reportId, ctx) {
  const id = norm(reportId);
  if (!id) return { ok: false, reason: 'invalid' };

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const newToken = generateShareToken();

    await db
      .updateTable('analytics_reports')
      .set({
        share_token: newToken,
        is_public: true,
      })
      .where('id', '=', id)
      .where('organization_id', '=', orgId)
      .execute();

    return { ok: true, shareToken: newToken };
  });
}

// ============================================================
// HELPERS
// ============================================================

function rowToReport(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    presentationId: row.presentation_id,
    title: row.title,
    reportType: row.report_type,
    startDate: row.start_date,
    endDate: row.end_date,
    shareToken: row.share_token,
    shareExpiresAt: row.share_expires_at,
    isPublic: row.is_public,
    reportData: row.report_data || {},
    generatedAt: row.generated_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}