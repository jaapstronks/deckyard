import {
  authEnabled,
  clearSessionCookie,
  devAuthBypassEnabled,
  devBypassUser,
  getUserFromRequest,
  getUserFromRequestAsync,
  setSessionCookie,
  verifyLoginAsync,
} from '../../auth/auth.js';
import { json, serveJson, unauthorized } from '../../utils/http.js';
import { t } from '../../i18n/index.js';
import { getFeatureFlags } from '../../config/feature-flags.js';
import { readUserSettings } from '../../storage/settings.js';
import { sandboxEnabled } from '../../config/sandbox.js';
import { ensureSandboxUser } from '../../auth/sandbox.js';
import { logAuthEvent } from '../../storage/password-reset.js';
import { getClientIp } from '../../utils/context.js';
import { normalizeEmail } from '../../utils/normalize.js';
import { resolveDesignerCapability } from '../../utils/designer.js';
import { canEditCustomHtml } from '../../utils/route-middleware.js';

export async function handleAuth({ repoRoot, req, res, url }) {
  // Build context for database operations
  const ctx = { repoRoot, req };

  if (url.pathname === '/api/auth/dev-login' && req.method === 'POST') {
    if (!devAuthBypassEnabled())
      return unauthorized(res, 'Dev bypass disabled');
    // If auth isn't enabled, /api/auth/me already returns an admin user, but
    // setting a session cookie makes the client path identical.
    if (authEnabled()) setSessionCookie(req, res, devBypassUser());
    serveJson(res, 200, { user: devBypassUser() });
    return true;
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await json(req);
    const email = typeof body?.email === 'string' ? body.email : '';
    const password =
      typeof body?.password === 'string' ? body.password : '';

    // Use async verification to support database users
    const user = await verifyLoginAsync(email, password, ctx);

    // Log the authentication attempt
    await logAuthEvent({
      type: 'login',
      email: normalizeEmail(email),
      success: !!user,
      ipAddress: getClientIp(req),
      userAgent: req.headers?.['user-agent'] || '',
    });

    if (!user)
      return unauthorized(res, t('api.error.invalidEmailPassword', 'Invalid email/password'));
    setSessionCookie(req, res, user);
    serveJson(res, 200, {
      user: {
        email: user.email,
        role: user.role,
        name: user.name || '',
        isAdmin: user.isAdmin,
      },
    });
    return true;
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    clearSessionCookie(req, res);
    serveJson(res, 200, { ok: true });
    return true;
  }

  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    // Sandbox mode: /me must reflect the sandbox guest (not the auth-less "anonymous admin" user),
    // otherwise the client will treat the user as admin and show global/workspace data.
    // Use async version to properly validate database users who migrated from ENV auth.
    const u = sandboxEnabled()
      ? ensureSandboxUser(req, res)
      : await getUserFromRequestAsync(req, ctx);
    if (!sandboxEnabled() && !u && authEnabled())
      return unauthorized(res);
    let outUser = u;
    try {
      if (u?.email) {
        const s = await readUserSettings(repoRoot, u.email);
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

  return false;
}
