/**
 * Public share link endpoints (no auth required) (A7.19 C8 — ROUTES table).
 *
 * GET    /api/share/:token                            - Validate token
 * POST   /api/share/:token/verify                     - Verify password & get access
 * POST   /api/share/:token/guest/request              - Request guest email verification
 * GET    /api/share/:token/guest/verify/:vtoken       - Verify guest email & create session
 * GET    /api/share/:token/guest/me                   - Get current guest session info
 *
 * Form A throughout (route-dispatch.md): the old chain fell through on a
 * method mismatch, no 405. Table order mirrors the old branch order exactly.
 */

import { getPresentation } from '../../../storage/presentations/index.js';
import {
  validateShareLink,
  verifyShareLinkAccess,
  logShareLinkAccess,
  requestGuestVerification,
  verifyGuestEmail,
  getGuestBySessionToken,
} from '../../../storage/share-links/index.js';
import { sendGuestVerificationEmail } from '../../../integrations/brevo.js';
import {
  notifyAuthorOfAccessAttempt,
  ACCESS_TYPES,
} from '../../../services/access-notifications.js';
import { parseCookies } from '../../../utils/cookies.js';
import { dispatchRoutes } from '../../../utils/router.js';
import {
  badRequest,
  forbidden,
  getErrorStatus,
  jsonError,
  rateLimited,
  requireJsonBody,
  serveJson,
  storageError,
} from '../../../utils/http.js';
import { getTrimmedString } from '../../../utils/request-validators.js';
import { canCommentWithShareLink } from '../../../utils/presentation-authz/share-links.js';
import {
  buildRequestUrl,
  shouldUseSecureCookies,
} from '../../../utils/request-url.js';
import {
  getClientIp,
  allowShareVerifyAttempt,
} from '../../../utils/rate-limit.js';
import { normalizeEmail } from '../../../utils/normalize.js';
import { createLogger } from '../../../utils/logger.js';
import { fireAndForget } from '../../../utils/fire-and-forget.js';
import { crossOrganizationScope } from '../../../storage/scope.js';
const log = createLogger('public');

// No request context on this surface on purpose: these endpoints are
// anonymous, and every storage call on this path is token-authorized — the
// share token (or a token resolved from it) is globally unique and carries
// its own organization. See tenant-isolation.md.

