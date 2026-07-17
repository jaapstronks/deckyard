/**
 * Comment notification service.
 * Handles sending notifications when comments are created.
 * Sends in-app notifications (bell + SSE), webhooks (for Slack/Discord)
 * and email notifications (via Brevo).
 */

import { readAppSettings, readUserSettings } from '../storage/settings.js';
import { maybeFireWebhook } from '../utils/webhooks.js';
import { sendCommentNotification } from '../integrations/brevo.js';
import { getRequestOrigin } from '../utils/request-url.js';
import { normalizeEmail } from '../utils/normalize.js';
import { createNotification } from '../storage/notifications.js';
import { broadcastToUser, NotificationEventTypes } from './notification-events.js';

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
 * @param {Object} [options.ctx] - Route context (org scoping for in-app notifications)
 */
export async function notifyCommentCreated(repoRoot, req, {
  presentation,
  comment,
  parentComment,
  actor,
  ctx,
}) {
  const ownerEmail = normalizeEmail(presentation?.ownerEmail);
  const commenterEmail = normalizeEmail(actor?.email);

  const recipients = buildRecipients({ presentation, parentComment, actor });
  if (recipients.size === 0) return;

  const settings = await readAppSettings(repoRoot);
  const origin = getRequestOrigin(req);
  const editUrl = origin && presentation?.id
    ? `${origin}/app/${presentation.id}`
    : null;

  // In-app notifications (bell + live SSE push)
  await createInAppNotifications({
    presentation,
    comment,
    parentComment,
    actor,
    ctx,
  });

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
 * Build the recipient set for a new comment: deck owner + parent-comment
 * author, deduplicated, excluding the commenter.
 */
function buildRecipients({ presentation, parentComment, actor }) {
  const recipients = new Set();
  const ownerEmail = normalizeEmail(presentation?.ownerEmail);
  if (ownerEmail) recipients.add(ownerEmail);
  if (parentComment?.authorEmail) {
    recipients.add(normalizeEmail(parentComment.authorEmail));
  }
  recipients.delete(normalizeEmail(actor?.email)); // Don't notify yourself
  return recipients;
}

/**
 * In-app-only variant for callers without an HTTP request (MCP stdio):
 * bell notifications + SSE, no webhook or email.
 *
 * @param {Object} options
 * @param {Object} options.presentation - The presentation object
 * @param {Object} options.comment - The created comment
 * @param {Object} [options.parentComment] - Parent comment if this is a reply
 * @param {Object} options.actor - The user/agent who created the comment
 * @param {Object} [options.ctx] - Context (org scoping)
 */
export async function notifyCommentCreatedInApp({
  presentation,
  comment,
  parentComment,
  actor,
  ctx,
}) {
  await createInAppNotifications({
    presentation,
    comment,
    parentComment,
    actor,
    ctx,
  });
}

/** Trim a comment body to a short notification excerpt. */
function commentExcerpt(body, maxLength = 140) {
  const s = String(body || '').replace(/\s+/g, ' ').trim();
  if (s.length <= maxLength) return s;
  return `${s.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Build the per-recipient in-app notification payloads for a new comment.
 * Pure: no storage or SSE. The deck owner gets `comment_created`, the
 * parent-comment author gets `comment_reply` (reply wins when someone is
 * both). Exported for tests.
 *
 * @returns {Array<Object>} createNotification-ready payloads
 */
export function buildInAppNotificationInputs({
  presentation,
  comment,
  parentComment,
  actor,
}) {
  const recipients = buildRecipients({ presentation, parentComment, actor });
  if (recipients.size === 0) return [];

  const actorName = actor?.name || actor?.email || 'Someone';
  const parentAuthorEmail = normalizeEmail(parentComment?.authorEmail);
  const presentationTitle = presentation?.title || 'Untitled';
  const excerpt = commentExcerpt(comment?.body);

  // Relative URL: the bell resolves it against the current origin. Anchored
  // to the slide via ?slideId= (honored by editor and viewer mode). Replies
  // carry no slideId of their own, so fall back to the parent's slide.
  const anchorSlideId = comment?.slideId || parentComment?.slideId || null;
  const slideAnchor = anchorSlideId
    ? `?slideId=${encodeURIComponent(anchorSlideId)}`
    : '';
  const actionUrl = presentation?.id
    ? `/app/${presentation.id}${slideAnchor}`
    : null;

  return [...recipients].map((recipientEmail) => {
    const isReplyToRecipient = !!parentAuthorEmail && recipientEmail === parentAuthorEmail;
    return {
      userEmail: recipientEmail,
      notificationType: isReplyToRecipient ? 'comment_reply' : 'comment_created',
      title: isReplyToRecipient
        ? `${actorName} replied to your comment`
        : `${actorName} commented on "${presentationTitle}"`,
      body: excerpt,
      presentationId: presentation?.id,
      actorEmail: actor?.email || null,
      actorName: actor?.name || null,
      actionUrl,
      data: {
        commentId: comment?.id,
        parentId: comment?.parentId || null,
        slideId: comment?.slideId || null,
        presentationTitle,
      },
    };
  });
}

/**
 * Create in-app notifications for a new comment and push them live over SSE.
 * Failures are logged, never thrown - the comment itself already exists.
 */
async function createInAppNotifications({
  presentation,
  comment,
  parentComment,
  actor,
  ctx,
}) {
  const inputs = buildInAppNotificationInputs({
    presentation,
    comment,
    parentComment,
    actor,
  });

  for (const input of inputs) {
    try {
      const notifResult = await createNotification(input, ctx);
      if (notifResult?.ok && notifResult.notification) {
        broadcastToUser(input.userEmail, NotificationEventTypes.NEW, notifResult.notification);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[comment-notifications] in-app notification failed to=${input.userEmail}:`, e?.message || e);
    }
  }
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