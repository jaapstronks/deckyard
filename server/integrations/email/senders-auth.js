/**
 * Authentication-related email senders.
 */

import { createTranslator } from '../../i18n/index.js';
import {
  buildPasswordResetEmail,
  buildUserInvitationEmail,
  buildActivationReminderEmail,
  buildMagicLinkEmail,
} from '../email-templates.js';
import { sendEmail, getSenderIdentity } from './core.js';
import { trySendCustomTemplate } from './template-builder.js';

/**
 * Send a password reset email.
 * @param {Object} options
 * @param {string} [options.repoRoot] - Repository root for custom template and sender resolution
 */
export async function sendPasswordResetEmail({
  recipientEmail,
  recipientName,
  resetUrl,
  expiresAt,
  locale = 'en',
  repoRoot = null,
}) {
  const tr = createTranslator(locale);
  const name = recipientName || 'there';

  // Get sender identity from settings
  const senderOverride = await getSenderIdentity(repoRoot);

  // Try custom template first
  const customResult = await trySendCustomTemplate({
    repoRoot,
    templateType: 'passwordReset',
    locale,
    vars: { name },
    actionUrl: resetUrl,
    emailOpts: { to: recipientEmail, toName: recipientName, senderOverride },
  });
  if (customResult) return customResult;

  // Default behavior
  const subject = tr('email.passwordReset.subject', 'Reset your password');

  const { htmlContent, textContent } = buildPasswordResetEmail({
    tr,
    name,
    resetUrl,
  });

  return sendEmail({
    to: recipientEmail,
    toName: recipientName,
    subject,
    htmlContent,
    textContent,
    senderOverride,
  });
}

/**
 * Send a user invitation email.
 * @param {Object} options
 * @param {string} [options.repoRoot] - Repository root for custom template and sender resolution
 */
export async function sendUserInvitationEmail({
  recipientEmail,
  recipientName,
  invitedBy,
  setupUrl,
  expiresAt,
  locale = 'en',
  repoRoot = null,
}) {
  const tr = createTranslator(locale);
  const name = recipientName || 'there';
  const inviter = invitedBy || 'An administrator';

  // Get sender identity from settings
  const senderOverride = await getSenderIdentity(repoRoot);

  // Try custom template first
  const customResult = await trySendCustomTemplate({
    repoRoot,
    templateType: 'userInvitation',
    locale,
    vars: { name, inviter },
    actionUrl: setupUrl,
    emailOpts: { to: recipientEmail, toName: recipientName, senderOverride },
  });
  if (customResult) return customResult;

  // Default behavior
  const subject = tr('email.userInvitation.subject', "You've been invited to join");

  const { htmlContent, textContent } = buildUserInvitationEmail({
    tr,
    name,
    inviter,
    setupUrl,
  });

  return sendEmail({
    to: recipientEmail,
    toName: recipientName,
    subject,
    htmlContent,
    textContent,
    senderOverride,
  });
}

/**
 * Send an activation reminder email (for users who haven't completed account setup).
 * @param {Object} options
 * @param {string} [options.repoRoot] - Repository root for custom template and sender resolution
 */
export async function sendActivationReminderEmail({
  recipientEmail,
  recipientName,
  invitedBy,
  setupUrl,
  locale = 'en',
  repoRoot = null,
}) {
  const tr = createTranslator(locale);
  const name = recipientName || 'there';
  const inviter = invitedBy || 'An administrator';

  // Get sender identity from settings
  const senderOverride = await getSenderIdentity(repoRoot);

  // Try custom template first
  const customResult = await trySendCustomTemplate({
    repoRoot,
    templateType: 'activationReminder',
    locale,
    vars: { name, inviter },
    actionUrl: setupUrl,
    emailOpts: { to: recipientEmail, toName: recipientName, senderOverride },
  });
  if (customResult) return customResult;

  // Default behavior
  const subject = tr('email.activationReminder.subject', 'Reminder: Complete your account setup');

  const { htmlContent, textContent } = buildActivationReminderEmail({
    tr,
    name,
    inviter,
    setupUrl,
  });

  return sendEmail({
    to: recipientEmail,
    toName: recipientName,
    subject,
    htmlContent,
    textContent,
    senderOverride,
  });
}

/**
 * Send a magic link email for passwordless login.
 * @param {Object} options
 * @param {string} [options.repoRoot] - Repository root for custom template and sender resolution
 */
export async function sendMagicLinkEmail({
  recipientEmail,
  magicLinkUrl,
  expiresAt,
  hasPassword = true,
  loginUrl = '',
  locale = 'en',
  repoRoot = null,
}) {
  const tr = createTranslator(locale);

  // Get sender identity from settings
  const senderOverride = await getSenderIdentity(repoRoot);

  // Try custom template first
  const customResult = await trySendCustomTemplate({
    repoRoot,
    templateType: 'magicLink',
    locale,
    vars: {},
    actionUrl: magicLinkUrl,
    emailOpts: { to: recipientEmail, senderOverride },
  });
  if (customResult) return customResult;

  // Default behavior
  const subject = tr('email.magicLink.subject', 'Your sign-in link');

  const { htmlContent, textContent } = buildMagicLinkEmail({
    tr,
    magicLinkUrl,
    hasPassword,
    loginUrl,
  });

  return sendEmail({
    to: recipientEmail,
    subject,
    htmlContent,
    textContent,
    senderOverride,
  });
}
