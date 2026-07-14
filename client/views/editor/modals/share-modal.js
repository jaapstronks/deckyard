/**
 * Share modal for creating and managing share links and collaborators.
 *
 * This file re-exports from the modular implementation for backward compatibility.
 * The actual implementation is split into:
 * - share-modal/index.js - Main modal assembly
 * - share-modal/collaborators-section.js - Workspace user invitations
 * - share-modal/share-links-section.js - External guest share links
 * - share-modal/guest-management.js - Guest management for invite-only links
 * - share-modal/utils.js - Utility functions
 */

export { openShareModal } from './share-modal/index.js';