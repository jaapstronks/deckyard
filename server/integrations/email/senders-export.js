/**
 * Export-related email senders.
 */

import { createTranslator } from '../../i18n/index.js';
import { buildExportReadyEmail } from '../email-templates.js';
import { sendEmail, getSenderIdentity } from './core.js';

/**
 * Send an export-ready notification email.
 * @param {Object} options
 * @param {string} options.recipientEmail - Recipient email
 * @param {string} [options.recipientName] - Recipient name
 * @param {Object} options.stats - Export stats
 * @param {string} options.downloadUrl - Download URL (relative, will be made absolute)
 * @param {string} [options.locale='en'] - Locale for translations
 * @param {string} [options.repoRoot] - Repository root for custom template and sender resolution
 */
export async function sendExportReadyNotification({
  recipientEmail,
  recipientName,
  stats,
  downloadUrl,
  locale = 'en',
  repoRoot = null,
}) {
  const tr = createTranslator(locale);

  // Get sender identity from settings
  const senderOverride = await getSenderIdentity(repoRoot);

  // The export-ready email uses a bespoke renderer (buildExportReadyEmail, with
  // a stats table) rather than the generic customizable template, so there is
  // no admin override path for it — it is intentionally absent from
  // TEMPLATE_METADATA.
  const subject = tr('email.exportReady.subject', 'Your data export is ready');

  const { htmlContent, textContent } = buildExportReadyEmail({
    tr,
    stats,
    downloadUrl,
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

