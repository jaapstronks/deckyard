/**
 * Notification email templates
 * Comment notifications
 */

import { escapeHtml } from '../../../shared/slide-types/helpers.js';
import { EMAIL_STYLES } from './helpers.js';

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
  isMention,
  editUrl,
}) {
  const greeting = tr('email.common.greetingAnonymous', 'Hi there,');

  const actionText = isReply
    ? tr('email.commentNotification.action.reply', 'View conversation')
    : tr('email.commentNotification.action.new', 'View and reply');

  // Mention is the most specific flavor and wins over reply/created.
  const bodyText = isMention
    ? tr(
        'email.commentNotification.body.mention',
        'mentioned you in a comment on',
      )
    : isReply
      ? tr('email.commentNotification.body.reply', 'replied to your comment on')
      : tr(
          'email.commentNotification.body.new',
          'commented on your presentation',
        );

  const footerText = isMention
    ? tr(
        'email.commentNotification.footer.mention',
        'This notification was sent because you were mentioned in a comment.',
      )
    : isOwner
      ? tr(
          'email.commentNotification.footer.owner',
          'This notification was sent because you own this presentation.',
        )
      : tr(
          'email.commentNotification.footer.commenter',
          'This notification was sent because you commented on this presentation.',
        );

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
