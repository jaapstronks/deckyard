/**
 * Public tracking endpoints for analytics.
 * These endpoints do NOT require authentication and are used by viewers.
 */

import {
  badRequest,
  getErrorStatus,
  jsonError,
  notFound,
  rateLimited,
  requireJsonBody,
  serveJson,
  withErrorHandler,
} from '../../utils/http.js';
import { isUuid } from '../../utils/uuid.js';
import { dispatchRoutes } from '../../utils/router.js';
import { norm } from '../../utils/normalize.js';
import { redactSecret } from '../../utils/log-redact.js';
import { getClientIp, allowRequest } from '../../utils/rate-limit.js';
import { getPresentation } from '../../storage/presentations/index.js';
import { validateShareLink } from '../../storage/share-links/crud.js';
import { getAppSettings, getUserSettings } from '../../storage/settings.js';
import {
  isValidDeviceId,
  isValidSessionToken,
  isValidSlideIndex,
  isValidSourceType,
  sanitizeUserAgent,
  logSecurityEvent,
  SECURITY_EVENTS,
  SOURCE_TYPES,
} from '../../analytics/helpers.js';
import {
  TRACKING_RATE_LIMITS,
  AUTH_RATE_LIMITS,
} from '../../config/rate-limits.js';
import {
  createViewSession,
  updateViewSession,
  endViewSession,
  getViewSessionByToken,
  eraseAnalyticsDataForDevice,
  eraseAnalyticsDataForSession,
  VIEWER_TYPES,
} from '../../storage/analytics/view-sessions.js';
import {
  transitionToSlide,
  endAllSlideViewsForSession,
} from '../../storage/analytics/slide-views.js';
import { getFollowStateForPresentation } from '../../storage/live-sessions/follow-state.js';
import { createLogger } from '../../utils/logger.js';
import { crossOrganizationScope } from '../../storage/scope.js';
const log = createLogger('analytics-track');

/**
 * Validate presentation access for analytics tracking.
 * Ensures the viewer has legitimate access to the presentation.
 *
 * Failures carry a machine code from `ERROR_STATUS_MAP` (`not_found` /
 * `forbidden`) plus a human `message` — the route answers with
 * `jsonError(res, getErrorStatus(code), code, message)`, no prose matching
 * (A7.19-C7h).
 *
 * @param {Object} data - Request data
 * @param {string} data.presentationId - The presentation ID
 * @param {string} data.sourceType - The source type
 * @param {string} [data.sourceId] - The source ID (share token for share_link)
 * @param {Object} ctx - Request context
 * @returns {Promise<{ok: true, presentation: Object}|{ok: false, code: string, message: string}>}
 */
