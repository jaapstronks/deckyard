/**
 * API routes for token-based share links.
 *
 * This module re-exports handlers from sub-modules and provides combined handler functions.
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

import { handleShareLinkManagement } from './management.js';
import { handleGuestManagement } from './guests.js';
import { handleSharePublicEndpoints } from './public.js';

/**
 * Handle authenticated share link management endpoints.
 * Combines management and guest handlers.
 */
export async function handleShareLinks(params) {
  // Try management endpoints first
  const managementResult = await handleShareLinkManagement(params);
  if (managementResult) return true;

  // Then try guest management endpoints
  const guestResult = await handleGuestManagement(params);
  if (guestResult) return true;

  return false;
}

/**
 * Handle public share link endpoints (no auth required).
 */
export async function handleSharePublic(params) {
  return handleSharePublicEndpoints(params);
}