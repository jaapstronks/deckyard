/**
 * Public share link endpoints (no auth required) (A7.19 C8 — ROUTES table).
 *
 * GET    /api/share/:token                            - Validate token
 * POST   /api/share/:token/verify                     - Verify password & get access (+ deck, grant)
 * POST   /api/share/:token/render-slide               - Render one slide server-side (needs the grant)
 * POST   /api/share/:token/guest/request              - Request guest email verification (needs the grant)
 * GET    /api/share/:token/guest/verify/:vtoken       - Verify guest email & create session
 * GET    /api/share/:token/guest/me                   - Get current guest session info
 * GET    /api/share/:token/comments                   - A verified guest lists comments (D228)
 * POST   /api/share/:token/comments                   - A verified guest comments (D228)
 * PUT    /api/share/:token/comments/:id               - A guest edits their own comment
 * DELETE /api/share/:token/comments/:id               - A guest deletes their own comment
 *        (the four comment rows live in ./guest-comments.js)
 *
 * Form A throughout (route-dispatch.md): the old chain fell through on a
 * method mismatch, no 405. Table order mirrors the old branch order exactly.
 */

import { randomBytes } from 'node:crypto';
import { getPresentation } from '../../../storage/presentations/index.js';
import {
  validateShareLink,
  verifyShareLinkAccess,
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
  notFound,
  rateLimited,
  requireJsonBody,
  serveJson,
  storageError,
} from '../../../utils/http.js';
import { getTrimmedString } from '../../../utils/request-validators.js';
import { canCommentWithShareLink } from '../../../utils/presentation-authz/index.js';
import { GUEST_COMMENT_ROUTES } from './guest-comments.js';
import {
  buildRequestUrl,
  shouldUseSecureCookies,
} from '../../../utils/request-url.js';
import {
  getClientIp,
  allowShareVerifyAttempt,
} from '../../../utils/rate-limit.js';
import { normalizeEmail } from '../../../../shared/email.js';
import { projectReaderPresentation } from '../../../utils/reader-presentation.js';
import { resolveDeckLang } from '../../../../shared/i18n-utils.js';
import { createLogger } from '../../../utils/logger.js';
import { fireAndForget } from '../../../utils/fire-and-forget.js';
import { crossOrganizationScope } from '../../../storage/scope.js';
import { isFeatureEnabled } from '../../../config/flags-snapshot.js';
import { customThemeConfig } from '../../../utils/themes.js';
import {
  readSignedPayload,
  signPayload,
} from '../../../utils/signed-payload.js';
import { envStr } from '../../../config/utils.js';
import { serveDeckSlideRender } from '../render-slide.js';
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
    // own body (the revoked link carries the author's message, and the deck's
    // title when the link had no password, back to the viewer).

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
        // The password stays the boundary after revocation: a withdrawn link
        // with one does not name its deck to whoever holds the token (B761),
        // just as the living link does not before `verify` (B750).
        presentationTitle: result.requiresPassword ? null : pres?.title || null,
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

/**
 * The deck a share-link viewer is handed, as an explicit field list rather
 * than the stored row — the same shape rule the live-session companion payload
 * follows (`GET /api/live-sessions/:id/deck`).
 *
 * It rides on `verify` because that is where the link's password is proven.
 * A separate `GET /api/share/:token/deck` would have to serve a
 * password-protected deck to anyone holding the token, since nothing on this
 * anonymous surface remembers that a password was entered; folding the deck
 * into the one call that checks it keeps the gate real and adds no second
 * authorization path.
 *
 * `settings` is an allowlist, not a passthrough: the viewer honours exactly
 * these three, and a new deck setting should be a deliberate line here rather
 * than something an operator-facing field leaks out through.
 *
 * `themeConfig` rides along for the same reason the deck itself does: a
 * database theme is resolved through a route behind the login gate, so an
 * anonymous viewer got a 401 and a blank theme (see
 * `server/utils/themes.js` § customThemeConfig). It includes the resolved
 * record config for both seed and organization themes.
 *
 * @param {string|null} repoRoot
 * @param {Object} pres - Presentation as stored.
 * @returns {Promise<Object>} Viewer-safe deck payload.
 */
