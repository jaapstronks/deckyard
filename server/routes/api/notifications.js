/**
 * API routes for user notifications.
 *
 * Authenticated endpoints:
 *   GET  /api/notifications?limit=20&offset=0&filter=all|unread|mentions|archived
 *                                                         - List notifications
 *   GET  /api/notifications/unread-count                  - Get unread count
 *   POST /api/notifications/mark-read                     - Mark as read
 *   POST /api/notifications/archive                       - Archive one item or all
 *   GET  /api/notifications/events                        - SSE endpoint
 */

import {
  listNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  archiveNotification,
  archiveAllNotifications,
} from '../../storage/notifications.js';
import { addClient, removeClient } from '../../services/notification-events.js';
import { dispatchRoutes } from '../../utils/router.js';
import {
  serveJson,
  badRequest,
  getErrorStatus,
  jsonError,
  requireJsonBody,
  withErrorHandler,
} from '../../utils/http.js';
import { parsePaginationParams } from '../../utils/request-validators.js';
import { openSseStream, sseWrite } from '../../utils/sse.js';

/**
 * Human-readable text per notification-mutation failure reason.
 *
 * The status is deliberately not here: it comes from the `REASONS` register
 * (`server/storage/reasons.js`) via `getErrorStatus()`. A reason without an
 * entry sends no `message`, and the canonical envelope's `error` code carries
 * the meaning on its own.
 */
const NOTIFICATION_FAILURE_MESSAGES = {
  not_found: 'Notification not found',
};

/**
 * Answer a failed notification mutation in the canonical envelope: the reason
 * is the machine code, its register entry is the status.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {string} reason
 * @returns {true}
 */
function notificationError(res, reason) {
  return jsonError(
    res,
    getErrorStatus(reason),
    reason,
    NOTIFICATION_FAILURE_MESSAGES[reason],
  );
}

// GET /api/notifications/events - SSE endpoint for real-time notifications
async function handleNotificationEvents({
  storageScope,
  req,
  res,
  authedUser,
}) {
  const userEmail = authedUser.email;

  const stream = openSseStream(req, res);
  if (!stream.ok) return true;

  // Register client
  addClient(userEmail, res);

  // Send initial connection event with current unread count
  const unreadCount = await getUnreadCount(storageScope, userEmail);
  sseWrite(res, { event: 'connected', data: { unreadCount } });

  // Clean up on client disconnect
  req.on('close', () => {
    removeClient(userEmail, res);
  });

  // Keep the connection open (don't end response)
  return true;
}

// GET /api/notifications/unread-count - Get unread notification count
async function handleNotificationUnreadCount({
  storageScope,
  res,
  authedUser,
}) {
  const count = await getUnreadCount(storageScope, authedUser.email);
  serveJson(res, 200, { unreadCount: count });
  return true;
}

// POST /api/notifications/mark-read - Mark notification(s) as read
async function handleNotificationMarkRead({
  storageScope,
  req,
  res,
  authedUser,
}) {
  const userEmail = authedUser.email;

  const jsonResult = await requireJsonBody(req, res);
  if (!jsonResult.ok) return true;
  const body = jsonResult.body;

  // Mark all as read
  if (body?.all === true) {
    const result = await markAllAsRead(storageScope, userEmail);
    if (!result.ok) {
      return notificationError(res, result.reason);
    }
    serveJson(res, 200, { ok: true, updatedCount: result.updatedCount });
    return true;
  }

  // Mark single notification as read
  const notificationId = body?.notificationId;
  if (!notificationId) {
    return badRequest(res, 'notificationId or all:true is required');
  }

  const result = await markAsRead(storageScope, notificationId, userEmail);
  if (!result.ok) {
    return notificationError(res, result.reason);
  }

  serveJson(res, 200, { ok: true, notification: result.notification });
  return true;
}

// POST /api/notifications/archive - Archive one item or all
async function handleNotificationArchive({
  storageScope,
  req,
  res,
  authedUser,
}) {
  const userEmail = authedUser.email;

  const jsonResult = await requireJsonBody(req, res);
  if (!jsonResult.ok) return true;
  const body = jsonResult.body;

  if (body?.all === true) {
    const result = await archiveAllNotifications(storageScope, userEmail);
    if (!result.ok) {
      return notificationError(res, result.reason);
    }
    serveJson(res, 200, { ok: true, updatedCount: result.updatedCount });
    return true;
  }

  const notificationId = body?.notificationId;
  if (!notificationId) {
    return badRequest(res, 'notificationId or all:true is required');
  }

  const result = await archiveNotification(
    storageScope,
    notificationId,
    userEmail,
  );
  if (!result.ok) {
    return notificationError(res, result.reason);
  }

  serveJson(res, 200, { ok: true, notification: result.notification });
  return true;
}

// GET /api/notifications - List notifications
async function handleNotificationList({ storageScope, res, url, authedUser }) {
  const userEmail = authedUser.email;

  const { limit, offset } = parsePaginationParams(url.searchParams, {
    defaultLimit: 20,
  });
  // filter=all|unread|mentions|archived (legacy alias: unread=true)
  const filter =
    url.searchParams.get('filter') ||
    (url.searchParams.get('unread') === 'true' ? 'unread' : 'all');

  const opts = { limit, offset };
  if (filter === 'unread') opts.unreadOnly = true;
  else if (filter === 'mentions') opts.types = ['comment_mention'];
  else if (filter === 'archived') opts.archived = true;

  const notifications = await listNotifications(storageScope, userEmail, opts);
  const unreadCount = await getUnreadCount(storageScope, userEmail);

  serveJson(res, 200, { notifications, unreadCount, filter });
  return true;
}

/**
 * Declarative route table for `/api/notifications*` (A7.19 C8). Order matches
 * the previous if-chain; every path fell through on a method mismatch (Form A),
 * so there are no 405 catch-all rows.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  {
    method: 'GET',
    pattern: '/api/notifications/events',
    handler: handleNotificationEvents,
  },
  {
    method: 'GET',
    pattern: '/api/notifications/unread-count',
    handler: handleNotificationUnreadCount,
  },
  {
    method: 'POST',
    pattern: '/api/notifications/mark-read',
    handler: handleNotificationMarkRead,
  },
  {
    method: 'POST',
    pattern: '/api/notifications/archive',
    handler: handleNotificationArchive,
  },
  {
    method: 'GET',
    pattern: '/api/notifications',
    handler: handleNotificationList,
  },
];

/**
 * Handle notification-related API endpoints. The module-wide auth guard falls
 * through (`false`, not a 401) for unauthenticated requests, exactly as the
 * original chain did — the root dispatcher's 404 answers.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleNotifications = withErrorHandler('notifications', (ctx) => {
  // Require authentication for all notification endpoints
  if (!ctx.authedUser?.email) {
    return false;
  }
  return dispatchRoutes(ROUTES, ctx);
});