async function validatePresentationAccess(data, ctx) {
  const { presentationId, sourceType, sourceId } = data;

  // A non-uuid id cannot name a presentation; answer before the query would
  // make the Postgres uuid parser 500 (22P02).
  if (!isUuid(presentationId)) {
    return { ok: false, code: 'not_found', message: 'Presentation not found' };
  }

  // Get the presentation first
  const presentation = await getPresentation(
    crossOrganizationScope(
      null,
      'analytics ingest from a public viewer; the source token is verified below',
    ),
    presentationId,
  );
  if (!presentation) {
    return { ok: false, code: 'not_found', message: 'Presentation not found' };
  }

  // Check if analytics is enabled for this presentation
  if (presentation.settings?.analyticsEnabled === false) {
    return {
      ok: false,
      code: 'forbidden',
      message: 'Analytics disabled for this presentation',
    };
  }

  // Validate access based on source type
  switch (sourceType) {
    case SOURCE_TYPES.SHARE_LINK: {
      // Share link access requires a valid share token
      if (!sourceId) {
        return {
          ok: false,
          code: 'forbidden',
          message: 'Share link token required',
        };
      }

      const validation = await validateShareLink(sourceId);
      if (!validation.ok) {
        logSecurityEvent(SECURITY_EVENTS.ACCESS_DENIED, {
          endpoint: '/api/track/session/start',
          reason: `Invalid share link: ${validation.reason}`,
          presentationId,
          sourceType,
        });
        return {
          ok: false,
          code: 'forbidden',
          message: 'Invalid or expired share link',
        };
      }

      // Verify the share link is for this presentation
      if (validation.shareLink.presentationId !== presentationId) {
        logSecurityEvent(SECURITY_EVENTS.ACCESS_DENIED, {
          endpoint: '/api/track/session/start',
          reason: 'Share link presentation mismatch',
          presentationId,
          shareLinkPresentationId: validation.shareLink.presentationId,
        });
        return {
          ok: false,
          code: 'forbidden',
          message: 'Share link does not match presentation',
        };
      }

      return { ok: true, presentation };
    }

    case SOURCE_TYPES.FOLLOW: {
      // Follow mode: validate that there's an active follow session for this presentation
      const followState = await getFollowStateForPresentation(
        crossOrganizationScope(
          ctx?.repoRoot ?? null,
          'analytics track: the viewer is a follow-along audience member',
        ),
        presentationId,
      );

      // Allow if there's a live or recently ended follow session
      // We're lenient here because viewers might join slightly after the session ends
      if (followState.status === 'live' || followState.status === 'ended') {
        return { ok: true, presentation };
      }

      // Log denied access for follow with no session
      logSecurityEvent(SECURITY_EVENTS.ACCESS_DENIED, {
        endpoint: '/api/track/session/start',
        reason: 'No active follow session for presentation',
        presentationId,
        followStatus: followState.status,
        sourceType,
      });

      return {
        ok: false,
        code: 'forbidden',
        message: 'No active follow session',
      };
    }

    case SOURCE_TYPES.EMBED: {
      // Embedded presentations: check if embedding is allowed
      // Currently we allow embedding if:
      // 1. The presentation exists (already verified)
      // 2. Analytics tracking is enabled (verified by presentation.analyticsEnabled)

      // Future enhancement: validate against allowed embed domains
      // by checking the Referer/Origin header against a whitelist in presentation settings
      // Example: presentation.allowedEmbedDomains = ['example.com', 'mysite.com']

      // For now, allow if presentation exists with analytics enabled
      return { ok: true, presentation };
    }

    case SOURCE_TYPES.PUBLISHED: {
      // Published pages: verify the presentation is actually published
      if (!presentation.published?.id) {
        logSecurityEvent(SECURITY_EVENTS.ACCESS_DENIED, {
          endpoint: '/api/track/session/start',
          reason: 'Presentation is not published',
          presentationId,
          sourceType,
        });
        return {
          ok: false,
          code: 'forbidden',
          message: 'Presentation is not published',
        };
      }

      // Optionally verify the sourceId matches the publish ID
      if (sourceId && presentation.published.id !== sourceId) {
        logSecurityEvent(SECURITY_EVENTS.ACCESS_DENIED, {
          endpoint: '/api/track/session/start',
          reason: 'Publish ID mismatch',
          presentationId,
          sourceId,
          actualPublishId: presentation.published.id,
        });
        return { ok: false, code: 'forbidden', message: 'Invalid publish ID' };
      }

      return { ok: true, presentation };
    }

    default:
      return { ok: false, code: 'forbidden', message: 'Invalid source type' };
  }
}

