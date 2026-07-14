/**
 * Digest email senders.
 */

import {
  buildWeeklyDigestEmail,
  buildTeamDigestEmail,
} from '../email-templates.js';
import { sendEmail, getSenderIdentity } from './core.js';

/**
 * Send a weekly digest email.
 * @param {Object} options
 * @param {string} [options.repoRoot] - Repository root for sender resolution
 */
export async function sendWeeklyDigestEmail({
  recipientEmail,
  recipientName,
  digest,
  dashboardUrl,
  preferencesUrl,
  repoRoot = null,
}) {
  // Get sender identity from settings
  const senderOverride = await getSenderIdentity(repoRoot);

  const { htmlContent, textContent } = buildWeeklyDigestEmail({
    digest,
    dashboardUrl,
    preferencesUrl,
  });

  return sendEmail({
    to: recipientEmail,
    toName: recipientName,
    subject: digest.subject,
    htmlContent,
    textContent,
    senderOverride,
  });
}

/**
 * Send a team weekly digest email (for admins).
 * @param {Object} options
 * @param {string} [options.repoRoot] - Repository root for sender resolution
 */
export async function sendTeamDigestEmail({
  recipientEmail,
  recipientName,
  digest,
  dashboardUrl,
  preferencesUrl,
  repoRoot = null,
}) {
  // Get sender identity from settings
  const senderOverride = await getSenderIdentity(repoRoot);

  const { htmlContent, textContent } = buildTeamDigestEmail({
    digest,
    dashboardUrl,
    preferencesUrl,
  });

  return sendEmail({
    to: recipientEmail,
    toName: recipientName,
    subject: digest.subject,
    htmlContent,
    textContent,
    senderOverride,
  });
}
