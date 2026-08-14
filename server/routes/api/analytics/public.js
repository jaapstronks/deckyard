/**
 * Public analytics report access (no auth required).
 */

import { getClientIp, allowRequest } from '../../../utils/rate-limit.js';
import { dispatchRoutes } from '../../../utils/router.js';
import {
  logSecurityEvent,
  SECURITY_EVENTS,
  isValidSessionToken,
} from '../../../analytics/helpers.js';
import { AUTH_RATE_LIMITS } from '../../../config/rate-limits.js';
import { getAnalyticsReportByToken } from '../../../storage/analytics/reports.js';
import { normalizePresentationVisibility } from '../../../utils/presentation-authz.js';
import { crossOrganizationScope } from '../../../storage/scope.js';
import { badRequest, forbidden, notFound, rateLimited, serveJson, withErrorHandler } from '../../../utils/http.js';

/**
 * GET /api/analytics/reports/:token - Public report access (no auth required).
 * The report token is the authorization.
 * @param {import('../../../utils/context.js').PublicContext} ctx
 * @param {string} token - The report share token from the path.
 * @returns {Promise<boolean>} True (always handled once matched).
 */
async function handlePublicReport({ req, res, url }, token) {
  const path = url.pathname;
  const clientIp = getClientIp(req);

  // Rate limit to prevent token enumeration attacks
  if (!(await allowRequest(`report:public:${clientIp}`, AUTH_RATE_LIMITS.publicReport))) {
    logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
      ip: clientIp,
      endpoint: path,
      limitType: 'publicReport',
    });
    return rateLimited(res, 5);
  }

  // Validate token format (64 hex chars)
  if (!isValidSessionToken(token)) {
    logSecurityEvent(SECURITY_EVENTS.INVALID_TOKEN, {
      ip: clientIp,
      endpoint: path,
      tokenPrefix: token?.slice(0, 8) + '...',
    });
    return badRequest(res, 'Invalid token format');
  }

  const report = await getAnalyticsReportByToken(token);

  if (!report) {
    return notFound(res, 'Report not found or expired');
  }

  // Verify the associated presentation still exists and is accessible
  // This prevents sharing reports for deleted/private presentations
  const { getPresentation } = await import('../../../storage/presentations/index.js');
  const presentation = await getPresentation(
    crossOrganizationScope(null, 'public analytics report: the report token is the authorization'),
    report.presentationId
  );
  if (!presentation) {
    return notFound(res, 'Report not available - presentation no longer exists');
  }

  // Check if the presentation has been set to private. Decks carry
  // `visibility` (private/organization); the pre-B41 `settings.visibility`
  // field never exists, so
  // this branch used to be dead — a report share-link stayed live after the
  // deck went private.
  if (normalizePresentationVisibility(presentation.visibility) === 'private') {
    return forbidden(res, 'Report not available - presentation is private');
  }

  return serveJson(res, 200, report), true;
}

/**
 * Declarative route table for the public analytics surface (A7.19 C8). A single
 * GET route; any other method falls through (the original chain sent no 405).
 *
 * @type {import('../../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: /^\/api\/analytics\/reports\/([^/]+)$/, handler: handlePublicReport },
];

/**
 * Handle public analytics report access (no auth required).
 * @param {import('../../../utils/context.js').PublicContext} ctx
 * @returns {Promise<boolean>} True if handled
 */
export const handleAnalyticsReportPublic = withErrorHandler('analytics', (ctx) => {
  return dispatchRoutes(ROUTES, ctx);
});
