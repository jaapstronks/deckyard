/**
 * Storage layer for user notifications.
 * Handles CRUD operations for in-app notifications.
 */

import { sql } from 'kysely';
import { getOrgId } from '../utils/context.js';
import { toStorageContext } from './scope.js';
import { nowIso, normalizeEmail } from '../utils/normalize.js';
import { withDbGuard } from './utils/db-guard.js';
import {
  resolveDisplayNames,
  toStoredActorIdentity,
  NO_DISPLAY_NAMES,
} from './display-identity.js';

// ============================================================
// CREATE
// ============================================================

/**
 * Create a notification.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {Object} data - Notification data
 * @param {string} data.userEmail - Recipient email
 * @param {string} data.notificationType - Type (share_received, comment_mention, etc.)
 * @param {string} data.title - Notification title
 * @param {string} [data.body] - Notification body
 * @param {string} [data.presentationId] - Related presentation ID
 * @param {string} [data.actorEmail] - Actor email (who triggered this)
 * @param {string} [data.actorName] - Actor name
 * @param {Object} [data.data] - Additional JSON data
 * @param {string} [data.actionUrl] - URL for the notification action
 * @returns {Promise<Object>} - Created notification
 */
export async function createNotification(scope, data) {
  toStorageContext(scope, 'createNotification');
  const userEmail = normalizeEmail(data?.userEmail);
  if (!userEmail) {
    return { ok: false, reason: 'invalid_email' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);

    const row = await db
      .insertInto('user_notifications')
      .values({
        organization_id: orgId,
        user_email: userEmail,
        notification_type: data.notificationType || 'general',
        title: data.title || '',
        body: data.body || null,
        presentation_id: data.presentationId || null,
        actor_email: data.actorEmail || null,
        actor_name: data.actorName || null,
        data: JSON.stringify(data.data || {}),
        action_url: data.actionUrl || null,
        is_read: false,
      })
      .returningAll()
      .executeTakeFirst();

    return {
      ok: true,
      notification: formatNotification(row, await actorDisplayNames([row])),
    };
  });
}

// ============================================================
// READ
// ============================================================

/**
 * List notifications for a user.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} userEmail - User's email
 * @param {Object} options - List options
 * @param {number} [options.limit=20] - Maximum results
 * @param {number} [options.offset=0] - Offset for pagination
 * @param {boolean} [options.unreadOnly=false] - Only return unread
 * @param {boolean} [options.archived=false] - true: only archived items;
 *   false (default): only unarchived (the inbox)
 * @param {string[]} [options.types] - Only these notification types
 * @returns {Promise<Array>} - List of notifications
 */
export async function listNotifications(scope, userEmail, options = {}) {
  toStorageContext(scope, 'listNotifications');
  const email = normalizeEmail(userEmail);
  if (!email) return [];

  return withDbGuard([], async (db) => {
    const orgId = getOrgId(scope);
    const limit = Math.min(Math.max(1, options.limit || 20), 100);
    const offset = Math.max(0, options.offset || 0);

    let qb = db
      .selectFrom('user_notifications')
      .selectAll()
      .where('user_email', '=', email)
      .where('organization_id', '=', orgId);

    if (options.unreadOnly) {
      qb = qb.where('is_read', '=', false);
    }

    // The inbox shows unarchived items; archived stays reachable via filter.
    if (options.archived === true) {
      qb = qb.where('archived_at', 'is not', null);
    } else {
      qb = qb.where('archived_at', 'is', null);
    }

    if (Array.isArray(options.types) && options.types.length > 0) {
      qb = qb.where('notification_type', 'in', options.types);
    }

    const rows = await qb
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    const lookup = await actorDisplayNames(rows);
    return rows.map((row) => formatNotification(row, lookup));
  });
}

/**
 * Get unread notification count for a user.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} userEmail - User's email
 * @returns {Promise<number>} - Unread count
 */
export async function getUnreadCount(scope, userEmail) {
  toStorageContext(scope, 'getUnreadCount');
  const email = normalizeEmail(userEmail);
  if (!email) return 0;

  return withDbGuard(0, async (db) => {
    const orgId = getOrgId(scope);

    const result = await db
      .selectFrom('user_notifications')
      .select(db.fn.count('id').as('count'))
      .where('user_email', '=', email)
      .where('organization_id', '=', orgId)
      .where('is_read', '=', false)
      // Archived = handled; it should not keep the badge lit.
      .where('archived_at', 'is', null)
      .executeTakeFirst();

    return parseInt(result?.count || '0', 10);
  });
}

// ============================================================
// UPDATE
// ============================================================

