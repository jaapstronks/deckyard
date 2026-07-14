/**
 * Email module - Brevo (formerly Sendinblue) transactional email client.
 *
 * API docs: https://developers.brevo.com/reference/sendtransacemail
 *
 * Templates are defined in ../email-templates.js
 * Admin-customized templates are resolved via ../email-template-resolver.js
 *
 * Sender identity can be configured via:
 * 1. Admin settings (emailSender.email, emailSender.name)
 * 2. Environment variables (BREVO_SENDER_EMAIL, BREVO_SENDER_NAME)
 * 3. Hardcoded fallbacks
 */

// Core functionality
export { sendEmail, getSenderIdentity, BREVO_API_URL } from './core.js';

// Template building (for internal use)
export { trySendCustomTemplate, buildFromResolvedTemplate } from './template-builder.js';

// Authentication emails
export {
  sendPasswordResetEmail,
  sendUserInvitationEmail,
  sendActivationReminderEmail,
  sendMagicLinkEmail,
} from './senders-auth.js';

// Collaboration emails
export {
  sendCommentNotification,
  sendGuestVerificationEmail,
  sendCollaboratorInviteEmail,
  sendGuestInvitationEmail,
} from './senders-collaboration.js';

// Digest emails
export {
  sendWeeklyDigestEmail,
  sendTeamDigestEmail,
} from './senders-digests.js';

// Lead capture emails
export {
  maybeSendLeadNotification,
} from './senders-leads.js';
