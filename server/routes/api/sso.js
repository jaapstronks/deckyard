/**
 * API routes for OIDC single sign-on (Track 1: self-hosted, single IdP).
 *
 *   GET /api/auth/oidc/login    -> build PKCE authz URL, stash state, redirect
 *   GET /api/auth/oidc/callback -> verify state/nonce, exchange code, verify
 *                                  ID token, JIT-provision, mint session, redirect
 *
 * Both are public (no prior session) and GET-only, so they pass the CSRF gate.
 * CSRF for the OAuth flow itself is covered by the `state` value, which is
 * bound to the browser through a short-lived signed cookie ({@link STATE_COOKIE})
 * and checked at the callback.
 *
 * @see server/auth/providers/oidc.js
 * @see docs/plans/briefs/sso-integration.md (Track 1)
 */

import crypto from 'node:crypto';
import { setSessionCookie } from '../../auth/auth.js';
import {
  isSsoEnabled,
  getOidcConfig,
} from '../../config/sso.js';
import {
  buildLoginRequest,
  completeLogin,
  mapClaimsToIdentity,
  OidcError,
  logDiscoveryFailure,
} from '../../auth/providers/oidc.js';
import { getOrCreateSsoUser } from '../../storage/sso.js';
import { logAuthEvent } from '../../storage/password-reset.js';
import { getClientIp, createRouteContext } from '../../utils/context.js';
import { shouldUseSecureCookies } from '../../utils/request-url.js';
import { parseCookies } from '../../utils/cookies.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('sso');

/** Short-lived cookie binding the OAuth `state`/`nonce`/PKCE to this browser. */
const STATE_COOKIE = 'sb_oidc';
/** State cookie lifetime — long enough to complete an IdP login, no longer. */
const STATE_TTL_MS = 10 * 60 * 1000;

function base64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

/** Sign the OAuth-flow state payload with the auth secret (HMAC-SHA256). */
function signState(payload) {
  const secret = String(process.env.AUTH_SECRET || '');
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Verify + decode the state cookie. Returns the payload or null when the
 * signature is bad, it is malformed, or it has expired.
 * @param {string} token
 * @returns {object|null}
 */
function verifyState(token) {
  const secret = String(process.env.AUTH_SECRET || '');
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload?.exp || Number(payload.exp) < Date.now()) return null;
  return payload;
}

/** Build a Set-Cookie value for the state cookie (or clear it with maxAge 0). */
function stateCookieHeader(req, value, maxAgeSeconds) {
  const parts = [
    `${STATE_COOKIE}=${value}`,
    'Path=/api/auth/oidc',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (shouldUseSecureCookies(req)) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Validate a returnTo target: only same-site absolute paths are allowed, so the
 * post-login redirect can't be turned into an open redirect.
 * @param {string} raw
 * @returns {string}
 */
function safeReturnTo(raw) {
  const v = String(raw || '');
  return v.startsWith('/') && !v.startsWith('//') ? v : '/app';
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

export async function handleSso({ repoRoot, req, res, url }) {
  if (!url.pathname.startsWith('/api/auth/oidc/')) return false;

  const ctx = createRouteContext(null);
  ctx.repoRoot = repoRoot;

  // ============================================================
  // GET /api/auth/oidc/login
  // ============================================================
  if (url.pathname === '/api/auth/oidc/login' && req.method === 'GET') {
    if (!isSsoEnabled()) {
      return redirect(res, '/login?error=sso_disabled'), true;
    }
    const oidc = getOidcConfig();
    try {
      const { url: authUrl, state, nonce, codeVerifier } = await buildLoginRequest(oidc);
      const returnTo = safeReturnTo(url.searchParams.get('returnTo'));
      const cookie = signState({
        state,
        nonce,
        codeVerifier,
        returnTo,
        exp: Date.now() + STATE_TTL_MS,
      });
      res.setHeader('Set-Cookie', stateCookieHeader(req, cookie, Math.floor(STATE_TTL_MS / 1000)));
      return redirect(res, authUrl), true;
    } catch (err) {
      logDiscoveryFailure(err);
      return redirect(res, '/login?error=sso_unavailable'), true;
    }
  }

  // ============================================================
  // GET /api/auth/oidc/callback
  // ============================================================
  if (url.pathname === '/api/auth/oidc/callback' && req.method === 'GET') {
    if (!isSsoEnabled()) {
      return redirect(res, '/login?error=sso_disabled'), true;
    }

    const ipAddress = getClientIp(req);
    const userAgent = req.headers?.['user-agent'] || '';

    // Recover + immediately clear the one-time state cookie.
    const cookies = parseCookies(req.headers?.cookie);
    const stateData = verifyState(cookies[STATE_COOKIE]);
    res.setHeader('Set-Cookie', stateCookieHeader(req, '', 0));

    if (!stateData) {
      await logAuthEvent({
        type: 'sso_login', email: null, success: false, ipAddress, userAgent,
        metadata: { reason: 'missing_state' },
      });
      return redirect(res, '/login?error=sso_state'), true;
    }

    const oidc = getOidcConfig();

    // Rebuild the callback URL from the configured redirect_uri origin + the
    // actual query params, so a proxy host mismatch can't break verification.
    const currentUrl = new URL(oidc.redirectUri);
    for (const [k, v] of url.searchParams) currentUrl.searchParams.set(k, v);

    let identity;
    try {
      const claims = await completeLogin(currentUrl, {
        codeVerifier: stateData.codeVerifier,
        expectedState: stateData.state,
        expectedNonce: stateData.nonce,
      }, oidc);
      identity = mapClaimsToIdentity(claims, oidc);
    } catch (err) {
      const reason = err instanceof OidcError ? err.reason : 'token_exchange_failed';
      if (!(err instanceof OidcError)) logDiscoveryFailure(err);
      await logAuthEvent({
        type: 'sso_login', email: null, success: false, ipAddress, userAgent,
        metadata: { reason },
      });
      log.warn('OIDC callback rejected:', reason);
      return redirect(res, `/login?error=sso_${reason}`), true;
    }

    const result = await getOrCreateSsoUser(
      identity,
      { autoProvision: oidc.autoProvision, defaultRole: oidc.defaultRole },
      ctx
    );

    if (!result.ok) {
      await logAuthEvent({
        type: 'sso_login', email: identity.email, success: false, ipAddress, userAgent,
        metadata: { reason: result.reason },
      });
      return redirect(res, `/login?error=sso_${result.reason}`), true;
    }

    setSessionCookie(req, res, result.user);
    // setSessionCookie replaces the Set-Cookie header, so re-clear the
    // one-time state cookie alongside the new session cookie.
    res.appendHeader('Set-Cookie', stateCookieHeader(req, '', 0));
    await logAuthEvent({
      type: 'sso_login', email: identity.email, success: true, ipAddress, userAgent,
      metadata: { provisioned: result.provisioned, provider: 'oidc' },
    });

    return redirect(res, safeReturnTo(stateData.returnTo)), true;
  }

  return false;
}
