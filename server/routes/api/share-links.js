/**
 * API routes for token-based share links.
 *
 * This file re-exports all share link route handlers from the modular share-links/ directory.
 * Maintained for backward compatibility with existing imports.
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

export { handleShareLinks, handleSharePublic } from './share-links/index.js';