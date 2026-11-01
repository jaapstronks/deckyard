/**
 * The thread on a shared library item (B906, D369): how someone who uses a
 * colleague's library slide reaches its maker.
 *
 * Who may do what:
 *
 *   - **Read** the thread: whoever may read the item, which is every member of
 *     the organization for an item on the organization shelf. A personal item
 *     has no thread (it has one reader, its owner), and an item in another
 *     organization or a missing one answers 404, so the thread leaks nothing
 *     the item would not.
 *   - **Write** a message: the same readers, where the instance shares at all
 *     (the sandbox declares sharing off, D181), on an item that is not in the
 *     trash.
 *   - **Delete** a message: its author by `users.id`, or an admin. The
 *     response stamps the verdict per message (`canDelete`), so no client
 *     derives it.
 *
 * What happens after a write: the maker and everyone who wrote in the thread
 * before get an in-app notification (`library_comment`), the writer never
 * notifies themselves. Fire-and-forget; a failed notification never fails the
 * write.
 *
 * Failures are thrown as `AppError`s (D254); the route's error handler renders
 * them.
 *
 * @module server/services/library-item-comments
 */

import { getOrganizationLibraryItem } from '../storage/slide-library.js';
import {
  createLibraryThreadMessage,
  deleteLibraryThreadMessage,
  getLibraryThreadMessage,
  listLibraryThread,
  listLibraryThreadRecipients,
} from '../storage/slide-library-comments.js';
import {
  createNotification,
  getUnreadCount,
} from '../storage/notifications.js';
import {
  broadcastToUser,
  NotificationEventTypes,
} from './notification-events.js';
import { commentText } from './comments.js';
import { assertSharingEnabled } from '../sandbox/sharing.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../utils/errors.js';
import { normalizeEmail } from '../../shared/email.js';
import { matchesIdentity } from '../../shared/identity-match.js';
import { fireAndForget } from '../utils/fire-and-forget.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('library-thread');

export const LIBRARY_COMMENT_TYPE = 'library_comment';

/** How much of a message the notification quotes. */
const EXCERPT_LENGTH = 140;

/**
 * The item whose thread the actor asks for, when they may read it.
 * @param {import('../storage/scope.js').StorageScope} scope
 * @param {object} actor - The signed-in user
 * @param {string} itemId
 * @returns {Promise<object>}
 * @throws {NotFoundError}
 */
async function readableItem(scope, actor, itemId) {
  const item = await getOrganizationLibraryItem(scope, itemId, {
    userEmail: normalizeEmail(actor?.email),
  });
  if (!item) throw new NotFoundError('Library item not found');
  return item;
}

/**
 * May the actor delete this message: its author, or an admin.
 * @param {object} actor
 * @param {{authorUserId?: string|null, author?: {id?: string|null}|null}} message
 * @returns {boolean}
 */
export function canDeleteLibraryThreadMessage(actor, message) {
  if (actor?.isAdmin) return true;
  const userId = message?.authorUserId ?? message?.author?.id ?? null;
  return matchesIdentity(actor, { userId });
}

/**
 * The thread on an item the actor may read, each message stamped with
 * whether the actor may delete it.
 * @param {import('../storage/scope.js').StorageScope} scope
 * @param {object} actor
 * @param {string} itemId
 * @returns {Promise<Array<object>>}
 * @throws {NotFoundError}
 */
export async function listLibraryItemThread(scope, actor, itemId) {
  const item = await readableItem(scope, actor, itemId);
  const messages = await listLibraryThread(scope, item.id);
  return messages.map((message) => ({
    ...message,
    canDelete: canDeleteLibraryThreadMessage(actor, message),
  }));
}

/**
 * Write a message on an item's thread and notify its maker and earlier
 * writers.
 * @param {import('../storage/scope.js').StorageScope} scope
 * @param {object} actor
 * @param {{itemId: string, body: *}} input
 * @returns {Promise<object>} the message, stamped like a listed one
 * @throws {import('../utils/errors.js').AppError}
 */
