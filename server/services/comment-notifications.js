/**
 * Comment notification service.
 * Handles sending notifications when comments are created.
 * Sends both webhooks (for Slack/Discord) and email notifications (via Brevo).
 */

import { readAppSettings, readUserSettings } from '../storage/settings.js';
import { maybeFireWebhook } from '../utils/webhooks.js';
import { sendCommentNotification } from '../integrations/brevo.js';
import { getRequestOrigin } from '../utils/request-url.js';
import { normalizeEmail } from '../utils/normalize.js';

/**
 * Send notifications for a newly created comment.
 * Fires webhook (for Slack/Discord) and sends email via Brevo.
 * Respects user notification preferences.
 *
 * @param {string} repoRoot - Repository root path
 * @param {Object} req - HTTP request object (for building URLs)
 * @param {Object} options - Notification options
 * @param {Object} options.presentation - The presentation object
 * @param {Object} options.comment - The created comment
 * @param {Object} [options.parentComment] - Parent comment if this is a reply
 * @param {Object} options.actor - The user/guest who created the comment
 */
export async function notifyCommentCreated(repoRoot, req, {
  presentation,
  comment,
  parentComment,
  actor,
}) {
  const ownerEmail = normalizeEmail(presentation?.ownerEmail);
  const commenterEmail = normalizeEmail(actor?.email);

  // Build recipient list (deduplicated, excluding commenter)
  const recipients = new Set();
  if (ownerEmail) recipients.add(ownerEmail);
  if (parentComment?.authorEmail) {
    recipients.add(normalizeEmail(parentComment.authorEmail));
  }
  recipients.delete(commenterEmail); // Don't notify yourself

  if (recipients.size === 0) return;

  const settings = await readAppSettings(repoRoot);
  const origin = getRequestOrigin(req);
  const editUrl = origin && presentation?.id
    ? `${origin}/app/${presentation.id}`
    : null;

  // Fetch user preferences for all recipients
  const recipientPrefs = new Map();
  for (const email of recipients) {
    const userSettings = await readUserSettings(repoRoot, email);
    recipientPrefs.set(email, userSettings?.notifications || {});
  }

  // Fire Slack/Discord webhook
  await fireCommentWebhook(repoRoot, req, {
    settings,
    presentation,
    comment,
    parentComment,
    actor,
    ownerEmail,
    recipients,
    recipientPrefs,
  });

  // Send email notifications
  await sendCommentEmails({
    repoRoot,
    settings,
    presentation,
    comment,
    actor,
    parentComment,
    ownerEmail,
    recipients,
    recipientPrefs,
    commenterEmail,
    editUrl,
  });
}

/**
 * Fire webhook for comment creation (Slack/Discord channel notifications).
 */
async function fireCommentWebhook(repoRoot, req, {
  settings,
  presentation,
  comment,
  parentComment,
  actor,
  ownerEmail,
  recipients,
  recipientPrefs,
}) {
  // Filter recipients by their Slack/webhook preference
  const slackRecipients = [...recipients].filter((email) => {
    const prefs = recipientPrefs.get(email);
    return prefs?.slackEnabled !== false;
  });

  // Only fire if webhook URL is configured and there are recipients
  if (settings.webhooks?.commentCreatedUrl && slackRecipients.length > 0) {
    void maybeFireWebhook(repoRoot, req, {
      event: 'comment.created',
      pres: presentation,
      authedUser: actor,
      extra: {
        comment: {
          id: comment.id,
          body: comment.body,
          slideId: comment.slideId,
          parentId: comment.parentId,
          authorEmail: comment.authorEmail,
          authorName: comment.authorName,
        },
        isReply: !!parentComment,
        owner: { email: ownerEmail },
        recipients: slackRecipients,
      },
    });
  }
}

/**
 * Send email notifications for comment creation via Brevo.
 */
async function sendCommentEmails({
  repoRoot,
  settings,
  presentation,
  comment,
  actor,
  parentComment,
  ownerEmail,
  recipients,
  recipientPrefs,
  commenterEmail,
  editUrl,
}) {
  // Check if email notifications are enabled and configured
  if (!settings.notifications?.emailEnabled || !process.env.BREVO_API_KEY) {
    return;
  }

  for (const recipientEmail of recipients) {
    // Check if user has email notifications enabled
    const prefs = recipientPrefs.get(recipientEmail);
    if (prefs?.emailEnabled === false) continue;

    const isOwner = recipientEmail === ownerEmail;
    void sendCommentNotification({
      recipientEmail,
      comment,
      presentation,
      commenter: { email: commenterEmail, name: actor?.name },
      isReply: !!parentComment,
      isOwner,
      editUrl,
      repoRoot,
    }).then((result) => {
      if (!result.ok) {
        // eslint-disable-next-line no-console
        console.warn(
          `[brevo] email failed to=${recipientEmail} error=${result.error || ''}`.trim()
        );
      }
    });
  }
}

/**
 * Build notification data for a comment.
 * Useful for getting standardized notification payload.
 *
 * @param {Object} options
 * @param {Object} options.comment - The comment
 * @param {Object} options.presentation - The presentation
 * @param {Object} options.actor - The actor who performed the action
 * @returns {Object} Notification data
 */
export function buildCommentNotificationData({
  comment,
  presentation,
  actor,
}) {
  return {
    comment: {
      id: comment?.id,
      body: comment?.body,
      slideId: comment?.slideId,
      parentId: comment?.parentId,
      authorEmail: comment?.authorEmail,
      authorName: comment?.authorName,
      status: comment?.status,
    },
    presentation: {
      id: presentation?.id,
      title: presentation?.title,
      ownerEmail: presentation?.ownerEmail,
    },
    actor: {
      email: actor?.email,
      name: actor?.name,
    },
  };
}