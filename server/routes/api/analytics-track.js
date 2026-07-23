/**
 * Public tracking endpoints for analytics.
 * These endpoints do NOT require authentication and are used by viewers.
 */

import { json } from '../../utils/http.js';
import { norm } from '../../utils/normalize.js';
import { redactSecret } from '../../utils/log-redact.js';
import { getClientIp, allowRequest } from '../../utils/rate-limit.js';
import { getPresentation } from '../../storage/presentations.js';
import { validateShareLink } from '../../storage/share-links/crud.js';
import { readAppSettings, readUserSettings } from '../../storage/settings.js';
import {
  TRACKING_RATE_LIMITS,
  isValidDeviceId,
  isValidSessionToken,
  isValidSlideIndex,
  isValidSourceType,
  sanitizeUserAgent,
  sendRateLimitResponse,
  sendErrorResponse,
  sendSuccessResponse,
  logSecurityEvent,
  SECURITY_EVENTS,
  SOURCE_TYPES,
} from '../../analytics/helpers.js';
import {
  createViewSession,
  updateViewSession,
  endViewSession,
  getViewSessionByToken,
  VIEWER_TYPES,
} from '../../storage/analytics/view-sessions.js';
import {
  transitionToSlide,
  endAllSlideViewsForSession,
} from '../../storage/analytics/slide-views.js';
import { getFollowStateForPresentation } from '../../storage/present-sessions/follow-state.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('analytics-track');

/**
 * Validate presentation access for analytics tracking.
 * Ensures the viewer has legitimate access to the presentation.
 * @param {Object} data - Request data
 * @param {string} data.presentationId - The presentation ID
 * @param {string} data.sourceType - The source type
 * @param {string} [data.sourceId] - The source ID (share token for share_link)
 * @param {Object} ctx - Request context
 * @returns {Promise<{ok: boolean, presentation?: Object, reason?: string}>}
 */
async function validatePresentationAccess(data, ctx) {
  const { presentationId, sourceType, sourceId } = data;

  // Get the presentation first
  const presentation = await getPresentation(null, presentationId);
  if (!presentation) {
    return { ok: false, reason: 'Presentation not found' };
  }

  // Check if analytics is enabled for this presentation
  if (presentation.settings?.analyticsEnabled === false) {
    return { ok: false, reason: 'Analytics disabled for this presentation' };
  }

  // Validate access based on source type
  switch (sourceType) {
    case SOURCE_TYPES.SHARE_LINK: {
      // Share link access requires a valid share token
      if (!sourceId) {
        return { ok: false, reason: 'Share link token required' };
      }

      const validation = await validateShareLink(sourceId, ctx);
      if (!validation.ok) {
        logSecurityEvent(SECURITY_EVENTS.ACCESS_DENIED, {
          endpoint: '/api/track/session/start',
          reason: `Invalid share link: ${validation.reason}`,
          presentationId,
          sourceType,
        });
        return { ok: false, reason: 'Invalid or expired share link' };
      }

      // Verify the share link is for this presentation
      if (validation.shareLink.presentationId !== presentationId) {
        logSecurityEvent(SECURITY_EVENTS.ACCESS_DENIED, {
          endpoint: '/api/track/session/start',
          reason: 'Share link presentation mismatch',
          presentationId,
          shareLinkPresentationId: validation.shareLink.presentationId,
        });
        return { ok: false, reason: 'Share link does not match presentation' };
      }

      return { ok: true, presentation };
    }

    case SOURCE_TYPES.FOLLOW: {
      // Follow mode: validate that there's an active follow session for this presentation
      const followState = await getFollowStateForPresentation(ctx?.repoRoot, presentationId);

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

      return { ok: false, reason: 'No active follow session' };
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
        return { ok: false, reason: 'Presentation is not published' };
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
        return { ok: false, reason: 'Invalid publish ID' };
      }

      return { ok: true, presentation };
    }

    default:
      return { ok: false, reason: 'Invalid source type' };
  }
}

/**
 * Handle public analytics tracking routes.
 * @param {Object} ctx - Request context
 * @returns {Promise<boolean>} True if handled
 */
