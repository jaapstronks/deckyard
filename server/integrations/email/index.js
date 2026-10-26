/** Public transactional email seam. */
// Core functionality
export { sendEmail, isEmailConfigured, getSenderIdentity } from './core.js';

// The language a mail is written in
export { resolveRecipientLocale } from './recipient-locale.js';

// Template building (for internal use)
export {
  trySendCustomTemplate,
  buildFromResolvedTemplate,
} from './template-builder.js';

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