/**
 * Mark a notification as read.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} notificationId - Notification ID
 * @param {string} userEmail - User's email (for authorization)
 * @returns {Promise<Object>} - Result
 */
export async function markAsRead(scope, notificationId, userEmail) {
  toStorageContext(scope, 'markAsRead');
  const email = normalizeEmail(userEmail);
  if (!email || !notificationId) {
    return { ok: false, reason: 'invalid_params' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);

    const row = await db
      .updateTable('user_notifications')
      .set({
        is_read: true,
        read_at: nowIso(),
      })
      .where('id', '=', notificationId)
      .where('user_email', '=', email)
      .where('organization_id', '=', orgId)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    return {
      ok: true,
      notification: formatNotification(row, await actorDisplayNames([row])),
    };
  });
}

/**
 * Mark all notifications as read for a user.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} userEmail - User's email
 * @returns {Promise<Object>} - Result
 */
export async function markAllAsRead(scope, userEmail) {
  toStorageContext(scope, 'markAllAsRead');
  const email = normalizeEmail(userEmail);
  if (!email) {
    return { ok: false, reason: 'invalid_email' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);
    const now = nowIso();

    const result = await db
      .updateTable('user_notifications')
      .set({
        is_read: true,
        read_at: now,
      })
      .where('user_email', '=', email)
      .where('organization_id', '=', orgId)
      .where('is_read', '=', false)
      .execute();

    return {
      ok: true,
      updatedCount: Number(result[0]?.numUpdatedRows || 0),
    };
  });
}

/**
 * Archive one notification ("handled": out of the default inbox list).
 * Also marks it read - an archived item should not keep the badge lit.
 */
export async function archiveNotification(scope, notificationId, userEmail) {
  toStorageContext(scope, 'archiveNotification');
  const email = normalizeEmail(userEmail);
  if (!email || !notificationId) {
    return { ok: false, reason: 'invalid_params' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);
    const now = nowIso();

    const row = await db
      .updateTable('user_notifications')
      .set({ archived_at: now, is_read: true, read_at: now })
      .where('id', '=', notificationId)
      .where('user_email', '=', email)
      .where('organization_id', '=', orgId)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }
    return {
      ok: true,
      notification: formatNotification(row, await actorDisplayNames([row])),
    };
  });
}

/**
 * Archive all unarchived notifications for a user ("inbox zero").
 */
export async function archiveAllNotifications(scope, userEmail) {
  toStorageContext(scope, 'archiveAllNotifications');
  const email = normalizeEmail(userEmail);
  if (!email) {
    return { ok: false, reason: 'invalid_email' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);
    const now = nowIso();

    const result = await db
      .updateTable('user_notifications')
      .set({ archived_at: now, is_read: true, read_at: now })
      .where('user_email', '=', email)
      .where('organization_id', '=', orgId)
      .where('archived_at', 'is', null)
      .execute();

    return {
      ok: true,
      updatedCount: Number(result[0]?.numUpdatedRows || 0),
    };
  });
}

/**
 * Auto-archive a user's open comment-notifications for one thread
 * (phase 5, decision 4: replying in a thread means you handled it). New
 * activity in the thread simply creates a fresh unarchived item.
 *
 * Matches comment notifications whose stored data points at the thread:
 * top-level items carry the thread id as `commentId`, reply/mention items
 * as `parentId`.
 *
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} userEmail - Whose inbox to clean
 * @param {string} presentationId
 * @param {string} threadId - Top-level comment id of the thread
 */
export async function archiveThreadNotifications(
  scope,
  userEmail,
  presentationId,
  threadId,
) {
  toStorageContext(scope, 'archiveThreadNotifications');
  const email = normalizeEmail(userEmail);
  const tid = String(threadId || '').trim();
  const pid = String(presentationId || '').trim();
  if (!email || !tid || !pid) {
    return { ok: false, reason: 'invalid_params' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);
    const now = nowIso();

    const result = await db
      .updateTable('user_notifications')
      .set({ archived_at: now, is_read: true, read_at: now })
      .where('user_email', '=', email)
      .where('organization_id', '=', orgId)
      .where('presentation_id', '=', pid)
      .where('archived_at', 'is', null)
      .where('notification_type', 'in', [
        'comment_created',
        'comment_reply',
        'comment_mention',
      ])
      .where((eb) =>
        eb.or([
          eb(sql`data->>'commentId'`, '=', tid),
          eb(sql`data->>'parentId'`, '=', tid),
        ]),
      )
      .execute();

    return {
      ok: true,
      updatedCount: Number(result[0]?.numUpdatedRows || 0),
    };
  });
}

