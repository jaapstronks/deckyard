/**
 * GDPR data access endpoints.
 */

import { allowRequest } from '../../../utils/rate-limit.js';
import {
  AUTH_RATE_LIMITS,
  sendRateLimitResponse,
  sendErrorResponse,
  sendSuccessResponse,
  logSecurityEvent,
  SECURITY_EVENTS,
} from '../../../analytics/helpers.js';
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
    return sendErrorResponse(res, 401, 'Authentication required'), true;
  }

  // Stricter rate limit for GDPR export (expensive operation)
  if (!allowRequest(`analytics:gdpr:export:${authedUser.email}`, AUTH_RATE_LIMITS.expensive)) {
    logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
      endpoint: path,
      user: authedUser.email,
      limitType: 'gdprExport',
    });
    return sendRateLimitResponse(res, 'Rate limit exceeded for data export', 5), true;
  }

  const result = await exportUserAnalyticsData({
    email: authedUser.email,
    organizationId: authedUser.organizationId,
  });

  if (!result.ok) {
    return sendErrorResponse(res, 500, result.reason || 'Failed to export data'), true;
  }

  return sendSuccessResponse(res, result.data), true;
}

/**
 * DELETE /api/analytics/my-data - Delete user's own analytics data (GDPR right to erasure).
 */
export async function handleDeleteMyData(ctx) {
  const { res, url, authedUser } = ctx;
  const path = url.pathname;

  if (!authedUser?.email) {
    return sendErrorResponse(res, 401, 'Authentication required'), true;
  }

  // Stricter rate limit for GDPR delete (expensive/destructive operation)
  if (!allowRequest(`analytics:gdpr:delete:${authedUser.email}`, AUTH_RATE_LIMITS.expensive)) {
    logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
      endpoint: path,
      user: authedUser.email,
      limitType: 'gdprDelete',
    });
    return sendRateLimitResponse(res, 'Rate limit exceeded for data deletion', 5), true;
  }

  const result = await deleteUserAnalyticsData({
    email: authedUser.email,
    organizationId: authedUser.organizationId,
  });

  if (!result.ok) {
    return sendErrorResponse(res, 500, result.reason || 'Failed to delete data'), true;
  }

  return sendSuccessResponse(res, {
    ok: true,
    deleted: result.deleted,
    message: 'Your analytics data has been deleted',
  }), true;
}
