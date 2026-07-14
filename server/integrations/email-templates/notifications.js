/**
 * Notification email templates
 * Comment notifications, lead notifications
 */

import { escapeHtml } from '../../../shared/slide-types/helpers.js';
import { EMAIL_STYLES, emailButton } from './helpers.js';

// ============================================================
// COMMENT NOTIFICATION TEMPLATE
// ============================================================

export function buildCommentNotificationEmail({
  tr,
  commenterName,
  presTitle,
  commentBody,
  isReply,
  isOwner,
  editUrl,
}) {
  const greeting = tr('email.common.greetingAnonymous', 'Hi there,');

  const actionText = isReply
    ? tr('email.commentNotification.action.reply', 'View conversation')
    : tr('email.commentNotification.action.new', 'View and reply');

  const bodyText = isReply
    ? tr('email.commentNotification.body.reply', 'replied to your comment on')
    : tr('email.commentNotification.body.new', 'commented on your presentation');

  const footerText = isOwner
    ? tr('email.commentNotification.footer.owner', 'This notification was sent because you own this presentation.')
    : tr('email.commentNotification.footer.commenter', 'This notification was sent because you commented on this presentation.');

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="${EMAIL_STYLES.body}">
  <p>${escapeHtml(greeting)}</p>

  <p><strong>${escapeHtml(commenterName)}</strong> ${escapeHtml(bodyText)}
  <strong>${escapeHtml(presTitle)}</strong>:</p>

  <blockquote style="${EMAIL_STYLES.blockquote}">
    ${escapeHtml(commentBody)}
  </blockquote>

  ${editUrl ? `<p><a href="${escapeHtml(editUrl)}" style="color: #0066cc;">${escapeHtml(actionText)} &rarr;</a></p>` : ''}

  <hr style="${EMAIL_STYLES.hr}">
  <p style="${EMAIL_STYLES.muted}">
    ${escapeHtml(footerText)}
  </p>
</body>
</html>
`.trim();

  const textContent = `
${greeting}

${commenterName} ${bodyText} "${presTitle}":

"${commentBody}"

${editUrl ? `${actionText}: ${editUrl}` : ''}

---
${footerText}
`.trim();

  return { htmlContent, textContent };
}

// ============================================================
// LEAD NOTIFICATION TEMPLATE
// ============================================================

/**
 * Build a lead notification email.
 * @param {Object} options
 * @param {Object} [options.resolvedFields] - Pre-resolved template fields (from admin-customizable templates)
 * @param {string} [options.resolvedFields.greeting] - Greeting text
 * @param {string} [options.resolvedFields.body] - Body text
 * @param {string} [options.resolvedFields.buttonLabel] - Button label
 * @param {string} [options.resolvedFields.footer] - Footer text
 * @param {Function} [options.tr] - Translator function (used if resolvedFields not provided)
 * @param {string} options.presTitle - Presentation title
 * @param {string} options.leadName - Lead's name
 * @param {string} options.leadEmail - Lead's email
 * @param {string} options.submittedAt - Submission timestamp
 * @param {string} options.analyticsUrl - URL to view leads in analytics
 * @returns {{ htmlContent: string, textContent: string }}
 */
export function buildLeadNotificationEmail({
  resolvedFields = null,
  tr = null,
  presTitle,
  leadName,
  leadEmail,
  submittedAt,
  analyticsUrl,
}) {
  // Use resolved fields if provided (from admin-customizable templates),
  // otherwise fall back to i18n lookups (for backwards compatibility)
  let greeting, bodyText, buttonLabel, footerText;

  if (resolvedFields) {
    greeting = resolvedFields.greeting;
    bodyText = resolvedFields.body;
    buttonLabel = resolvedFields.buttonLabel;
    footerText = resolvedFields.footer;
  } else if (tr) {
    greeting = tr('email.common.greetingAnonymous', 'Hi there,');
    bodyText = tr('email.leadNotification.body', 'A new lead was captured from your presentation <strong>{presTitle}</strong>:', { presTitle });
    buttonLabel = tr('email.leadNotification.button', 'View All Leads');
    footerText = tr('email.leadNotification.footer', 'You received this notification because you have lead email notifications enabled.');
  } else {
    // Fallback defaults
    greeting = 'Hi there,';
    bodyText = `A new lead was captured from your presentation <strong>${escapeHtml(presTitle)}</strong>:`;
    buttonLabel = 'View All Leads';
    footerText = 'You received this notification because you have lead email notifications enabled.';
  }

  const formattedDate = submittedAt
    ? new Date(submittedAt).toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'Just now';

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="${EMAIL_STYLES.body}">
  <p>${escapeHtml(greeting)}</p>

  <p>${bodyText}</p>

  <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #f9f9f9; border-radius: 8px;">
    <tr>
      <td style="padding: 16px;">
        <div style="margin-bottom: 8px;">
          <strong style="color: #333;">${escapeHtml(leadName)}</strong>
        </div>
        <div style="color: #666; font-size: 14px;">
          <a href="mailto:${escapeHtml(leadEmail)}" style="color: #0066cc;">${escapeHtml(leadEmail)}</a>
        </div>
        <div style="color: #888; font-size: 12px; margin-top: 8px;">
          ${escapeHtml(formattedDate)}
        </div>
      </td>
    </tr>
  </table>

  ${analyticsUrl ? emailButton(analyticsUrl, buttonLabel) : ''}

  <hr style="${EMAIL_STYLES.hr}">
  <p style="${EMAIL_STYLES.muted}">
    ${escapeHtml(footerText)}
  </p>
</body>
</html>`.trim();

  const textContent = `
${greeting}

${bodyText.replace(/<[^>]*>/g, '')}

Name: ${leadName}
Email: ${leadEmail}
Submitted: ${formattedDate}

${analyticsUrl ? `${buttonLabel}: ${analyticsUrl}` : ''}

---
${footerText}
`.trim();

  return { htmlContent, textContent };
}
