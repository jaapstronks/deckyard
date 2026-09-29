/**
 * Admin API route for the claims of recent SSO logins (B551).
 *
 *   GET /api/admin/sso/logins -> { enabled, logins: SsoLoginRecord[] }
 *
 * An instance admin reads what the identity provider sent at the last few
 * logins, refused ones included, to set `OIDC_ADMIN_GROUPS`,
 * `OIDC_GROUPS_CLAIM` and `OIDC_ORG_CLAIM` without devtools. The list lives
 * in process memory and holds claims, never tokens; see
 * server/auth/sso-recent-logins.js for what is kept and for how long.
 *
 * Instance-wide on purpose, like admin-users: which claims an identity
 * provider sends is a property of the instance configuration, and the list
 * holds logins from every organization.
 *
 * @see docs/reference/sso-oidc.md § Inspecting the claims of a login
 */

import {
  forbidden,
  serveJson,
  unauthorized,
  withErrorHandler,
} from '../../utils/http.js';
import { dispatchRoutes } from '../../utils/router.js';
import { isSsoEnabled } from '../../config/sso.js';
import { listRecentSsoLogins } from '../../auth/sso-recent-logins.js';

// GET /api/admin/sso/logins
function handleSsoLogins({ res }) {
  serveJson(res, 200, {
    enabled: isSsoEnabled(),
    logins: listRecentSsoLogins(),
  });
  return true;
}

/** @type {import('../../utils/router.js').Route[]} */
export const ROUTES = [
  { method: 'GET', pattern: '/api/admin/sso/logins', handler: handleSsoLogins },
];

/**
 * Handle the admin SSO routes. Mounted after the auth gate in
 * routes/api/index.js, so the user on the context is already resolved.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleAdminSso = withErrorHandler('admin-sso', (ctx) => {
  if (!ctx.url.pathname.startsWith('/api/admin/sso/')) return false;
  if (!ctx.authedUser) {
    return unauthorized(ctx.res, 'Authentication required');
  }
  if (!ctx.authedUser.isAdmin) {
    return forbidden(ctx.res, 'Admin access required');
  }
  return dispatchRoutes(ROUTES, ctx);
});
