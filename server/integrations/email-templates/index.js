/**
 * Email Templates - Module Entry Point
 *
 * Re-exports all email template functions and utilities.
 * The templates are organized into category-based modules:
 *
 * - helpers.js - Shared utilities (EMAIL_STYLES, emailButton, emailWrapper)
 * - auth.js - Authentication emails (password reset, magic link, invitations)
 * - notifications.js - Notification emails (comments, leads)
 * - digest.js - Digest emails (weekly summary, team digest)
 * - collaboration.js - Collaboration emails (guest verification, invites)
 */

// Shared utilities
export { EMAIL_STYLES, emailButton, emailWrapper, troubleClickingFooter, formatBytes } from './helpers.js';

// Auth templates
export { buildPasswordResetEmail, buildUserInvitationEmail, buildActivationReminderEmail, buildMagicLinkEmail } from './auth.js';

// Notification templates
export { buildCommentNotificationEmail, buildLeadNotificationEmail } from './notifications.js';

// Export templates
export { buildExportReadyEmail } from './export.js';

// Digest templates
export { buildWeeklyDigestEmail, buildTeamDigestEmail } from './digest.js';

// Collaboration templates
export { buildGuestVerificationEmail, buildCollaboratorInviteEmail, buildGuestInvitationEmail } from './collaboration.js';