export async function handleAnalyticsTrack({ req, res, url, repoRoot }) {
  const path = url.pathname;
  const ctx = { repoRoot };

  // POST /api/track/session/start - Create a new view session
  if (req.method === 'POST' && path === '/api/track/session/start') {
    const clientIp = getClientIp(req);

    // Rate limit by IP address
    if (!(await allowRequest(`track:start:${clientIp}`, TRACKING_RATE_LIMITS.sessionStart))) {
      logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
        ip: clientIp,
        endpoint: path,
        limitType: 'sessionStart',
      });
      return sendRateLimitResponse(res), true;
    }

    let body;
    try {
      body = await json(req);
    } catch (err) {
      return sendErrorResponse(res, 400, 'Invalid JSON body'), true;
    }

    const presentationId = norm(body?.presentationId);
    const sourceType = norm(body?.sourceType);
    const sourceId = norm(body?.sourceId);
    const deviceId = body?.deviceId ?? null;

    if (!presentationId || !sourceType) {
      return sendErrorResponse(res, 400, 'Missing required fields'), true;
    }

    // Validate source type
    if (!isValidSourceType(sourceType)) {
      return sendErrorResponse(res, 400, 'Invalid source type'), true;
    }

    // Validate device ID format if provided
    if (deviceId && !isValidDeviceId(deviceId)) {
      logSecurityEvent(SECURITY_EVENTS.INVALID_DEVICE_ID, {
        ip: clientIp,
        endpoint: path,
        deviceId: deviceId?.slice(0, 20) + '...', // Truncate for logging
      });
      return sendErrorResponse(res, 400, 'Invalid device ID format'), true;
    }

    // Validate presentation access (security fix: verify viewer has legitimate access)
    const accessValidation = await validatePresentationAccess(
      { presentationId, sourceType, sourceId },
      ctx
    );

    if (!accessValidation.ok) {
      const statusCode = accessValidation.reason?.includes('not found') ? 404 : 403;
      return sendErrorResponse(res, statusCode, accessValidation.reason), true;
    }

    // Check app-level analytics settings
    const appSettings = await readAppSettings(ctx.repoRoot);
    if (!appSettings.analytics?.enabled) {
      // Analytics disabled at app level - silently accept but don't track
      return sendSuccessResponse(res, { sessionToken: null, sessionId: null }), true;
    }

    // Check if external tracking is disabled and viewer is external
    const viewerType = body?.viewerType ?? VIEWER_TYPES.ANONYMOUS;
    const viewerEmail = body?.viewerEmail ?? null;
    const isAuthenticatedViewer = viewerType === VIEWER_TYPES.AUTHENTICATED && viewerEmail;

    // Check user privacy settings if viewer is authenticated
    let viewerPrivacySettings = null;
    if (isAuthenticatedViewer) {
      viewerPrivacySettings = await readUserSettings(ctx.repoRoot, viewerEmail);

      // If viewer has opted out of all tracking, don't track
      if (viewerPrivacySettings?.privacy?.disableAllTracking) {
        return sendSuccessResponse(res, { sessionToken: null, sessionId: null }), true;
      }
    }

    // Determine if viewer is internal (same organization as presentation)
    const presentation = accessValidation.presentation;
    const presOrgId = presentation?.organizationId;
    const viewerOrgId = body?.organizationId ?? null;
    const isInternal = isAuthenticatedViewer && presOrgId && viewerOrgId && presOrgId === viewerOrgId;

    // If external analytics is disabled and viewer is external, don't track
    if (!isInternal && !appSettings.analytics?.externalAnalytics?.enabled) {
      return sendSuccessResponse(res, { sessionToken: null, sessionId: null }), true;
    }

    // Check if viewer allows attribution (name to be shown in analytics)
    const attributionAllowed = viewerPrivacySettings?.privacy?.allowViewAttribution === true;

    // Sanitize user agent
    const userAgent = sanitizeUserAgent(
      req.headers.get?.('user-agent') || req.headers['user-agent']
    );

    const result = await createViewSession({
      presentationId,
      sourceType,
      sourceId,
      viewerType,
      viewerEmail,
      deviceId,
      organizationId: viewerOrgId,
      ipAddress: clientIp,
      userAgent,
      isInternal,
      attributionAllowed,
    });

    if (!result.ok) {
      return sendErrorResponse(res, 500, result.reason || 'Failed to create session'), true;
    }

    return sendSuccessResponse(res, {
      sessionToken: result.session.sessionToken,
      sessionId: result.session.id,
    }), true;
  }

  // POST /api/track/session/heartbeat - Update session activity
  if (req.method === 'POST' && path === '/api/track/session/heartbeat') {
    const clientIp = getClientIp(req);

    // Rate limit by IP address
    if (!(await allowRequest(`track:heartbeat:${clientIp}`, TRACKING_RATE_LIMITS.heartbeat))) {
      logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
        ip: clientIp,
        endpoint: path,
        limitType: 'heartbeat',
      });
      return sendRateLimitResponse(res), true;
    }

    let body;
    try {
      body = await json(req);
    } catch (err) {
      return sendErrorResponse(res, 400, 'Invalid JSON body'), true;
    }

    const sessionToken = norm(body?.sessionToken);

    if (!sessionToken) {
      return sendErrorResponse(res, 400, 'Missing session token'), true;
    }

    // Validate session token format
    if (!isValidSessionToken(sessionToken)) {
      logSecurityEvent(SECURITY_EVENTS.INVALID_TOKEN, {
        ip: clientIp,
        endpoint: path,
        tokenPrefix: sessionToken?.slice(0, 8) + '...',
      });
      return sendErrorResponse(res, 400, 'Invalid session token format'), true;
    }

    // Per-session rate limiting
    if (!(await allowRequest(`track:session:heartbeat:${sessionToken}`, TRACKING_RATE_LIMITS.sessionHeartbeat))) {
      logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
        ip: clientIp,
        endpoint: path,
        limitType: 'sessionHeartbeat',
      });
      return sendRateLimitResponse(res), true;
    }

    const result = await updateViewSession(sessionToken, {
      currentSlideId: body?.currentSlideId ?? null,
      currentSlideIndex: body?.currentSlideIndex ?? null,
    });

    if (!result.ok) {
      const statusCode = result.reason === 'not_found' ? 404 : 500;
      return sendErrorResponse(res, statusCode, result.reason || 'Failed to update session'), true;
    }

    return sendSuccessResponse(res, { ok: true }), true;
  }

  // POST /api/track/session/end - End a view session
  if (req.method === 'POST' && path === '/api/track/session/end') {
    const clientIp = getClientIp(req);

    // Rate limit by IP address
    if (!(await allowRequest(`track:end:${clientIp}`, TRACKING_RATE_LIMITS.sessionEnd))) {
      logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
        ip: clientIp,
        endpoint: path,
        limitType: 'sessionEnd',
      });
      return sendRateLimitResponse(res), true;
    }

    let body;
    try {
      body = await json(req);
    } catch (err) {
      return sendErrorResponse(res, 400, 'Invalid JSON body'), true;
    }

    const sessionToken = norm(body?.sessionToken);

    if (!sessionToken) {
      return sendErrorResponse(res, 400, 'Missing session token'), true;
    }

    // Validate session token format
    if (!isValidSessionToken(sessionToken)) {
      logSecurityEvent(SECURITY_EVENTS.INVALID_TOKEN, {
        ip: clientIp,
        endpoint: path,
        tokenPrefix: sessionToken?.slice(0, 8) + '...',
      });
      return sendErrorResponse(res, 400, 'Invalid session token format'), true;
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
      const statusCode = result.reason === 'not_found' ? 404 : 500;
      return sendErrorResponse(res, statusCode, result.reason || 'Failed to end session'), true;
    }

    return sendSuccessResponse(res, { ok: true }), true;
  }

  // POST /api/track/slide/view - Record slide view
  if (req.method === 'POST' && path === '/api/track/slide/view') {
    const clientIp = getClientIp(req);

    // Rate limit by IP address
    if (!(await allowRequest(`track:slide:${clientIp}`, TRACKING_RATE_LIMITS.slideView))) {
      logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
        ip: clientIp,
        endpoint: path,
        limitType: 'slideView',
      });
      return sendRateLimitResponse(res), true;
    }

    let body;
    try {
      body = await json(req);
    } catch (err) {
      return sendErrorResponse(res, 400, 'Invalid JSON body'), true;
    }

    const sessionToken = norm(body?.sessionToken);
    const slideId = norm(body?.slideId);
    const slideIndex = body?.slideIndex ?? 0;

    if (!sessionToken || !slideId) {
      return sendErrorResponse(res, 400, 'Missing required fields'), true;
    }

    // Validate session token format
    if (!isValidSessionToken(sessionToken)) {
      logSecurityEvent(SECURITY_EVENTS.INVALID_TOKEN, {
        ip: clientIp,
        endpoint: path,
        tokenPrefix: sessionToken?.slice(0, 8) + '...',
      });
      return sendErrorResponse(res, 400, 'Invalid session token format'), true;
    }

    // Per-session rate limiting
    if (!(await allowRequest(`track:session:slide:${sessionToken}`, TRACKING_RATE_LIMITS.sessionSlideView))) {
      logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
        ip: clientIp,
        endpoint: path,
        limitType: 'sessionSlideView',
      });
      return sendRateLimitResponse(res), true;
    }

    // Validate slide index (using centralized validation)
    if (!isValidSlideIndex(slideIndex)) {
      return sendErrorResponse(res, 400, 'Invalid slide index'), true;
    }

    // Get session to get session ID and presentation ID
    const session = await getViewSessionByToken(sessionToken);
    if (!session) {
      return sendErrorResponse(res, 404, 'Session not found'), true;
    }

    // Atomically transition to new slide (ends current and starts new in single transaction)
    const result = await transitionToSlide({
      viewSessionId: session.id,
      presentationId: session.presentationId,
      slideId,
      slideIndex,
    });

    if (!result.ok) {
      return sendErrorResponse(res, 500, result.reason || 'Failed to record slide view'), true;
    }

    // Also update the session with current slide info
    const sessionUpdate = await updateViewSession(sessionToken, {
      currentSlideId: slideId,
      currentSlideIndex: slideIndex,
    });

    // Log if session update failed (non-critical, slide view was already recorded)
    if (!sessionUpdate.ok) {
      log.warn(`[analytics-track] Failed to update session ${redactSecret(sessionToken)}: ${sessionUpdate.reason}`);
    }

    return sendSuccessResponse(res, {
      ok: true,
      slideViewId: result.slideView.id,
    }), true;
  }

  return false;
}