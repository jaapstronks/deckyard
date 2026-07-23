/**
 * Public share link endpoints (no auth required).
 *
 * GET    /api/share/:token                            - Validate token
 * POST   /api/share/:token/verify                     - Verify password & get access
 * POST   /api/share/:token/guest/request              - Request guest email verification
 * GET    /api/share/:token/guest/verify/:vtoken       - Verify guest email & create session
 * GET    /api/share/:token/guest/me                   - Get current guest session info
 */

import { getPresentation } from '../../../storage/presentations.js';
import {
  validateShareLink,
  verifyShareLinkAccess,
  logShareLinkAccess,
  requestGuestVerification,
  verifyGuestEmail,
  getGuestBySessionToken,
} from '../../../storage/share-links.js';
import { getUserByEmail } from '../../../storage/users.js';
import { sendGuestVerificationEmail } from '../../../integrations/brevo.js';
import { notifyAuthorOfAccessAttempt, ACCESS_TYPES } from '../../../services/access-notifications.js';
import { parseCookies } from '../../../utils/cookies.js';
import { json, serveJson, badRequest, getErrorStatus, jsonError } from '../../../utils/http.js';
import { getTrimmedString } from '../../../utils/request-validators.js';
import { buildRequestUrl, shouldUseSecureCookies } from '../../../utils/request-url.js';
import { getClientIp } from '../../../utils/rate-limit.js';
import { normalizeEmail } from '../../../utils/normalize.js';
import { createRouteContext } from '../../../utils/context.js';
import { createLogger } from '../../../utils/logger.js';
const log = createLogger('public');

/**
 * Handle public share link endpoints.
 */