/** GET /api/share/:token - Validate share token */
async function handleShareValidate({ repoRoot, req, res }, token) {
  const result = await validateShareLink(token);

  if (!result.ok) {
    const status = getErrorStatus(result.reason);
    // Read directly rather than through storageError(): this branch builds its
    // own body (the revoked link carries the deck's title back to the viewer).

    // For revoked links, include additional info and trigger notification
    if (result.reason === 'revoked' && result.presentationId) {
      const pres = await getPresentation(
        crossOrganizationScope(
          repoRoot,
          'share link: the share token is the authorization',
        ),
        result.presentationId,
      );
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
        fireAndForget(
          notifyAuthorOfAccessAttempt({
            presentationId: result.presentationId,
            presentationTitle: pres.title || 'Untitled',
            authorEmail: pres.ownerEmail,
            accessType: ACCESS_TYPES.SHARE_LINK,
            accessReferenceId: result.shareLinkId,
            accessorIp: ipAddress,
            // The deck was resolved from the link, so its organization is
            // the one this access belongs to.
            scope: { organizationId: pres.organizationId },
          }),
          'notify author of share-link access attempt',
        );
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

/** POST /api/share/:token/verify - Verify password and get access */
async function handleShareVerify({ req, res }, token) {
  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;
  const body = parsed.body;

  const ipAddress = getClientIp(req);

  // Brute-force throttle. Resolve the link first (cheap, no hashing) so the
  // limit applies only to password-protected links — the only guessing
  // surface here; a no-password link must stay freely re-openable. Guessing
  // is capped per IP at 3/hour, the same shape and `rate_limited`/429 as the
  // guest-verification limit next door (storage/share-links/guests.js).
  const validation = await validateShareLink(token);
  if (!validation.ok) {
    storageError(res, validation);
    return true;
  }
  if (validation.requiresPassword) {
    const allowed = await allowShareVerifyAttempt({ ip: ipAddress });
    if (!allowed) {
      rateLimited(res, 3600, 'Too many attempts. Please try again later.');
      return true;
    }
  }

  const result = await verifyShareLinkAccess(token, body?.password);

  if (!result.ok) {
    storageError(res, result);
    return true;
  }

  // Log the access against the link the token just resolved to. The link id
  // is the scope — the access log takes no context (see access-log.js).
  const userAgent = req.headers['user-agent'];
  await logShareLinkAccess(result.shareLink.id, { ipAddress, userAgent });

  serveJson(res, 200, {
    presentationId: result.shareLink.presentationId,
    permission: result.shareLink.permission,
    token: result.shareLink.token,
  });
  return true;
}

/** POST /api/share/:token/guest/request - Request guest email verification */
async function handleShareGuestRequest({ repoRoot, req, res }, token) {
  // Validate share link first
  const validation = await validateShareLink(token);
  if (!validation.ok) {
    storageError(res, validation);
    return true;
  }

  // Check permission allows commenting
  if (!canCommentWithShareLink(validation.shareLink)) {
    forbidden(res, 'This share link does not allow commenting');
    return true;
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;

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
  );

  if (!result.ok) {
    storageError(res, result);
    return true;
  }

  // Build verification URL
  const verificationUrl = buildRequestUrl(
    req,
    `/api/share/${encodeURIComponent(token)}/guest/verify/${encodeURIComponent(result.verificationToken)}`,
  );

  if (!verificationUrl) {
    return badRequest(res, 'Invalid host header');
  }

  // Get presentation title for email
  const pres = await getPresentation(
    crossOrganizationScope(
      repoRoot,
      'share link: the share token is the authorization',
    ),
    validation.shareLink.presentationId,
  );
  const presentationTitle = pres?.title || 'Presentation';

  // Send verification email
  fireAndForget(
    sendGuestVerificationEmail({
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
          `[brevo] guest verification email failed to=${email} error=${emailResult.error || ''}`.trim(),
        );
      }
    }),
    `guest verification email to=${email}`,
  );

  serveJson(res, 200, { ok: true, message: 'Verification email sent' });
  return true;
}

/** GET /api/share/:token/guest/verify/:verificationToken - Verify email and create session */
async function handleShareGuestVerify(
  { req, res },
  shareToken,
  verificationToken,
) {
  const result = await verifyGuestEmail(verificationToken);

  const redirectBase = buildRequestUrl(
    req,
    `/s/${encodeURIComponent(shareToken)}`,
  );
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

/** GET /api/share/:token/guest/me - Get current guest session info */
async function handleShareGuestMe({ req, res }, shareToken) {
  // Validate share link first
  const validation = await validateShareLink(shareToken);
  if (!validation.ok) {
    serveJson(res, 200, { authenticated: false });
    return true;
  }

  // Check for guest session cookie
  const cookies = parseCookies(req.headers?.cookie);
  const sessionToken = cookies.share_guest_session;

  if (!sessionToken) {
    serveJson(res, 200, {
      authenticated: false,
      permission: validation.shareLink.permission,
    });
    return true;
  }

  // Get guest by session token
  const guestInfo = await getGuestBySessionToken(sessionToken);

  if (!guestInfo) {
    serveJson(res, 200, {
      authenticated: false,
      permission: validation.shareLink.permission,
    });
    return true;
  }

  // Verify this guest session is for this share link
  if (guestInfo.shareLink.token !== shareToken) {
    serveJson(res, 200, {
      authenticated: false,
      permission: validation.shareLink.permission,
    });
    return true;
  }

  serveJson(res, 200, {
    authenticated: true,
    // The guest's own identity: the id a comment they wrote is keyed on
    // (migration 079), beside the address they gave — their own, so theirs to
    // see (D22).
    id: guestInfo.guest.id,
    email: guestInfo.guest.email,
    name: guestInfo.guest.name,
    permission: guestInfo.shareLink.permission,
    canComment: canCommentWithShareLink(guestInfo.shareLink),
  });
  return true;
}

/**
 * Public routes in the old chain's exact order. `/api/share/:token` is a
 * single-segment match (`[^/]+`), so it cannot swallow the deeper
 * `/verify`, `/guest/*` paths regardless of order — the order is still
 * kept verbatim per route-dispatch.md.
 * @type {import('../../../utils/router.js').Route[]}
 */
export const PUBLIC_ROUTES = [
  {
    method: 'GET',
    pattern: /^\/api\/share\/([^/]+)$/,
    handler: handleShareValidate,
  },
  {
    method: 'POST',
    pattern: /^\/api\/share\/([^/]+)\/verify$/,
    handler: handleShareVerify,
  },
  {
    method: 'POST',
    pattern: /^\/api\/share\/([^/]+)\/guest\/request$/,
    handler: handleShareGuestRequest,
  },
  {
    method: 'GET',
    pattern: /^\/api\/share\/([^/]+)\/guest\/verify\/([^/]+)$/,
    handler: handleShareGuestVerify,
  },
  {
    method: 'GET',
    pattern: /^\/api\/share\/([^/]+)\/guest\/me$/,
    handler: handleShareGuestMe,
  },
];

/**
 * Handle public share link endpoints.
 * @param {import('../../../utils/context.js').PublicContext} ctx
 */
export async function handleSharePublicEndpoints(ctx) {
  return dispatchRoutes(PUBLIC_ROUTES, ctx);
}
