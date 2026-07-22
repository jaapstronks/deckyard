/**
 * Storage layer for token-based share links.
 * Enables external access to presentations without requiring user accounts.
 *
 * This file re-exports all share link functionality from the modular share-links/ directory.
 * Maintained for backward compatibility with existing imports.
 */

export {
  // Token generation
  generateShareToken,
  generateGuestToken,

  // Password hashing
  hashPassword,
  verifyPassword,

  // Cleanup
  cleanupExpiredShareLinks,

  // CRUD operations
  createShareLink,
  getShareLinkByToken,
  getShareLinkById,
  validateShareLink,
  verifyShareLinkAccess,
  listShareLinks,
  updateShareLink,
  revokeShareLink,
  revokeAllShareLinks,
  formatShareLink,

  // Access logging
  logShareLinkAccess,
  getShareLinkAccessLog,

  // Guest management
  requestGuestVerification,
  verifyGuestEmail,
  getGuestBySessionToken,
  getGuestByEmail,
  extendGuestSession,
  invalidateGuestSessions,
  preRegisterGuest,
  listGuestsForShareLink,
  removeGuest,
  markInvitationSent,
  formatGuest,
} from './share-links/index.js';