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
import { fireAndForget } from '../utils/fire-and-forget.js';
import { parseMentions, stripMentionMarkup } from '../../shared/comment-mentions.js';
import {
  createNotification,
  archiveThreadNotifications,
  getUnreadCount,
} from '../storage/notifications.js';
import { broadcastToUser, NotificationEventTypes } from './notification-events.js';
import { resolveCommentRecipients, REASON_TO_TYPE } from './comment-subscriptions.js';
import { getUserByEmail } from '../storage/users.js';

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

  // One place decides event → who: the subscription resolver (per-deck
  // override → user default → participating; mentions always deliver).
  // Every channel below consumes the same list.
  const recipients = await resolveCommentRecipients({
    repoRoot,
    presentation,
    comment,
    parentComment,
    actor,
    ctx,
  });
  const recipientEmails = new Set(recipients.map((r) => r.email));

  // The webhook is a channel-level integration (a shared Slack/Discord
  // channel): personal subscription levels must not silence it, so it
  // keeps the pre-subscription recipient set (owner + parent author +
  // mentions, minus the actor), gated only on slackEnabled below.
  const webhookRecipients = buildRecipients({ presentation, comment, parentComment, actor });

  // Your own reply archives your open inbox items for this thread — even
  // when nobody else is left to notify.
  await autoArchiveOnOwnReply({ presentation, comment, parentComment, actor, ctx });

  if (recipientEmails.size === 0 && webhookRecipients.size === 0) return;

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
    recipients,
    ctx,
  });

  // Fetch user preferences for all recipients (both channels), in parallel
  const recipientPrefs = new Map();
  await Promise.all(
    [...new Set([...recipientEmails, ...webhookRecipients])].map(async (email) => {
      const userSettings = await readUserSettings(repoRoot, email);
      recipientPrefs.set(email, userSettings?.notifications || {});
    })
  );

  // Fire Slack/Discord webhook
  await fireCommentWebhook(repoRoot, req, {
    settings,
    presentation,
    comment,
    parentComment,
    actor,
    ownerEmail,
    recipients: webhookRecipients,
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
 * author + mentioned users, deduplicated, excluding the commenter.
 */
function buildRecipients({ presentation, comment, parentComment, actor }) {
  const recipients = new Set();
  const ownerEmail = normalizeEmail(presentation?.ownerEmail);
  if (ownerEmail) recipients.add(ownerEmail);
  if (parentComment?.authorEmail) {
    recipients.add(normalizeEmail(parentComment.authorEmail));
  }
  for (const mention of commentMentions(comment)) {
    recipients.add(mention.email);
  }
  recipients.delete(normalizeEmail(actor?.email)); // Don't notify yourself
  return recipients;
}

/**
 * The mentioned emails of a comment (normalized set). Prefers the stored
 * `mentions` list (filled by the storage layer); falls back to parsing the
 * body for callers that pass a raw comment.
 */
function commentMentions(comment) {
  const list = Array.isArray(comment?.mentions) && comment.mentions.length
    ? comment.mentions
    : parseMentions(comment?.body);
  return list
    .map((m) => ({ ...m, email: normalizeEmail(m?.email) }))
    .filter((m) => m.email);
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
  const recipients = await resolveCommentRecipients({
    presentation,
    comment,
    parentComment,
    actor,
    ctx,
  });
  await createInAppNotifications({
    presentation,
    comment,
    parentComment,
    actor,
    recipients,
    ctx,
  });
  // Your own reply archives your open inbox items for this thread.
  await autoArchiveOnOwnReply({ presentation, comment, parentComment, actor, ctx });
}

/**
 * Notify users newly @mentioned by an edit. Diffs the stored mention list
 * against the pre-edit one, so re-saving an unchanged body never
 * re-notifies. Mentions always deliver (no subscription filtering), but
 * only to existing accounts — same gate as the create path.
 *
 * @param {string} repoRoot - Repository root path
 * @param {Object} req - HTTP request object (for building URLs)
 * @param {Object} options
 * @param {Object} options.presentation
 * @param {Object} options.comment - The updated comment (stored mentions)
 * @param {Array<{email: string}>} [options.previousMentions] - Mention list
 *   before the edit
 * @param {Object} [options.parentComment] - Parent if the comment is a reply
 * @param {Object} options.actor - The user who edited the comment
 * @param {Object} [options.ctx] - Route context (org scoping)
 */
export async function notifyMentionsAdded(repoRoot, req, {
  presentation,
  comment,
  previousMentions,
  parentComment,
  actor,
  ctx,
}) {
  const before = new Set(
    (Array.isArray(previousMentions) ? previousMentions : [])
      .map((m) => normalizeEmail(m?.email))
      .filter(Boolean)
  );
  const actorEmail = normalizeEmail(actor?.email);
  const added = commentMentions(comment)
    .map((m) => m.email)
    .filter((email) => !before.has(email) && email !== actorEmail);
  if (added.length === 0) return;

  const users = await Promise.all(added.map(async (email) => {
    try {
      return await getUserByEmail(email, ctx);
    } catch {
      return null;
    }
  }));
  const recipients = added
    .filter((_, i) => users[i])
    .map((email) => ({ email, reason: 'mention' }));
  if (recipients.length === 0) return;

  await createInAppNotifications({
    presentation,
    comment,
    parentComment,
    actor,
    recipients,
    ctx,
  });

  const settings = await readAppSettings(repoRoot);
  const origin = getRequestOrigin(req);
  const editUrl = origin && presentation?.id
    ? `${origin}/app/${presentation.id}`
    : null;
  const recipientPrefs = new Map();
  await Promise.all(recipients.map(async ({ email }) => {
    const userSettings = await readUserSettings(repoRoot, email);
    recipientPrefs.set(email, userSettings?.notifications || {});
  }));
  await sendCommentEmails({
    repoRoot,
    settings,
    presentation,
    comment,
    actor,
    parentComment,
    ownerEmail: normalizeEmail(presentation?.ownerEmail),
    recipients,
    recipientPrefs,
    commenterEmail: actorEmail,
    editUrl,
  });
}

/** Trim a comment body to a short notification excerpt (mentions as @Name). */
function commentExcerpt(body, maxLength = 140) {
  const s = stripMentionMarkup(body).replace(/\s+/g, ' ').trim();
  if (s.length <= maxLength) return s;
  return `${s.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Build the per-recipient in-app notification payloads for a new comment.
 * Pure: no storage or SSE. One notification per recipient, highest
 * specificity wins: mention > reply > created. Exported for tests.
 *
 * @param {Object} options
 * @param {Array<{email: string, reason: string}>} [options.recipients] -
 *   Subscription-resolved recipients. When omitted, falls back to the
 *   unfiltered candidate set (owner + parent author + mentions).
 * @returns {Array<Object>} createNotification-ready payloads
 */
export function buildInAppNotificationInputs({
  presentation,
  comment,
  parentComment,
  actor,
  recipients,
}) {
  let resolved = recipients;
  if (!Array.isArray(resolved)) {
    const mentionedEmails = new Set(commentMentions(comment).map((m) => m.email));
    const parentAuthorEmail = normalizeEmail(parentComment?.authorEmail);
    resolved = [...buildRecipients({ presentation, comment, parentComment, actor })].map(
      (email) => ({
        email,
        reason: mentionedEmails.has(email)
          ? 'mention'
          : parentAuthorEmail && email === parentAuthorEmail
            ? 'reply'
            : 'participating',
      })
    );
  }
  if (resolved.length === 0) return [];

  const actorName = actor?.name || actor?.email || 'Someone';
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

  return resolved.map(({ email: recipientEmail, reason }) => {
    const notificationType = REASON_TO_TYPE[reason] || 'comment_created';
    return {
      userEmail: recipientEmail,
      notificationType,
      title: notificationType === 'comment_mention'
        ? `${actorName} mentioned you in "${presentationTitle}"`
        : notificationType === 'comment_reply'
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
 * Auto-archive on own reply (phase 5, decision 4): answering a thread
 * means you handled it, so your open inbox items for that thread archive
 * themselves. The badge follows live via a counts push.
 */
async function autoArchiveOnOwnReply({ presentation, comment, parentComment, actor, ctx }) {
  const actorEmail = normalizeEmail(actor?.email);
  if (!actorEmail || !parentComment) return;
  const threadId = parentComment.parentId || parentComment.id;
  try {
    const result = await archiveThreadNotifications(
      actorEmail,
      presentation?.id,
      threadId,
      ctx
    );
    if (result?.ok && result.updatedCount > 0) {
      const unreadCount = await getUnreadCount(actorEmail, ctx);
      broadcastToUser(actorEmail, NotificationEventTypes.COUNTS, { unreadCount });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[comment-notifications] auto-archive failed:', e?.message || e);
  }
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
  recipients,
  ctx,
}) {
  const inputs = buildInAppNotificationInputs({
    presentation,
    comment,
    parentComment,
    actor,
    recipients,
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
          body: stripMentionMarkup(comment.body),
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

  for (const { email: recipientEmail, reason } of recipients) {
    // Channel master switch + per-event-type email preference
    const prefs = recipientPrefs.get(recipientEmail);
    if (prefs?.emailEnabled === false) continue;
    const notificationType = REASON_TO_TYPE[reason] || 'comment_created';
    if (prefs?.emailByType?.[notificationType] === false) continue;

    const isOwner = recipientEmail === ownerEmail;
    // Fire-and-forget: the response is already on its way, so a failed email
    // must only ever produce a log line. The .then() below handles the
    // expected { ok: false } path; fireAndForget backstops an actual rejection
    // (e.g. Brevo throwing) so it can't become a process-killing unhandled
    // rejection.
    fireAndForget(
      sendCommentNotification({
        recipientEmail,
        comment: { ...comment, body: stripMentionMarkup(comment?.body) },
        presentation,
        commenter: { email: commenterEmail, name: actor?.name },
        isReply: reason === 'reply',
        isOwner,
        isMention: reason === 'mention',
        editUrl,
        repoRoot,
      }).then((result) => {
        if (!result.ok) {
          // eslint-disable-next-line no-console
          console.warn(
            `[brevo] email failed to=${recipientEmail} error=${result.error || ''}`.trim()
          );
        }
      }),
      `comment notification email to=${recipientEmail}`
    );
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