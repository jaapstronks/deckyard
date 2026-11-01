/**
 * Library-revision notifications: "a slide in your deck has a newer version"
 * (B904, D223).
 *
 * Inserting from the library copies the item and records where the copy came
 * from (`slide.libraryRef`). When the item's maker saves a new revision, the
 * owner of every live deck with an older linked copy gets one notification
 * per (deck, item): a second and third revision refresh the same unread row
 * instead of adding rows. The deck itself does not change; the owner decides
 * in the editor whether to update.
 *
 * Rules:
 *   - Only the deck owner is notified (brief § 4); editors see the notice on
 *     the slide in the editor.
 *   - The actor never notifies themselves.
 *   - Only an owner who may read the item hears about it: an organization-shelf
 *     item, or a personal item of their own. A ref is written by the deck's
 *     editor, so it is no proof of access.
 *   - A deck that already ignored this revision, or is at it, is skipped in
 *     the query (`listDecksBehindLibraryItem`).
 *
 * Fire-and-forget: never throws, logs failures, pushes the bell over SSE.
 */

import { normalizeEmail } from '../../shared/email.js';
import { listDecksBehindLibraryItem } from '../storage/slide-library-links.js';
import {
  createNotification,
  findUnreadLibraryUpdateNotification,
  refreshCoalescedNotification,
  getUnreadCount,
} from '../storage/notifications.js';
import {
  broadcastToUser,
  NotificationEventTypes,
} from './notification-events.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('library-revision');

export const LIBRARY_UPDATE_TYPE = 'library_update';

/**
 * Whether the deck owner may read the item, so may hear that it changed.
 * @param {{shelf?: string, ownerEmail?: string}} item
 * @param {string} ownerEmail - normalized
 * @returns {boolean}
 */
export function ownerMayReadItem(item, ownerEmail) {
  if (!ownerEmail) return false;
  if (item?.shelf === 'organization') return true;
  return (
    item?.shelf === 'personal' &&
    normalizeEmail(item?.ownerEmail) === ownerEmail
  );
}

/**
 * The notification payload for one (deck, item) pair. Pure; exported for
 * tests. English, like the other server-side notification copy.
 * @param {Object} options
 * @param {{presentationId: string, title: string, slideIds: string[]}} options.deck
 * @param {{id: string, name?: string, revision: number}} options.item
 * @param {{email?: string, name?: string}} options.actor
 * @returns {Object}
 */
export function buildLibraryUpdateNotificationInput({ deck, item, actor }) {
  const deckTitle = deck?.title || 'Untitled';
  const slideName = item?.name || 'a library slide';
  const who = actor?.name || actor?.email || 'Someone';
  const [firstSlide] = deck?.slideIds || [];
  const url = `/app/${deck.presentationId}`;
  return {
    notificationType: LIBRARY_UPDATE_TYPE,
    title: `${who} updated "${slideName}", which is in "${deckTitle}"`,
    body: null,
    presentationId: deck.presentationId,
    actorEmail: normalizeEmail(actor?.email) || null,
    actorName: actor?.name || null,
    actionUrl: firstSlide
      ? `${url}?slideId=${encodeURIComponent(firstSlide)}`
      : url,
    data: {
      itemId: item.id,
      itemName: item?.name || '',
      revision: item.revision,
      presentationTitle: deckTitle,
      slideIds: deck?.slideIds || [],
    },
  };
}

/**
 * Notify the owners of decks with an older linked copy of `item`.
 * @param {Object} options
 * @param {import('../storage/scope.js').StorageScope} options.scope
 * @param {Object} options.item - the item as saved (id, shelf, ownerEmail, name, revision)
 * @param {{email?: string, name?: string}} options.actor - who saved it
 * @returns {Promise<number>} notifications created or refreshed
 */
export async function notifyLibraryItemRevision({ scope, item, actor }) {
  let sent = 0;
  try {
    if (!item?.id || !Number.isInteger(item?.revision)) return 0;
    const actorEmail = normalizeEmail(actor?.email);
    const decks = await listDecksBehindLibraryItem(
      scope,
      item.id,
      item.revision,
    );
    for (const deck of decks) {
      const owner = normalizeEmail(deck.ownerEmail);
      if (!owner || owner === actorEmail) continue;
      if (!ownerMayReadItem(item, owner)) continue;
      try {
        const input = buildLibraryUpdateNotificationInput({
          deck,
          item,
          actor,
        });
        const existing = await findUnreadLibraryUpdateNotification(
          scope,
          owner,
          deck.presentationId,
          item.id,
        );
        const res = existing
          ? await refreshCoalescedNotification(scope, existing.id, owner, {
              title: input.title,
              body: input.body,
              data: input.data,
            })
          : await createNotification(scope, { ...input, userEmail: owner });
        const notification = res?.ok ? res.notification : null;
        if (!notification) continue;
        sent += 1;
        broadcastToUser(owner, NotificationEventTypes.NEW, notification);
        const unreadCount = await getUnreadCount(scope, owner);
        broadcastToUser(owner, NotificationEventTypes.COUNTS, { unreadCount });
      } catch (e) {
        log.warn(`notification failed to=${owner}:`, e?.message || e);
      }
    }
  } catch (e) {
    log.warn('notifyLibraryItemRevision error:', e?.message || e);
  }
  return sent;
}