async function shareViewerDeck(repoRoot, pres) {
  // The view-only filter the authenticated reader route applies (slides marked
  // `hideFromViewers` never leave, drafts come through badged), and with the
  // live cluster off no live-only slide: the viewer has no snapshot, so the
  // server answers (D260).
  const visible = await projectReaderPresentation({ repoRoot }, pres, 'share');
  const settings =
    pres?.settings && typeof pres.settings === 'object' ? pres.settings : {};
  return {
    // `id` as well as the envelope's `presentationId`: the viewer hands this
    // object to the shared slide renderer and the comments API, which address
    // a deck by `id` exactly as they do for an authenticated fetch.
    id: pres.id,
    title: typeof pres.title === 'string' ? pres.title : '',
    theme: pres.theme || '',
    themeConfig: await customThemeConfig(repoRoot, pres.theme, {
      repoRoot,
      organizationId: pres.organizationId,
    }),
    // Resolved here so the viewer never re-derives it from a payload that
    // deliberately omits the i18n block (shared/i18n-utils.js).
    lang: resolveDeckLang(pres) || '',
    revision: Number(pres.revision) || 0,
    slides: Array.isArray(visible.slides) ? visible.slides : [],
    settings: {
      autoAdvance: settings.autoAdvance ?? null,
      liveVideo: settings.liveVideo ?? null,
    },
  };
}

/** POST /api/share/:token/verify - Verify password and get access */
async function handleShareVerify({ repoRoot, req, res }, token) {
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

  // The deck itself. `/api/presentations/:id` cannot serve it: that route is
  // id-addressed and behind the login gate, so an anonymous holder of a valid
  // link got a 401 and the viewer rendered "Failed to load presentation".
  const pres = await getPresentation(
    crossOrganizationScope(
      repoRoot,
      'share link: the share token is the authorization',
    ),
    result.shareLink.presentationId,
  );
  if (!pres) {
    notFound(res);
    return true;
  }

  serveJson(res, 200, {
    presentationId: result.shareLink.presentationId,
    permission: result.shareLink.permission,
    token: result.shareLink.token,
    grant: mintShareGrant(result.shareLink),
    // Whether this installation has the analytics cluster (D260). The viewer
    // is anonymous and has no feature snapshot, so the payload carries the
    // answer; the owner's opt-out stays the tracking route's (D234).
    tracking: isFeatureEnabled('analytics'),
    presentation: await shareViewerDeck(repoRoot, pres),
  });
  return true;
}

/** How long a grant outlives the `verify` that minted it. */
const SHARE_GRANT_TTL_MS = 24 * 60 * 60 * 1000;
const SHARE_GRANT_PURPOSE = 'share-access';
/**
 * Signing key when no AUTH_SECRET is configured: per boot, so grants die with
 * the process (a reload mints a new one). Same rule as the analytics device
 * label key (`server/analytics/helpers.js`).
 */
const EPHEMERAL_GRANT_KEY = randomBytes(32).toString('hex');

function shareGrantKey() {
  return envStr('AUTH_SECRET') || EPHEMERAL_GRANT_KEY;
}

/**
 * The proof that this viewer passed `verify` for this link.
 *
 * Two routes hand out something the password guards: `render-slide` the
 * deck's slides, `guest/request` the guest session that reads and writes the
 * deck's comments. Both must sit behind the gate `verify` is. Nothing on this
 * anonymous surface remembers that the password was entered (see
 * {@link shareViewerDeck}), and asking for it on each of those calls would make
 * every one a password check and a guessing oracle outside verify's throttle.
 * So verify mints one signed grant for the link, and both routes ask for that
 * ({@link hasShareGrant}). Every link gets one, password or not: one shape, and
 * neither route skips the `verify` that counts a use.
 *
 * Revocation and expiry still bite at once: both routes validate the link
 * itself on every request; the grant only stands in for the password. The
 * guest comment routes ask for the session, not the grant: `guest/request` is
 * the only door to a session, so a session already carries this proof.
 *
 * @param {{ id: string }} shareLink
 * @returns {string}
 */
function mintShareGrant(shareLink) {
  return signPayload(
    {
      purpose: SHARE_GRANT_PURPOSE,
      link: shareLink.id,
      exp: Date.now() + SHARE_GRANT_TTL_MS,
    },
    shareGrantKey(),
  );
}