// POST /api/track/session/start - Create a new view session
async function handleTrackSessionStart({ req, res, url, repoRoot }) {
  const path = url.pathname;
  const ctx = { repoRoot };
  const clientIp = getClientIp(req);

  // Rate limit by IP address
  if (
    !(await allowRequest(
      `track:start:${clientIp}`,
      TRACKING_RATE_LIMITS.sessionStart,
    ))
  ) {
    logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
      ip: clientIp,
      endpoint: path,
      limitType: 'sessionStart',
    });
    return rateLimited(res);
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;

  const presentationId = norm(body?.presentationId);
  const sourceType = norm(body?.sourceType);
  const sourceId = norm(body?.sourceId);
  const deviceId = body?.deviceId ?? null;

  if (!presentationId || !sourceType) {
    return badRequest(res, 'Missing required fields');
  }

  // Validate source type
  if (!isValidSourceType(sourceType)) {
    return badRequest(res, 'Invalid source type');
  }

  // Validate device ID format if provided
  if (deviceId && !isValidDeviceId(deviceId)) {
    logSecurityEvent(SECURITY_EVENTS.INVALID_DEVICE_ID, {
      ip: clientIp,
      endpoint: path,
      deviceId: deviceId?.slice(0, 20) + '...', // Truncate for logging
    });
    return badRequest(res, 'Invalid device ID format');
  }

  // Validate presentation access (security fix: verify viewer has legitimate access)
  const accessValidation = await validatePresentationAccess(
    { presentationId, sourceType, sourceId },
    ctx,
  );

  if (!accessValidation.ok) {
    return jsonError(
      res,
      getErrorStatus(accessValidation.code),
      accessValidation.code,
      accessValidation.message,
    );
  }

  // Check app-level analytics settings
  const appSettings = await getAppSettings(
    crossOrganizationScope(
      ctx.repoRoot ?? null,
      'public view tracking: analytics switch is instance-level',
    ),
  );
  if (!appSettings.analytics?.enabled) {
    // Analytics disabled at app level - silently accept but don't track
    return (serveJson(res, 200, { sessionToken: null, sessionId: null }), true);
  }

  const viewerType = body?.viewerType ?? VIEWER_TYPES.ANONYMOUS;
  const viewerEmail = body?.viewerEmail ?? null;
  const isAuthenticatedViewer =
    viewerType === VIEWER_TYPES.AUTHENTICATED && viewerEmail;

  // Check user privacy settings if viewer is authenticated
  let viewerPrivacySettings = null;
  if (isAuthenticatedViewer) {
    viewerPrivacySettings = await getUserSettings(
      crossOrganizationScope(
        ctx.repoRoot ?? null,
        'public view tracking: viewer privacy preference',
      ),
      viewerEmail,
    );

    // If viewer has opted out of all tracking, don't track
    if (viewerPrivacySettings?.privacy?.disableAllTracking) {
      return (
        serveJson(res, 200, { sessionToken: null, sessionId: null }),
        true
      );
    }
  }

  // There is no internal/external split on this route: it is deliberately
  // unauthenticated, so the viewer's organization is not knowable server-side,
  // and the old second "external analytics" switch has been removed —
  // `analytics.enabled` (gated above) is the only tracking toggle. Rationale
  // and the revive path: done/decisions.md § analytics-privacy-naden.

  // Check if viewer allows attribution (name to be shown in analytics)
  const attributionAllowed =
    viewerPrivacySettings?.privacy?.allowViewAttribution === true;

  // Sanitize user agent
  const userAgent = sanitizeUserAgent(
    req.headers.get?.('user-agent') || req.headers['user-agent'],
  );

  const result = await createViewSession({
    presentationId,
    sourceType,
    sourceId,
    viewerType,
    viewerEmail,
    deviceId,
    ipAddress: clientIp,
    userAgent,
    attributionAllowed,
  });

  if (!result.ok) {
    return jsonError(
      res,
      getErrorStatus(result.reason, 500),
      result.reason || 'internal_error',
      'Failed to create session',
    );
  }

  return (
    serveJson(res, 200, {
      sessionToken: result.session.sessionToken,
      sessionId: result.session.id,
    }),
    true
  );
}

// POST /api/track/session/heartbeat - Update session activity
async function handleTrackSessionHeartbeat({ req, res, url, repoRoot }) {
  const path = url.pathname;
  const clientIp = getClientIp(req);

  // Rate limit by IP address
  if (
    !(await allowRequest(
      `track:heartbeat:${clientIp}`,
      TRACKING_RATE_LIMITS.heartbeat,
    ))
  ) {
    logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
      ip: clientIp,
      endpoint: path,
      limitType: 'heartbeat',
    });
    return rateLimited(res);
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;

  const sessionToken = norm(body?.sessionToken);

  if (!sessionToken) {
    return badRequest(res, 'Missing session token');
  }

  // Validate session token format
  if (!isValidSessionToken(sessionToken)) {
    logSecurityEvent(SECURITY_EVENTS.INVALID_TOKEN, {
      ip: clientIp,
      endpoint: path,
      tokenPrefix: sessionToken?.slice(0, 8) + '...',
    });
    return badRequest(res, 'Invalid session token format');
  }

  // Per-session rate limiting
  if (
    !(await allowRequest(
      `track:session:heartbeat:${sessionToken}`,
      TRACKING_RATE_LIMITS.sessionHeartbeat,
    ))
  ) {
    logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
      ip: clientIp,
      endpoint: path,
      limitType: 'sessionHeartbeat',
    });
    return rateLimited(res);
  }

  const result = await updateViewSession(sessionToken, {
    currentSlideId: body?.currentSlideId ?? null,
    currentSlideIndex: body?.currentSlideIndex ?? null,
  });

  if (!result.ok) {
    return jsonError(
      res,
      getErrorStatus(result.reason, 500),
      result.reason || 'internal_error',
      'Failed to update session',
    );
  }

  return (serveJson(res, 200, { ok: true }), true);
}

