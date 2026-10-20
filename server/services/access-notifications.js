/**
 * Service for handling access attempt notifications.
 * Notifies authors when someone tries to access their revoked content.
 */

import {
  logAccessAttempt,
  shouldNotifyAuthor,
  ACCESS_TYPES,
} from '../storage/access-attempts.js';
import { createNotification } from '../storage/notifications.js';
import {
  broadcastToUser,
  NotificationEventTypes,
} from './notification-events.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('access-notifications');

/**
 * Notify author of an access attempt to revoked content.
 * Rate limited to 1 notification per accessor per 24h.
 *
 * Only a notified attempt leaves a record (B785): the deduplication lookup
 * runs first, and an attempt it suppresses is not written anywhere, so no IP
 * is stored for an attempt nobody is told about. The notification itself
 * carries no accessor IP; the IP lives in the attempt record alone, for the
 * window the lookup reads.
 *
 * @param {Object} options - Notification options
 * @param {string} options.presentationId - Presentation ID
 * @param {string} options.presentationTitle - Presentation title
 * @param {string} options.authorEmail - Author's email
 * @param {string} options.accessType - Type of access (share_link, collaborator, trashed)
 * @param {string} [options.accessReferenceId] - Reference ID (e.g., share link ID)
 * @param {string} [options.accessorEmail] - Accessor's email (if logged in)
 * @param {string} [options.accessorIp] - Accessor's IP address
 * @param {import('../storage/scope.js').StorageScope} scope - Storage scope for the organization this access belongs to
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
  scope,
}) {
  try {
    // 1. Check rate limit (1 notification per accessor per 24h). A suppressed
    //    attempt is not recorded.
    const shouldNotify = await shouldNotifyAuthor(
      scope,
      presentationId,
      accessorEmail,
      accessorIp,
    );

    if (!shouldNotify) {
      return { ok: true, notified: false, reason: 'rate_limited' };
    }

    // 2. Build notification content
    const accessorDisplay = accessorEmail || 'Someone';
    const accessTypeLabel = getAccessTypeLabel(accessType);

    const notificationTitle = `${accessorDisplay} tried to access revoked content`;
    const notificationBody = `Attempted to access "${presentationTitle}" via ${accessTypeLabel}.`;

    // 3. Create in-app notification for author (no email, no accessor IP)
    const notifResult = await createNotification(scope, {
      userEmail: authorEmail,
      notificationType: 'access_attempt',
      title: notificationTitle,
      body: notificationBody,
      presentationId,
      actorEmail: accessorEmail || null,
      data: {
        accessType,
        accessorEmail,
        presentationTitle,
      },
    });

    if (!notifResult.ok) {
      // Nothing is recorded: the next attempt tries again.
      log.warn('Failed to create notification:', notifResult.reason);
      return { ok: true, notified: false, reason: 'notification_failed' };
    }

    // 4. Record the notified attempt, which is what deduplicates the next one.
    const logResult = await logAccessAttempt(scope, {
      presentationId,
      accessType,
      accessReferenceId,
      accessorEmail,
      accessorIp,
    });
    if (!logResult.ok) {
      log.warn('Failed to record notified attempt:', logResult.reason);
    }

    // 5. Broadcast via SSE for real-time bell icon update
    if (notifResult.notification) {
      broadcastToUser(
        authorEmail,
        NotificationEventTypes.NEW,
        notifResult.notification,
      );
    }

    return { ok: true, notified: true };
  } catch (error) {
    log.error('Error notifying author:', error);
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
