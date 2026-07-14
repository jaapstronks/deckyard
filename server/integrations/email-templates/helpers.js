/**
 * Email Template Utilities
 * Shared styles and template helpers for transactional emails
 */

import { escapeHtml } from '../../../shared/slide-types/helpers.js';

// ============================================================
// STYLES
// ============================================================

export const EMAIL_STYLES = {
  body: 'font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; line-height: 1.5; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;',
  button: 'display: inline-block; background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: 500;',
  buttonAlt: 'display: inline-block; background-color: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 500; font-size: 16px;',
  hr: 'border: none; border-top: 1px solid #eee; margin: 24px 0;',
  muted: 'font-size: 12px; color: #888;',
  mutedSmall: 'color: #666; font-size: 14px;',
  blockquote: 'border-left: 3px solid #ccc; padding-left: 12px; margin: 16px 0; color: #555;',
};

// ============================================================
// TEMPLATE HELPERS
// ============================================================

/**
 * Generate an HTML email button.
 * @param {string} url - Button URL
 * @param {string} label - Button label
 * @param {object} [options]
 * @param {boolean} [options.alt] - Use alternate (indigo) button style
 * @returns {string} HTML string
 */
export function emailButton(url, label, { alt = false } = {}) {
  const style = alt ? EMAIL_STYLES.buttonAlt : EMAIL_STYLES.button;
  return `<p style="margin: 24px 0;">
    <a href="${escapeHtml(url)}" style="${style}">
      ${escapeHtml(label)}
    </a>
  </p>`;
}

/**
 * Wrap email content in the standard HTML template.
 * @param {object} options
 * @param {string} options.greeting - Greeting line (e.g., "Hi there,")
 * @param {string} options.body - Main HTML content (already escaped where needed)
 * @param {string} [options.footer] - Footer HTML content (already escaped where needed)
 * @returns {string} Complete HTML email
 */
export function emailWrapper({ greeting, body, footer = '' }) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="${EMAIL_STYLES.body}">
  <p>${escapeHtml(greeting)}</p>

  ${body}

  <hr style="${EMAIL_STYLES.hr}">
  <p style="${EMAIL_STYLES.muted}">
    ${footer}
  </p>
</body>
</html>`.trim();
}

/**
 * Format a byte count as a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Generate a "trouble clicking?" footer with the URL.
 * @param {string} url - The URL to show
 * @param {Function} [tr] - Optional translator function
 * @param {Function} [defaultT] - Default translator function
 * @returns {string} HTML string
 */
export function troubleClickingFooter(url, tr, defaultT) {
  const translate = tr || defaultT || ((key, fallback) => fallback);
  const text = translate('email.common.troubleClicking', "If you're having trouble clicking the button, copy and paste this URL into your browser:");
  return `${text}<br>
    <span style="word-break: break-all;">${escapeHtml(url)}</span>`;
}
