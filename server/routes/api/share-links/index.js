/**
 * API routes for token-based share links (A7.19 C8 — ROUTES tables).
 *
 * The handlers live in sub-modules; this file combines their route tables.
 *
 * Authenticated endpoints (require login):
 *   POST   /api/presentations/:id/share-links     - Create share link
 *   GET    /api/presentations/:id/share-links     - List share links
 *   DELETE /api/presentations/:id/share-links/:linkId - Revoke link
 *   PATCH  /api/presentations/:id/share-links/:linkId - Update link
 *   DELETE /api/presentations/:id/share-links     - Revoke all links
 *
 * Public endpoints (no auth required):
 *   GET    /api/share/:token                      - Validate token
 *   POST   /api/share/:token/verify               - Verify password & get access
 *   POST   /api/share/:token/guest/request        - Request guest email verification
 *   GET    /api/share/:token/guest/verify/:vtoken - Verify guest email & create session
 *   GET    /api/share/:token/guest/me             - Get current guest session info
 */

import { dispatchRoutes } from '../../../utils/router.js';
import { MANAGEMENT_ROUTES } from './management.js';
import { GUEST_ROUTES } from './guests.js';
import { PUBLIC_ROUTES } from './public.js';
import { withErrorHandler } from '../../../utils/http.js';

export { PUBLIC_ROUTES };

/**
 * Authenticated share-link routes: management first, then guest management —
 * the same order the old combined handler tried them in.
 * @type {import('../../../utils/router.js').Route[]}
 */
export const AUTHED_ROUTES = [...MANAGEMENT_ROUTES, ...GUEST_ROUTES];

/**
 * Handle authenticated share link management endpoints.
 * @param {import('../../../utils/context.js').AuthedContext} ctx
 */
export const handleShareLinks = withErrorHandler('share-links', async (ctx) => {
  return dispatchRoutes(AUTHED_ROUTES, ctx);
});

/**
 * Handle public share link endpoints (no auth required).
 * @param {import('../../../utils/context.js').PublicContext} ctx
 */
export const handleSharePublic = withErrorHandler(
  'share-links',
  async (ctx) => {
    return dispatchRoutes(PUBLIC_ROUTES, ctx);
  },
);
