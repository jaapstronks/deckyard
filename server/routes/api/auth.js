/**
 * Login/session routes (A7.19 C8 — ROUTES table).
 *
 * Mounted **before** the auth gate in `routes/api/index.js`: these endpoints
 * establish (or inspect) the session, so they receive a `PublicContext` and
 * do their own user resolution where needed.
 *
 * Form A throughout (route-dispatch.md): every old branch was an exact path
 * plus method with fall-through on a mismatch, no 405. Table order mirrors
 * the old branch order exactly.
 */

import {
  authEnabled,
  clearSessionCookie,
  devAuthBypassEnabled,
  devBypassUser,
  getUserFromRequestAsync,
  setSessionCookie,
  verifyLoginAsync,
} from '../../auth/auth.js';
import { rateLimited, serveJson, unauthorized, requireJsonBody , withErrorHandler } from '../../utils/http.js';
import { getString } from '../../utils/request-validators.js';
import { t } from '../../i18n/index.js';
import { getFeatureFlags } from '../../config/flags-snapshot.js';
import { getUserSettings } from '../../storage/settings.js';
import { sandboxEnabled } from '../../config/sandbox.js';
import { ensureSandboxUser } from '../../auth/sandbox.js';
import { logAuthEvent } from '../../storage/password-reset.js';
import { getClientIp } from '../../utils/context.js';
import { dispatchRoutes } from '../../utils/router.js';
import { allowLoginAttempt } from '../../utils/rate-limit.js';
import { normalizeEmail } from '../../utils/normalize.js';
import { resolveDesignerCapability } from '../../utils/designer.js';
import { canEditCustomHtml } from '../../utils/route-middleware.js';
import { getSsoPublicConfig } from '../../config/sso.js';
import { crossOrganizationScope } from '../../storage/scope.js';

/**
 * GET /api/auth/config
 * Public, non-secret auth config for the login page (unauthenticated).
 * Tells the client whether to show an SSO button and whether to hide the
 * password / magic-link forms (SSO_ENFORCE).
 */
async function handleAuthConfig({ res }) {
  serveJson(res, 200, { sso: getSsoPublicConfig() });
  return true;
}

/** POST /api/auth/dev-login */
async function handleDevLogin({ req, res }) {
  if (!devAuthBypassEnabled())
    return unauthorized(res, 'Dev bypass disabled');
  // If auth isn't enabled, /api/auth/me already returns an admin user, but
  // setting a session cookie makes the client path identical.
  if (authEnabled()) setSessionCookie(req, res, devBypassUser());
  serveJson(res, 200, { user: devBypassUser() });
  return true;
}

/** POST /api/auth/login */
async function handleLogin({ repoRoot, req, res }) {
  // Build context for database operations
  const ctx = { repoRoot, req };

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const email = getString(body, 'email');
  const password = getString(body, 'password');

  // Brute-force throttle (per-IP + per-email) before the expensive password
  // verification, so login can't be hammered. See
  // docs/reference/security-posture.md § Login brute-force throttle.
  const ip = getClientIp(req);
  const allowed = await allowLoginAttempt({
    ip,
    email: normalizeEmail(email),
  });
  if (!allowed) {
    await logAuthEvent({
      type: 'login',
      email: normalizeEmail(email),
      success: false,
      ipAddress: ip,
      userAgent: req.headers?.['user-agent'] || '',
    });
    rateLimited(
      res,
      10,
      t(
        'api.error.tooManyLoginAttempts',
        'Too many login attempts. Please try again later.'
      )
    );
    return true;
  }

  // Use async verification to support database users
  const user = await verifyLoginAsync(email, password, ctx);

  // Log the authentication attempt
  await logAuthEvent({
    type: 'login',
    email: normalizeEmail(email),
    success: !!user,
    ipAddress: ip,
    userAgent: req.headers?.['user-agent'] || '',
  });

  if (!user)
    return unauthorized(res, t('api.error.invalidEmailPassword', 'Invalid email/password'));
  setSessionCookie(req, res, user);
  serveJson(res, 200, {
    user: {
      // Identity is the id; the email beside it is display/contact. Both the
      // login response and /api/auth/me carry it, so the client never has to
      // fall back to comparing addresses (shared/identity-match.js).
      id: user.id ?? null,
      email: user.email,
      role: user.role,
      name: user.name || '',
      isAdmin: user.isAdmin,
    },
  });
  return true;
}

/** POST /api/auth/logout */
async function handleLogout({ req, res }) {
  clearSessionCookie(req, res);
  serveJson(res, 200, { ok: true });
  return true;
}

/** GET /api/auth/me */
async function handleAuthMe({ repoRoot, req, res }) {
  // Build context for database operations
  const ctx = { repoRoot, req };

  // Sandbox mode: /me must reflect the sandbox guest (not the auth-less "anonymous admin" user),
  // otherwise the client will treat the user as admin and show global/organization data.
  // Use async version to properly validate database users who migrated from ENV auth.
  const u = sandboxEnabled()
    ? ensureSandboxUser(req, res)
    : await getUserFromRequestAsync(req, ctx);
  if (!sandboxEnabled() && !u && authEnabled())
    return unauthorized(res);
  let outUser = u;
  try {
    if (u?.email) {
      const s = await getUserSettings(
        crossOrganizationScope(repoRoot, 'login profile read: the session cookie identifies the user'),
        u.email
      );
      const name = String(s?.profile?.name || '').trim();
      if (name) outUser = { ...u, name };
    }
  } catch {
    // ignore settings load failures; /me should stay reliable
  }
  // Resolve designer capability from membership + org settings
  try {
    if (outUser?.email) {
      const isDesigner = await resolveDesignerCapability(outUser);
      outUser = { ...outUser, isDesigner };
    }
  } catch {
    // ignore designer resolution failures; /me should stay reliable
  }
  // Resolve raw-HTML authoring capability (custom-html-slide gate)
  if (outUser) {
    outUser = { ...outUser, canEditCustomHtml: canEditCustomHtml(outUser) };
  }
  serveJson(res, 200, { user: outUser, features: getFeatureFlags() });
  return true;
}

/** @type {import('../../utils/router.js').Route[]} */
export const ROUTES = [
  { method: 'GET', pattern: '/api/auth/config', handler: handleAuthConfig },
  { method: 'POST', pattern: '/api/auth/dev-login', handler: handleDevLogin },
  { method: 'POST', pattern: '/api/auth/login', handler: handleLogin },
  { method: 'POST', pattern: '/api/auth/logout', handler: handleLogout },
  { method: 'GET', pattern: '/api/auth/me', handler: handleAuthMe },
];

/**
 * Handle the login/session endpoints.
 * @param {import('../../utils/context.js').PublicContext} ctx
 */
export const handleAuth = withErrorHandler('auth', async (ctx) => {
  return dispatchRoutes(ROUTES, ctx);
});