// POST /api/track/session/end - End a view session
async function handleTrackSessionEnd({ req, res, url, repoRoot }) {
  const path = url.pathname;
  const clientIp = getClientIp(req);

  // Rate limit by IP address
  if (
    !(await allowRequest(
      `track:end:${clientIp}`,
      TRACKING_RATE_LIMITS.sessionEnd,
    ))
  ) {
    logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
      ip: clientIp,
      endpoint: path,
      limitType: 'sessionEnd',
    });
    return rateLimited(res);
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;

  const sessionToken = norm(body?.sessionToken);

  if (!sessionToken) {
    return badRequest(res, 'Missing session token');
  }

  // Validate session token format
  if (!isValidSessionToken(sessionToken)) {
    logSecurityEvent(SECURITY_EVENTS.INVALID_TOKEN, {
      ip: clientIp,
      endpoint: path,
      tokenPrefix: sessionToken?.slice(0, 8) + '...',
    });
    return badRequest(res, 'Invalid session token format');
  }

  // End any open slide views first
  const session = await getViewSessionByToken(sessionToken);
  if (session?.id) {
    await endAllSlideViewsForSession(session.id);
  }

  const result = await endViewSession(sessionToken, {
    exitSlideId: body?.exitSlideId ?? null,
    exitSlideIndex: body?.exitSlideIndex ?? null,
  });

  if (!result.ok) {
    return jsonError(
      res,
      getErrorStatus(result.reason, 500),
      result.reason || 'internal_error',
      'Failed to end session',
    );
  }

  return (serveJson(res, 200, { ok: true }), true);
}

// POST /api/track/slide/view - Record slide view
async function handleTrackSlideView({ req, res, url, repoRoot }) {
  const path = url.pathname;
  const clientIp = getClientIp(req);

  // Rate limit by IP address
  if (
    !(await allowRequest(
      `track:slide:${clientIp}`,
      TRACKING_RATE_LIMITS.slideView,
    ))
  ) {
    logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
      ip: clientIp,
      endpoint: path,
      limitType: 'slideView',
    });
    return rateLimited(res);
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;

  const sessionToken = norm(body?.sessionToken);
  const slideId = norm(body?.slideId);
  const slideIndex = body?.slideIndex ?? 0;

  if (!sessionToken || !slideId) {
    return badRequest(res, 'Missing required fields');
  }

  // Validate session token format
  if (!isValidSessionToken(sessionToken)) {
    logSecurityEvent(SECURITY_EVENTS.INVALID_TOKEN, {
      ip: clientIp,
      endpoint: path,
      tokenPrefix: sessionToken?.slice(0, 8) + '...',
    });
    return badRequest(res, 'Invalid session token format');
  }

  // Per-session rate limiting
  if (
    !(await allowRequest(
      `track:session:slide:${sessionToken}`,
      TRACKING_RATE_LIMITS.sessionSlideView,
    ))
  ) {
    logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
      ip: clientIp,
      endpoint: path,
      limitType: 'sessionSlideView',
    });
    return rateLimited(res);
  }

  // Validate slide index (using centralized validation)
  if (!isValidSlideIndex(slideIndex)) {
    return badRequest(res, 'Invalid slide index');
  }

  // Get session to get session ID and presentation ID
  const session = await getViewSessionByToken(sessionToken);
  if (!session) {
    return notFound(res, 'Session not found');
  }

  // Atomically transition to new slide (ends current and starts new in single transaction)
  const result = await transitionToSlide({
    viewSessionId: session.id,
    presentationId: session.presentationId,
    slideId,
    slideIndex,
  });

  if (!result.ok) {
    return jsonError(
      res,
      getErrorStatus(result.reason, 500),
      result.reason || 'internal_error',
      'Failed to record slide view',
    );
  }

  // Also update the session with current slide info
  const sessionUpdate = await updateViewSession(sessionToken, {
    currentSlideId: slideId,
    currentSlideIndex: slideIndex,
  });

  // Log if session update failed (non-critical, slide view was already recorded)
  if (!sessionUpdate.ok) {
    log.warn(
      `[analytics-track] Failed to update session ${redactSecret(sessionToken)}: ${sessionUpdate.reason}`,
    );
  }

  return (
    serveJson(res, 200, {
      ok: true,
      slideViewId: result.slideView.id,
    }),
    true
  );
}