/**
 * Find an existing unread, unarchived `deck_activity` notification for one
 * (recipient, deck, actor) that is still inside the debounce window. Used by
 * the deck-activity coalescer: when found, the caller refreshes it (bumps the
 * count) instead of inserting a second row.
 *
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} userEmail - Recipient
 * @param {string} presentationId
 * @param {string|null} actorEmail - The editing user (already normalised)
 * @param {string} [sinceIso] - Only match rows created after this timestamp
 * @returns {Promise<Object|null>} The matching notification, or null.
 */
export async function findUnreadDeckActivityNotification(
  scope,
  userEmail,
  presentationId,
  actorEmail,
  sinceIso,
) {
  toStorageContext(scope, 'findUnreadDeckActivityNotification');
  const email = normalizeEmail(userEmail);
  const pid = String(presentationId || '').trim();
  const actor = normalizeEmail(actorEmail);
  if (!email || !pid) return null;

  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(scope);

    let qb = db
      .selectFrom('user_notifications')
      .selectAll()
      .where('user_email', '=', email)
      .where('organization_id', '=', orgId)
      .where('presentation_id', '=', pid)
      .where('notification_type', '=', 'deck_activity')
      .where('is_read', '=', false)
      .where('archived_at', 'is', null);

    qb = actor
      ? qb.where('actor_email', '=', actor)
      : qb.where('actor_email', 'is', null);
    if (sinceIso) qb = qb.where('created_at', '>', sinceIso);

    const row = await qb.orderBy('created_at', 'desc').executeTakeFirst();
    return row ? formatNotification(row, await actorDisplayNames([row])) : null;
  });
}

/**
 * Refresh a coalesced `deck_activity` notification: update its title/body/data
 * (the bumped count), move it back to the top (`created_at = now`) and make it
 * unread again. This is the "window extends on each edit" half of the
 * coalesce-on-write bundling.
 *
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} notificationId
 * @param {string} userEmail - Recipient (authorization)
 * @param {{title?: string, body?: string|null, data?: Object}} updates
 * @returns {Promise<Object>} Result with the updated notification.
 */
export async function refreshDeckActivityNotification(
  scope,
  notificationId,
  userEmail,
  updates,
) {
  toStorageContext(scope, 'refreshDeckActivityNotification');
  const email = normalizeEmail(userEmail);
  if (!email || !notificationId) {
    return { ok: false, reason: 'invalid_params' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);

    const set = {
      created_at: nowIso(),
      is_read: false,
      read_at: null,
      archived_at: null,
    };
    if (updates?.title != null) set.title = updates.title;
    if (updates?.body !== undefined) set.body = updates.body;
    if (updates?.data !== undefined)
      set.data = JSON.stringify(updates.data || {});

    const row = await db
      .updateTable('user_notifications')
      .set(set)
      .where('id', '=', notificationId)
      .where('user_email', '=', email)
      .where('organization_id', '=', orgId)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }
    return {
      ok: true,
      notification: formatNotification(row, await actorDisplayNames([row])),
    };
  });
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Format a database row into a notification object.
 * @param {Object} row - Database row
 * @returns {Object} - Formatted notification
 */
function formatNotification(row, lookup = NO_DISPLAY_NAMES) {
  let parsedData = {};
  if (row.data) {
    try {
      parsedData =
        typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    } catch {
      parsedData = {};
    }
  }

  return {
    id: row.id,
    userEmail: row.user_email,
    notificationType: row.notification_type,
    title: row.title,
    body: row.body,
    presentationId: row.presentation_id,
    // Who acted is display, never a decision (D22): the pair replaces the
    // `actorEmail` + `actorName` echo, which handed every recipient the
    // commenter's address so the client could look up a profile picture with
    // it. See server/storage/display-identity.js.
    actor: toStoredActorIdentity(row.actor_email, row.actor_name, lookup),
    data: parsedData,
    actionUrl: row.action_url,
    isRead: row.is_read,
    readAt: row.read_at,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at,
  };
}

/**
 * Resolve the display names a batch of notification rows needs.
 *
 * `user_notifications` stores no actor id (see storage/display-identity.js on
 * why a display stamp gets no id column), so the address is the lookup key and
 * the resolved identity's `id` stays null.
 *
 * @param {Array<Object>} rows - Raw `user_notifications` rows.
 * @returns {Promise<import('./display-identity.js').DisplayNameLookup>}
 */
async function actorDisplayNames(rows) {
  const stamps = (rows || [])
    .filter((row) => row?.actor_email)
    .map((row) => ({ email: row.actor_email }));
  if (!stamps.length) return NO_DISPLAY_NAMES;
  return resolveDisplayNames(stamps);
}
