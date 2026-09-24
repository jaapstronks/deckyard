/**
 * Digest email senders.
 *
 * Unlike the other senders these do not resolve the recipient's locale: a
 * digest is already written — its prose, subject and phrases — by the time it
 * reaches them, and names its language on `digest.locale`. The mail around it
 * is rendered in that same language, so content and chrome cannot disagree.
 * The digest job resolves the locale once, through `resolveRecipientLocale()`.
 */

import { createTranslator } from '../../i18n/index.js';
import {
  buildWeeklyDigestEmail,
  buildTeamDigestEmail,
} from '../email-templates/index.js';
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
    tr: digestTranslator(digest),
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
    tr: digestTranslator(digest),
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
 * A translator in the digest's own language. A digest without one is refused
 * rather than sent with English chrome around Dutch prose.
 * @param {Object} digest
 * @returns {Function}
 */
function digestTranslator(digest) {
  if (!digest?.locale) {
    throw new TypeError(
      'A digest must name its locale (see digest-generation)',
    );
  }
  return createTranslator(digest.locale);
}
