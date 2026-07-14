/**
 * Service for handling access attempt notifications.
 * Notifies authors when someone tries to access their revoked content.
 */

import {
  logAccessAttempt,
  shouldNotifyAuthor,
  markAuthorNotified,
  ACCESS_TYPES,
} from '../storage/access-attempts.js';
import { createNotification } from '../storage/notifications.js';
import { broadcastToUser, NotificationEventTypes } from './notification-events.js';

/**
 * Notify author of an access attempt to revoked content.
 * Rate limited to 1 notification per accessor per 24h.
 *
 * @param {Object} options - Notification options
 * @param {string} options.presentationId - Presentation ID
 * @param {string} options.presentationTitle - Presentation title
 * @param {string} options.authorEmail - Author's email
 * @param {string} options.accessType - Type of access (share_link, collaborator, trashed)
 * @param {string} [options.accessReferenceId] - Reference ID (e.g., share link ID)
 * @param {string} [options.accessorEmail] - Accessor's email (if logged in)
 * @param {string} [options.accessorIp] - Accessor's IP address
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result
 */
export async function notifyAuthorOfAccessAttempt({
  presentationId,
  presentationTitle,
  authorEmail,
  accessType,
  accessReferenceId,
  accessorEmail,
  accessorIp,
  ctx,
}) {
  try {
    // 1. Log the access attempt
    const logResult = await logAccessAttempt(
      {
        presentationId,
        accessType,
        accessReferenceId,
        accessorEmail,
        accessorIp,
      },
      ctx
    );

    if (!logResult.ok) {
      return { ok: false, reason: logResult.reason };
    }

    // 2. Check rate limit (1 notification per accessor per 24h)
    const shouldNotify = await shouldNotifyAuthor(
      presentationId,
      accessorEmail,
      accessorIp,
      ctx
    );

    if (!shouldNotify) {
      return { ok: true, notified: false, reason: 'rate_limited' };
    }

    // 3. Build notification content
    const accessorDisplay = accessorEmail || 'Someone';
    const accessTypeLabel = getAccessTypeLabel(accessType);

    const notificationTitle = `${accessorDisplay} tried to access revoked content`;
    const notificationBody = `Attempted to access "${presentationTitle}" via ${accessTypeLabel}.`;

    // 4. Create in-app notification for author (no email)
    const notifResult = await createNotification(
      {
        userEmail: authorEmail,
        notificationType: 'access_attempt',
        title: notificationTitle,
        body: notificationBody,
        presentationId,
        actorEmail: accessorEmail || null,
        data: {
          accessType,
          accessorEmail,
          accessorIp,
          presentationTitle,
        },
      },
      ctx
    );

    if (!notifResult.ok) {
      // Log but don't fail - the access attempt is already logged
      console.warn('[access-notifications] Failed to create notification:', notifResult.reason);
      return { ok: true, notified: false, reason: 'notification_failed' };
    }

    // 5. Mark the attempt as having notified the author
    await markAuthorNotified(logResult.attempt.id, ctx);

    // 6. Broadcast via SSE for real-time bell icon update
    if (notifResult.notification) {
      broadcastToUser(authorEmail, NotificationEventTypes.NEW, notifResult.notification);
    }

    return { ok: true, notified: true };
  } catch (error) {
    console.error('[access-notifications] Error notifying author:', error);
    return { ok: false, reason: 'internal_error' };
  }
}

/**
 * Get human-readable label for access type.
 * @param {string} accessType - Access type
 * @returns {string} - Human-readable label
 */
function getAccessTypeLabel(accessType) {
  const labels = {
    [ACCESS_TYPES.SHARE_LINK]: 'a revoked share link',
    [ACCESS_TYPES.COLLABORATOR]: 'removed collaborator access',
    [ACCESS_TYPES.TRASHED]: 'a trashed presentation',
  };
  return labels[accessType] || 'revoked access';
}

export { ACCESS_TYPES };
