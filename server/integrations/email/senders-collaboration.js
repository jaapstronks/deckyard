/**
 * Collaboration-related email senders.
 */

import { createTranslator } from '../../i18n/index.js';
import {
  buildCommentNotificationEmail,
  buildGuestVerificationEmail,
  buildCollaboratorInviteEmail,
  buildGuestInvitationEmail,
} from '../email-templates.js';
import { sendEmail, getSenderIdentity } from './core.js';
import { trySendCustomTemplate } from './template-builder.js';

/**
 * Send a comment notification email.
 * @param {Object} options
 * @param {string} [options.repoRoot] - Repository root for custom template and sender resolution
 */
export async function sendCommentNotification({
  recipientEmail,
  recipientName,
  comment,
  presentation,
  commenter,
  isReply,
  isOwner,
  isMention = false,
  editUrl,
  locale = 'en',
  repoRoot = null,
}) {
  const tr = createTranslator(locale);
  const commenterName = commenter?.name || commenter?.email || 'Someone';
  const presTitle = presentation?.title || 'Untitled presentation';
  const commentBody = comment?.body || '';

  // Get sender identity from settings
  const senderOverride = await getSenderIdentity(repoRoot);

  // Try custom template first
  const customResult = await trySendCustomTemplate({
    repoRoot,
    templateType: 'commentNotification',
    locale,
    vars: { commenterName, presTitle, commentBody },
    actionUrl: editUrl,
    emailOpts: { to: recipientEmail, toName: recipientName, senderOverride },
  });
  if (customResult) return customResult;

  // Default behavior; mention is the most specific flavor and wins.
  const subject = isMention
    ? tr('email.commentNotification.subject.mention', '{commenterName} mentioned you on "{presTitle}"', { commenterName, presTitle })
    : isReply
      ? tr('email.commentNotification.subject.reply', '{commenterName} replied to your comment', { commenterName })
      : tr('email.commentNotification.subject.new', 'New comment on "{presTitle}"', { presTitle });

  const { htmlContent, textContent } = buildCommentNotificationEmail({
    tr,
    commenterName,
    presTitle,
    commentBody,
    isReply,
    isOwner,
    isMention,
    editUrl,
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

/**
 * Send a guest verification email for share link access.
 * @param {Object} options
 * @param {string} [options.repoRoot] - Repository root for custom template and sender resolution
 */
export async function sendGuestVerificationEmail({
  recipientEmail,
  recipientName,
  presentationTitle,
  verificationUrl,
  expiresAt,
  locale = 'en',
  repoRoot = null,
}) {
  const tr = createTranslator(locale);
  const name = recipientName || 'there';
  const presTitle = presentationTitle || 'a presentation';

  // Get sender identity from settings
  const senderOverride = await getSenderIdentity(repoRoot);

  // Try custom template first
  const customResult = await trySendCustomTemplate({
    repoRoot,
    templateType: 'guestVerification',
    locale,
    vars: { name, presTitle },
    actionUrl: verificationUrl,
    emailOpts: { to: recipientEmail, toName: recipientName, senderOverride },
  });
  if (customResult) return customResult;

  // Default behavior
  const subject = tr('email.guestVerification.subject', 'Verify your email to comment on "{presTitle}"', { presTitle });

  const { htmlContent, textContent } = buildGuestVerificationEmail({
    tr,
    name,
    presTitle,
    verificationUrl,
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

/**
 * Send a collaborator invitation email.
 * @param {Object} options
 * @param {string} [options.repoRoot] - Repository root for custom template and sender resolution
 */
export async function sendCollaboratorInviteEmail({
  recipientEmail,
  recipientName,
  presentationTitle,
  inviterName,
  permission,
  editUrl,
  locale = 'en',
  repoRoot = null,
}) {
  const tr = createTranslator(locale);
  const name = recipientName || 'there';
  const presTitle = presentationTitle || 'a presentation';
  const inviter = inviterName || 'Someone';

  // Get sender identity from settings
  const senderOverride = await getSenderIdentity(repoRoot);

  // Permission text mapping
  const permissionTextMap = {
    view: tr('email.collaboratorInvite.permission.view', 'view'),
    comment: tr('email.collaboratorInvite.permission.comment', 'view and comment on'),
    edit: tr('email.collaboratorInvite.permission.edit', 'edit'),
  };
  const permissionText = permissionTextMap[permission] || 'access';

  const accessLevelMap = {
    view: tr('email.collaboratorInvite.accessLevel.view', 'view access'),
    comment: tr('email.collaboratorInvite.accessLevel.comment', 'commenting access'),
    edit: tr('email.collaboratorInvite.accessLevel.edit', 'full editing access'),
  };
  const accessLevel = accessLevelMap[permission] || accessLevelMap.view;

  // Try custom template first
  const customResult = await trySendCustomTemplate({
    repoRoot,
    templateType: 'collaboratorInvite',
    locale,
    vars: { name, inviter, presTitle, permission: permissionText, accessLevel },
    actionUrl: editUrl,
    emailOpts: { to: recipientEmail, toName: recipientName, senderOverride },
  });
  if (customResult) return customResult;

  // Default behavior
  const subject = tr('email.collaboratorInvite.subject', '{inviter} shared "{presTitle}" with you', { inviter, presTitle });

  const { htmlContent, textContent } = buildCollaboratorInviteEmail({
    tr,
    name,
    presTitle,
    inviter,
    permission,
    editUrl,
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

/**
 * Send a guest invitation email for pre-registered share link guests.
 * @param {Object} options
 * @param {string} [options.repoRoot] - Repository root for custom template and sender resolution
 */
export async function sendGuestInvitationEmail({
  recipientEmail,
  recipientName,
  presentationTitle,
  shareUrl,
  inviterName,
  locale = 'en',
  repoRoot = null,
}) {
  const tr = createTranslator(locale);
  const name = recipientName || 'there';
  const presTitle = presentationTitle || 'a presentation';
  const inviter = inviterName || 'Someone';

  // Get sender identity from settings
  const senderOverride = await getSenderIdentity(repoRoot);

  // Try custom template first
  const customResult = await trySendCustomTemplate({
    repoRoot,
    templateType: 'guestInvitation',
    locale,
    vars: { name, inviter, presTitle },
    actionUrl: shareUrl,
    emailOpts: { to: recipientEmail, toName: recipientName, senderOverride },
  });
  if (customResult) return customResult;

  // Default behavior
  const subject = tr('email.guestInvitation.subject', '{inviter} invited you to view "{presTitle}"', { inviter, presTitle });

  const { htmlContent, textContent } = buildGuestInvitationEmail({
    tr,
    name,
    presTitle,
    inviter,
    shareUrl,
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