export async function postLibraryItemMessage(scope, actor, { itemId, body }) {
  const item = await readableItem(scope, actor, itemId);
  assertSharingEnabled();
  if (item.trashedAt) {
    throw new ConflictError('This library item is in the trash');
  }
  const text = commentText(body);
  const message = await createLibraryThreadMessage(scope, item.id, {
    authorUserId: actor?.id || null,
    authorEmail: actor?.email,
    authorName: actor?.name || null,
    body: text,
  });
  fireAndForget(
    notifyLibraryThread({ scope, item, message, actor }),
    'library thread notifications',
  );
  return { ...message, canDelete: true };
}

/**
 * Delete a message from an item's thread: its author or an admin.
 * @param {import('../storage/scope.js').StorageScope} scope
 * @param {object} actor
 * @param {{itemId: string, messageId: string}} input
 * @returns {Promise<void>}
 * @throws {import('../utils/errors.js').AppError}
 */
export async function deleteLibraryItemMessage(
  scope,
  actor,
  { itemId, messageId },
) {
  const item = await readableItem(scope, actor, itemId);
  const message = await getLibraryThreadMessage(scope, item.id, messageId);
  if (!message) throw new NotFoundError('Message not found');
  if (!canDeleteLibraryThreadMessage(actor, message)) {
    throw new ForbiddenError();
  }
  await deleteLibraryThreadMessage(scope, item.id, message.id);
}

/**
 * The notification payload for one recipient. Pure; exported for tests.
 * English, like the other server-side notification copy.
 * @param {Object} options
 * @param {{id: string, name?: string}} options.item
 * @param {{id: string, body: string}} options.message
 * @param {{email?: string, name?: string}} options.actor
 * @returns {Object}
 */
export function buildLibraryCommentNotificationInput({ item, message, actor }) {
  const who = actor?.name || actor?.email || 'Someone';
  const slideName = item?.name || 'a library slide';
  const text = String(message?.body || '');
  return {
    notificationType: LIBRARY_COMMENT_TYPE,
    title: `${who} commented on "${slideName}" in the slide library`,
    body:
      text.length > EXCERPT_LENGTH
        ? `${text.slice(0, EXCERPT_LENGTH - 1)}…`
        : text,
    presentationId: null,
    actorEmail: normalizeEmail(actor?.email) || null,
    actorName: actor?.name || null,
    actionUrl: `/app/slide-library/organization/${encodeURIComponent(item.id)}`,
    data: {
      itemId: item.id,
      itemName: item?.name || '',
      messageId: message?.id || null,
    },
  };
}

/**
 * Notify the item's maker and earlier writers of a new message. Every
 * recipient may read the item: it is on the organization shelf, which every
 * member reads.
 * @param {Object} options
 * @returns {Promise<number>} notifications created
 */
export async function notifyLibraryThread({ scope, item, message, actor }) {
  let sent = 0;
  try {
    const actorEmail = normalizeEmail(actor?.email);
    const recipients = await listLibraryThreadRecipients(scope, item.id);
    const input = buildLibraryCommentNotificationInput({
      item,
      message,
      actor,
    });
    for (const email of recipients) {
      if (email === actorEmail) continue;
      try {
        const res = await createNotification(scope, {
          ...input,
          userEmail: email,
        });
        const notification = res?.ok ? res.notification : null;
        if (!notification) continue;
        sent += 1;
        broadcastToUser(email, NotificationEventTypes.NEW, notification);
        const unreadCount = await getUnreadCount(scope, email);
        broadcastToUser(email, NotificationEventTypes.COUNTS, { unreadCount });
      } catch (e) {
        log.warn(`notification failed to=${email}:`, e?.message || e);
      }
    }
  } catch (e) {
    log.warn('notifyLibraryThread error:', e?.message || e);
  }
  return sent;
}
