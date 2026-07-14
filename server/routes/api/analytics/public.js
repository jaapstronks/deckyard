/**
 * Public analytics report access (no auth required).
 */

import { getClientIp, allowRequest } from '../../../utils/rate-limit.js';
import {
  AUTH_RATE_LIMITS,
  sendRateLimitResponse,
  sendErrorResponse,
  sendSuccessResponse,
  logSecurityEvent,
  SECURITY_EVENTS,
  isValidSessionToken,
} from '../../../analytics/helpers.js';
import { getAnalyticsReportByToken } from '../../../storage/analytics/reports.js';

/**
 * Handle public analytics report access (no auth required).
 * @param {Object} ctx - Request context
 * @returns {Promise<boolean>} True if handled
 */
export async function handleAnalyticsReportPublic({ req, res, url }) {
  const path = url.pathname;

  // GET /api/analytics/reports/:token - Public report access
  const tokenMatch = path.match(/^\/api\/analytics\/reports\/([^/]+)$/);
  if (req.method === 'GET' && tokenMatch) {
    const clientIp = getClientIp(req);

    // Rate limit to prevent token enumeration attacks
    if (!allowRequest(`report:public:${clientIp}`, AUTH_RATE_LIMITS.publicReport)) {
      logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
        ip: clientIp,
        endpoint: path,
        limitType: 'publicReport',
      });
      return sendRateLimitResponse(res, 'Rate limit exceeded', 5), true;
    }

    const token = tokenMatch[1];

    // Validate token format (64 hex chars)
    if (!isValidSessionToken(token)) {
      logSecurityEvent(SECURITY_EVENTS.INVALID_TOKEN, {
        ip: clientIp,
        endpoint: path,
        tokenPrefix: token?.slice(0, 8) + '...',
      });
      return sendErrorResponse(res, 400, 'Invalid token format'), true;
    }

    const report = await getAnalyticsReportByToken(token);

    if (!report) {
      return sendErrorResponse(res, 404, 'Report not found or expired'), true;
    }

    // Verify the associated presentation still exists and is accessible
    // This prevents sharing reports for deleted/private presentations
    const { getPresentation } = await import('../../../storage/presentations.js');
    const presentation = await getPresentation(null, report.presentationId);
    if (!presentation) {
      return sendErrorResponse(res, 404, 'Report not available - presentation no longer exists'), true;
    }

    // Check if presentation has been set to private/restricted
    if (presentation.settings?.visibility === 'private') {
      return sendErrorResponse(res, 403, 'Report not available - presentation is private'), true;
    }

    return sendSuccessResponse(res, report), true;
  }

  return false;
}
