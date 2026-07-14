/**
 * Export-related email senders.
 */

import { createTranslator } from '../../i18n/index.js';
import { buildExportReadyEmail } from '../email-templates.js';
import { formatBytes } from '../email-templates/helpers.js';
import { sendEmail, getSenderIdentity } from './core.js';
import { trySendCustomTemplate } from './template-builder.js';

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

  // Try custom template first
  const customResult = await trySendCustomTemplate({
    repoRoot,
    templateType: 'exportReady',
    locale,
    vars: {
      presentations: String(stats?.presentations || 0),
      size: formatBytes(stats?.totalSizeBytes || 0),
    },
    actionUrl: downloadUrl,
    emailOpts: { to: recipientEmail, toName: recipientName, senderOverride },
  });
  if (customResult) return customResult;

  // Default behavior
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