// POST /api/track/my-data/erase - Anonymous viewer erases their own data.
//
// The public, device-only counterpart of DELETE /api/analytics/my-data (which
// identifies a logged-in person by email). Here the proof of identity is the
// live session_token the viewer's own browser holds: possession of it means
// the browser that opened the session is asking to be forgotten. A raw device
// id is deliberately NOT an accepted input — it is browser-generated and every
// deck reader can see a per-deck label of it, so it proves nothing (see
// view-sessions-gdpr.js header, and done/decisions.md § analytics-privacy-naden).
async function handleTrackMyDataErase({ req, res, url, repoRoot }) {
  const path = url.pathname;
  const clientIp = getClientIp(req);

  // Destructive and instance-wide: gate it with the same strict expensive-op
  // tier the GDPR endpoints use, keyed by IP since there is no principal here.
  if (
    !(await allowRequest(`track:erase:${clientIp}`, AUTH_RATE_LIMITS.expensive))
  ) {
    logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
      ip: clientIp,
      endpoint: path,
      limitType: 'trackErase',
    });
    return rateLimited(res);
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;

  const sessionToken = norm(body?.sessionToken);

  if (!sessionToken) {
    return badRequest(res, 'Missing session token');
  }

  // Validate session token format
  if (!isValidSessionToken(sessionToken)) {
    logSecurityEvent(SECURITY_EVENTS.INVALID_TOKEN, {
      ip: clientIp,
      endpoint: path,
      tokenPrefix: sessionToken?.slice(0, 8) + '...',
    });
    return badRequest(res, 'Invalid session token format');
  }

  const session = await getViewSessionByToken(sessionToken);
  if (!session) {
    // Same semantics as heartbeat/end: an unknown token is a 404, not a hint
    // about which tokens exist.
    logSecurityEvent(SECURITY_EVENTS.ACCESS_DENIED, {
      ip: clientIp,
      endpoint: path,
      reason: 'Unknown session token',
    });
    return notFound(res, 'Session not found');
  }

  // A session with a device id cascades to every session of that device
  // (identity is the scope); one without a device id erases only itself.
  const result = session.deviceId
    ? await eraseAnalyticsDataForDevice({ deviceId: session.deviceId })
    : await eraseAnalyticsDataForSession({ sessionId: session.id });

  if (!result.ok) {
    return jsonError(
      res,
      getErrorStatus(result.reason, 500),
      result.reason || 'internal_error',
      'Failed to erase data',
    );
  }

  return (serveJson(res, 200, { ok: true, deleted: result.deleted }), true);
}

/**
 * Declarative route table for the public analytics tracking surface (A7.19
 * C8). All five endpoints are POST-only and unauthenticated; a method
 * mismatch falls through (the original chain sent no 405). Order mirrors the
 * previous if-chain.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  {
    method: 'POST',
    pattern: '/api/track/session/start',
    handler: handleTrackSessionStart,
  },
  {
    method: 'POST',
    pattern: '/api/track/session/heartbeat',
    handler: handleTrackSessionHeartbeat,
  },
  {
    method: 'POST',
    pattern: '/api/track/session/end',
    handler: handleTrackSessionEnd,
  },
  {
    method: 'POST',
    pattern: '/api/track/slide/view',
    handler: handleTrackSlideView,
  },
  {
    method: 'POST',
    pattern: '/api/track/my-data/erase',
    handler: handleTrackMyDataErase,
  },
];

/**
 * Handle public analytics tracking routes.
 * @param {import('../../utils/context.js').PublicContext} ctx
 * @returns {Promise<boolean>} True if handled
 */
export const handleAnalyticsTrack = withErrorHandler(
  'analytics-track',
  (ctx) => {
    return dispatchRoutes(ROUTES, ctx);
  },
);
