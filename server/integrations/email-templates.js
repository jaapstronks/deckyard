/**
 * Email Templates - Main Entry Point
 *
 * This file re-exports all email template functions from the modular structure.
 * The templates have been split into category-based modules for better maintainability:
 *
 * - email-templates/index.js - Shared utilities (EMAIL_STYLES, emailButton, emailWrapper)
 * - email-templates/auth.js - Authentication emails (password reset, magic link, invitations)
 * - email-templates/notifications.js - Notification emails (comments, leads)
 * - email-templates/export.js - Export emails (export ready)
 * - email-templates/digest.js - Digest emails (weekly summary, team digest)
 * - email-templates/collaboration.js - Collaboration emails (guest verification, invites)
 */

// Re-export everything from the modular structure
export {
  // Shared utilities
  EMAIL_STYLES,
  emailButton,
  emailWrapper,
  troubleClickingFooter,
  formatBytes,
  // Auth templates
  buildPasswordResetEmail,
  buildUserInvitationEmail,
  buildActivationReminderEmail,
  buildMagicLinkEmail,
  // Notification templates
  buildCommentNotificationEmail,
  buildLeadNotificationEmail,
  // Export templates
  buildExportReadyEmail,
  // Digest templates
  buildWeeklyDigestEmail,
  buildTeamDigestEmail,
  // Collaboration templates
  buildGuestVerificationEmail,
  buildCollaboratorInviteEmail,
  buildGuestInvitationEmail,
} from './email-templates/index.js';
