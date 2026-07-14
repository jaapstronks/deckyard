/**
 * Export-ready email template.
 */

import { escapeHtml } from '../../../shared/slide-types/helpers.js';
import { EMAIL_STYLES, emailButton, formatBytes } from './helpers.js';

/**
 * Build the export-ready notification email.
 * @param {Object} options
 * @param {Function} options.tr - Translator function
 * @param {Object} options.stats - Export stats (presentations, totalSizeBytes, etc.)
 * @param {string} options.downloadUrl - URL to download the export
 * @returns {{ htmlContent: string, textContent: string }}
 */
export function buildExportReadyEmail({ tr, stats, downloadUrl }) {
  const greeting = tr('email.common.greetingAnonymous', 'Hi there,');
  const presCount = stats?.presentations || 0;

  const bodyText = tr(
    'email.exportReady.body',
    'Your data export is ready to download. {count} presentation{s} have been exported.',
    { count: presCount, s: presCount !== 1 ? 's' : '' }
  );

  const sizeText = stats?.totalSizeBytes
    ? tr('email.exportReady.size', 'File size: {size}', { size: formatBytes(stats.totalSizeBytes) })
    : '';

  const buttonLabel = tr('email.exportReady.button', 'Download backup');

  const footerText = tr(
    'email.exportReady.footer',
    'This link will expire in 2 hours. If the link has expired, you can start a new export from your settings.'
  );

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="${EMAIL_STYLES.body}">
  <p>${escapeHtml(greeting)}</p>

  <p>${escapeHtml(bodyText)}</p>

  ${sizeText ? `<p style="${EMAIL_STYLES.mutedSmall}">${escapeHtml(sizeText)}</p>` : ''}

  ${downloadUrl ? emailButton(downloadUrl, buttonLabel) : ''}

  <hr style="${EMAIL_STYLES.hr}">
  <p style="${EMAIL_STYLES.muted}">
    ${escapeHtml(footerText)}
  </p>
</body>
</html>`.trim();

  const textContent = `
${greeting}

${bodyText}

${sizeText}

${downloadUrl ? `${buttonLabel}: ${downloadUrl}` : ''}

---
${footerText}
`.trim();

  return { htmlContent, textContent };
}

