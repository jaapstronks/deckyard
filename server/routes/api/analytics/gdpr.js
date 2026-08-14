/**
 * GDPR data access endpoints.
 */

import { allowRequest } from '../../../utils/rate-limit.js';
import {
  logSecurityEvent,
  SECURITY_EVENTS,
} from '../../../analytics/helpers.js';
import { getErrorStatus, jsonError, rateLimited, serveJson, unauthorized } from '../../../utils/http.js';
import { AUTH_RATE_LIMITS } from '../../../config/rate-limits.js';
import {
  exportUserAnalyticsData,
  deleteUserAnalyticsData,
} from '../../../storage/analytics/view-sessions.js';

/**
 * GET /api/analytics/my-data - Export user's own analytics data (GDPR).
 */
export async function handleExportMyData(ctx) {
  const { res, url, authedUser } = ctx;
  const path = url.pathname;

  if (!authedUser?.email) {
    return unauthorized(res, 'Authentication required');
  }

  // Stricter rate limit for GDPR export (expensive operation)
  if (!(await allowRequest(`analytics:gdpr:export:${authedUser.email}`, AUTH_RATE_LIMITS.expensive))) {
    logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
      endpoint: path,
      user: authedUser.email,
      limitType: 'gdprExport',
    });
    return rateLimited(res, 5, 'Rate limit exceeded for data export');
  }

  // Identity is the scope: the export covers this person's sessions on the
  // whole instance, not just the organization they happen to be acting in.
  const result = await exportUserAnalyticsData({ email: authedUser.email });

  if (!result.ok) {
    return jsonError(res, getErrorStatus(result.reason, 500), result.reason || 'internal_error', 'Failed to export data');
  }

  return serveJson(res, 200, result.data), true;
}

/**
 * DELETE /api/analytics/my-data - Delete user's own analytics data (GDPR right to erasure).
 */
export async function handleDeleteMyData(ctx) {
  const { res, url, authedUser } = ctx;
  const path = url.pathname;

  if (!authedUser?.email) {
    return unauthorized(res, 'Authentication required');
  }

  // Stricter rate limit for GDPR delete (expensive/destructive operation)
  if (!(await allowRequest(`analytics:gdpr:delete:${authedUser.email}`, AUTH_RATE_LIMITS.expensive))) {
    logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
      endpoint: path,
      user: authedUser.email,
      limitType: 'gdprDelete',
    });
    return rateLimited(res, 5, 'Rate limit exceeded for data deletion');
  }

  // Identity is the scope — an erasure that stopped at the acting organization
  // would report success while leaving the same person's rows behind.
  const result = await deleteUserAnalyticsData({ email: authedUser.email });

  if (!result.ok) {
    return jsonError(res, getErrorStatus(result.reason, 500), result.reason || 'internal_error', 'Failed to delete data');
  }

  return serveJson(res, 200, {
    ok: true,
    deleted: result.deleted,
    message: 'Your analytics data has been deleted',
  }), true;
}