/**
 * Whether a request body carries a live grant for this link
 * ({@link mintShareGrant}).
 *
 * @param {Object|null|undefined} body - The parsed request body.
 * @param {{ id: string }} shareLink - The link the token resolved to.
 * @returns {boolean}
 */
function hasShareGrant(body, shareLink) {
  const grant = readSignedPayload(body?.grant, shareGrantKey());
  return grant?.purpose === SHARE_GRANT_PURPOSE && grant.link === shareLink.id;
}

/**
 * POST /api/share/:token/render-slide — render one slide of the shared deck.
 * Body: `{ slideId, mode?, grant }`.
 *
 * The slides are the ones `verify` hands the viewer (view-only filter, drafts
 * badged), so a slide hidden from viewers cannot be rendered here either.
 */
async function handleShareRenderSlide({ repoRoot, req, res }, token) {
  const validation = await validateShareLink(token);
  if (!validation.ok) {
    storageError(res, validation);
    return true;
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;

  if (!hasShareGrant(body, validation.shareLink)) {
    forbidden(res, 'Open the share link to render its slides');
    return true;
  }

  const pres = await getPresentation(
    crossOrganizationScope(
      repoRoot,
      'share link: the share token is the authorization',
    ),
    validation.shareLink.presentationId,
  );
  if (!pres) return notFound(res);

  const visible = await projectReaderPresentation({ repoRoot }, pres, 'share');
  return serveDeckSlideRender({ repoRoot, res }, body, {
    pres,
    slides: Array.isArray(visible.slides) ? visible.slides : [],
    lang: resolveDeckLang(pres),
  });
}

/**
 * POST /api/share/:token/guest/request — request guest email verification.
 * Body: `{ email, name?, grant }`; the grant is the one `verify` handed out,
 * so a password-protected link admits no guest who has not given it (B761).
 */
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

  if (!hasShareGrant(body, validation.shareLink)) {
    forbidden(res, 'Open the share link to join its discussion');
    return true;
  }

  // The address guard lives in the storage layer (`requestGuestVerification`),
  // which answers the canonical `{ reason:'invalid', field:'email' }`. A route
  // pre-check here would shadow it with `bad_request` and leave the client's
  // email copy unreachable.
  const email = normalizeEmail(body?.email);
  const name = getTrimmedString(body, 'name') || '';

  // Request verification
  const result = await requestGuestVerification(
    crossOrganizationScope(
      repoRoot,
      'validated share token grants access to link',
    ),
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
 * Public routes in the old chain's exact order (`render-slide`, B287, joined
 * after `verify`, whose grant it asks for). `/api/share/:token` is a
 * single-segment match (`[^/]+`), so it cannot swallow the deeper
 * `/verify`, `/guest/*` paths regardless of order — the order is still
 * kept verbatim per route-dispatch.md.
 * @type {import('../../../utils/router.js').Route[]}
 */
export const PUBLIC_ROUTES = [
  {
    method: 'GET',
    pattern: /^\/api\/share\/([^/]+)$/,
    captures: ['text'],
    handler: handleShareValidate,
  },
  {
    method: 'POST',
    pattern: /^\/api\/share\/([^/]+)\/verify$/,
    captures: ['text'],
    handler: handleShareVerify,
  },
  {
    method: 'POST',
    pattern: /^\/api\/share\/([^/]+)\/render-slide$/,
    captures: ['text'],
    handler: handleShareRenderSlide,
  },
  {
    method: 'POST',
    pattern: /^\/api\/share\/([^/]+)\/guest\/request$/,
    captures: ['text'],
    handler: handleShareGuestRequest,
  },
  {
    method: 'GET',
    pattern: /^\/api\/share\/([^/]+)\/guest\/verify\/([^/]+)$/,
    captures: ['text', 'text'],
    handler: handleShareGuestVerify,
  },
  {
    method: 'GET',
    pattern: /^\/api\/share\/([^/]+)\/guest\/me$/,
    captures: ['text'],
    handler: handleShareGuestMe,
  },
  // The guest's own comment routes (B179, D228), last: their paths are
  // deeper than every row above, so the order changes no match.
  ...GUEST_COMMENT_ROUTES,
];

/**
 * Handle public share link endpoints.
 * @param {import('../../../utils/context.js').PublicContext} ctx
 */
export async function handleSharePublicEndpoints(ctx) {
  return dispatchRoutes(PUBLIC_ROUTES, ctx);
}