export async function handleSharePublicEndpoints({ repoRoot, req, res, url }) {
  const ctx = {};

  // GET /api/share/:token - Validate share token
  const validateMatch = url.pathname.match(/^\/api\/share\/([^/]+)$/);
  if (validateMatch && req.method === 'GET') {
    const token = validateMatch[1];
    const result = await validateShareLink(token, ctx);

    if (!result.ok) {
      const status = getErrorStatus(result.reason);

      // For revoked links, include additional info and trigger notification
      if (result.reason === 'revoked' && result.presentationId) {
        const pres = await getPresentation(repoRoot, result.presentationId);
        const responseData = {
          ok: false,
          error: result.reason,
          message: result.revocationMessage || null,
          presentationTitle: pres?.title || null,
        };

        // Get accessor info for notification
        const ipAddress = getClientIp(req);

        // Notify author of access attempt (non-blocking)
        if (pres?.ownerEmail) {
          void notifyAuthorOfAccessAttempt({
            presentationId: result.presentationId,
            presentationTitle: pres.title || 'Untitled',
            authorEmail: pres.ownerEmail,
            accessType: ACCESS_TYPES.SHARE_LINK,
            accessReferenceId: result.shareLinkId,
            accessorIp: ipAddress,
            ctx,
          });
        }

        serveJson(res, status, responseData);
        return true;
      }

      jsonError(res, status, result.reason);
      return true;
    }

    serveJson(res, 200, {
      presentationId: result.shareLink.presentationId,
      permission: result.shareLink.permission,
      requiresPassword: result.requiresPassword,
      label: result.shareLink.label,
    });
    return true;
  }

  // POST /api/share/:token/verify - Verify password and get access
  const verifyMatch = url.pathname.match(/^\/api\/share\/([^/]+)\/verify$/);
  if (verifyMatch && req.method === 'POST') {
    const token = verifyMatch[1];

    let body;
    try {
      body = await json(req);
    } catch {
      body = {};
    }

    const result = await verifyShareLinkAccess(token, body?.password, ctx);

    if (!result.ok) {
      jsonError(res, getErrorStatus(result.reason), result.reason);
      return true;
    }

    // Log the access
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'];
    await logShareLinkAccess(result.shareLink.id, { ipAddress, userAgent }, ctx);

    serveJson(res, 200, {
      presentationId: result.shareLink.presentationId,
      permission: result.shareLink.permission,
      token: result.shareLink.token,
    });
    return true;
  }

  // POST /api/share/:token/guest/request - Request guest email verification
  const guestRequestMatch = url.pathname.match(/^\/api\/share\/([^/]+)\/guest\/request$/);
  if (guestRequestMatch && req.method === 'POST') {
    const token = guestRequestMatch[1];

    // Validate share link first
    const validation = await validateShareLink(token, ctx);
    if (!validation.ok) {
      jsonError(res, getErrorStatus(validation.reason), validation.reason);
      return true;
    }

    // Check permission allows commenting
    if (!['comment', 'edit'].includes(validation.shareLink.permission)) {
      jsonError(res, 403, 'permission_denied');
      return true;
    }

    let body;
    try {
      body = await json(req);
    } catch {
      return badRequest(res, 'Invalid JSON body');
    }

    const email = normalizeEmail(body?.email);
    const name = getTrimmedString(body, 'name') || '';

    if (!email || !email.includes('@')) {
      return badRequest(res, 'Valid email is required');
    }

    // Request verification
    const result = await requestGuestVerification(
      validation.shareLink.id,
      email,
      name || null,
      ctx
    );

    if (!result.ok) {
      jsonError(res, getErrorStatus(result.reason), result.reason);
      return true;
    }

    // Build verification URL
    const verificationUrl = buildRequestUrl(
      req,
      `/api/share/${encodeURIComponent(token)}/guest/verify/${encodeURIComponent(result.verificationToken)}`
    );

    if (!verificationUrl) {
      return badRequest(res, 'Invalid host header');
    }

    // Get presentation title for email
    const pres = await getPresentation(repoRoot, validation.shareLink.presentationId);
    const presentationTitle = pres?.title || 'Presentation';

    // Send verification email
    void sendGuestVerificationEmail({
      recipientEmail: email,
      recipientName: name || null,
      presentationTitle,
      verificationUrl,
      expiresAt: result.expiresAt,
      repoRoot,
    }).then((emailResult) => {
      if (!emailResult.ok) {
        // eslint-disable-next-line no-console
        log.warn(
          `[brevo] guest verification email failed to=${email} error=${emailResult.error || ''}`.trim()
        );
      }
    });

    serveJson(res, 200, { ok: true, message: 'Verification email sent' });
    return true;
  }

  // GET /api/share/:token/guest/verify/:verificationToken - Verify email and create session
  const guestVerifyMatch = url.pathname.match(/^\/api\/share\/([^/]+)\/guest\/verify\/([^/]+)$/);
  if (guestVerifyMatch && req.method === 'GET') {
    const shareToken = guestVerifyMatch[1];
    const verificationToken = guestVerifyMatch[2];

    const result = await verifyGuestEmail(verificationToken, ctx);

    const redirectBase = buildRequestUrl(req, `/s/${encodeURIComponent(shareToken)}`);
    if (!redirectBase) {
      return badRequest(res, 'Invalid host header');
    }

    if (!result.ok) {
      // Redirect to share link with error
      const errorUrl = `${redirectBase}?guest_error=${encodeURIComponent(result.reason)}`;
      res.writeHead(302, { Location: errorUrl });
      res.end();
      return true;
    }

    // Set guest session cookie
    const isHttps = shouldUseSecureCookies(req);

    const cookieParts = [
      `share_guest_session=${encodeURIComponent(result.sessionToken)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${7 * 24 * 60 * 60}`, // 7 days
    ];
    if (isHttps) cookieParts.push('Secure');

    // Redirect to share link with success
    const successUrl = `${redirectBase}?guest_verified=true`;
    res.writeHead(302, {
      Location: successUrl,
      'Set-Cookie': cookieParts.join('; '),
    });
    res.end();
    return true;
  }

  // GET /api/share/:token/guest/me - Get current guest session info
  const guestMeMatch = url.pathname.match(/^\/api\/share\/([^/]+)\/guest\/me$/);
  if (guestMeMatch && req.method === 'GET') {
    const shareToken = guestMeMatch[1];

    // Validate share link first
    const validation = await validateShareLink(shareToken, ctx);
    if (!validation.ok) {
      serveJson(res, 200, { authenticated: false });
      return true;
    }

    // Check for guest session cookie
    const cookies = parseCookies(req.headers?.cookie);
    const sessionToken = cookies.share_guest_session;

    if (!sessionToken) {
      serveJson(res, 200, { authenticated: false, permission: validation.shareLink.permission });
      return true;
    }

    // Get guest by session token
    const guestInfo = await getGuestBySessionToken(sessionToken, ctx);

    if (!guestInfo) {
      serveJson(res, 200, { authenticated: false, permission: validation.shareLink.permission });
      return true;
    }

    // Verify this guest session is for this share link
    if (guestInfo.shareLink.token !== shareToken) {
      serveJson(res, 200, { authenticated: false, permission: validation.shareLink.permission });
      return true;
    }

    serveJson(res, 200, {
      authenticated: true,
      email: guestInfo.guest.email,
      name: guestInfo.guest.name,
      permission: guestInfo.shareLink.permission,
      canComment: ['comment', 'edit'].includes(guestInfo.shareLink.permission),
    });
    return true;
  }

  return false;
}