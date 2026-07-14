/**
 * Storage layer for user notifications.
 * Handles CRUD operations for in-app notifications.
 */

import { getOrgId } from '../utils/context.js';
import { nowIso, normalizeEmail } from '../utils/normalize.js';
import { withDbGuard } from './utils/db-guard.js';

// ============================================================
// CREATE
// ============================================================

/**
 * Create a notification.
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
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Created notification
 */
export async function createNotification(data, ctx) {
  const userEmail = normalizeEmail(data?.userEmail);
  if (!userEmail) {
    return { ok: false, reason: 'invalid_email' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

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
      notification: formatNotification(row),
    };
  });
}

// ============================================================
// READ
// ============================================================

/**
 * List notifications for a user.
 * @param {string} userEmail - User's email
 * @param {Object} options - List options
 * @param {number} [options.limit=20] - Maximum results
 * @param {number} [options.offset=0] - Offset for pagination
 * @param {boolean} [options.unreadOnly=false] - Only return unread
 * @param {Object} ctx - Context object
 * @returns {Promise<Array>} - List of notifications
 */
export async function listNotifications(userEmail, options = {}, ctx) {
  const email = normalizeEmail(userEmail);
  if (!email) return [];

  return withDbGuard([], async (db) => {
    const orgId = getOrgId(ctx);
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

    const rows = await qb
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return rows.map(formatNotification);
  });
}

/**
 * Get unread notification count for a user.
 * @param {string} userEmail - User's email
 * @param {Object} ctx - Context object
 * @returns {Promise<number>} - Unread count
 */
export async function getUnreadCount(userEmail, ctx) {
  const email = normalizeEmail(userEmail);
  if (!email) return 0;

  return withDbGuard(0, async (db) => {
    const orgId = getOrgId(ctx);

    const result = await db
      .selectFrom('user_notifications')
      .select(db.fn.count('id').as('count'))
      .where('user_email', '=', email)
      .where('organization_id', '=', orgId)
      .where('is_read', '=', false)
      .executeTakeFirst();

    return parseInt(result?.count || '0', 10);
  });
}

/**
 * Get a notification by ID.
 * @param {string} notificationId - Notification ID
 * @param {string} userEmail - User's email (for authorization)
 * @param {Object} ctx - Context object
 * @returns {Promise<Object|null>} - Notification or null
 */
export async function getNotification(notificationId, userEmail, ctx) {
  const email = normalizeEmail(userEmail);
  if (!email || !notificationId) return null;

  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .selectFrom('user_notifications')
      .selectAll()
      .where('id', '=', notificationId)
      .where('user_email', '=', email)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    return row ? formatNotification(row) : null;
  });
}

// ============================================================
// UPDATE
// ============================================================

/**
 * Mark a notification as read.
 * @param {string} notificationId - Notification ID
 * @param {string} userEmail - User's email (for authorization)
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result
 */
export async function markAsRead(notificationId, userEmail, ctx) {
  const email = normalizeEmail(userEmail);
  if (!email || !notificationId) {
    return { ok: false, reason: 'invalid_params' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

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
      notification: formatNotification(row),
    };
  });
}

/**
 * Mark all notifications as read for a user.
 * @param {string} userEmail - User's email
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result
 */
export async function markAllAsRead(userEmail, ctx) {
  const email = normalizeEmail(userEmail);
  if (!email) {
    return { ok: false, reason: 'invalid_email' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
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

// ============================================================
// HELPERS
// ============================================================

/**
 * Format a database row into a notification object.
 * @param {Object} row - Database row
 * @returns {Object} - Formatted notification
 */
function formatNotification(row) {
  let parsedData = {};
  if (row.data) {
    try {
      parsedData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
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
    actorEmail: row.actor_email,
    actorName: row.actor_name,
    data: parsedData,
    actionUrl: row.action_url,
    isRead: row.is_read,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}