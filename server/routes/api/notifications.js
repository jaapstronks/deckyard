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
import {
  addClient,
  removeClient,
  startHeartbeat,
} from '../../services/notification-events.js';
import { createRouteContext } from '../../utils/context.js';
import { serveJson, badRequest, requireJsonBody } from '../../utils/http.js';
import { parsePaginationParams } from '../../utils/request-validators.js';

/**
 * Handle notification-related API endpoints.
 */
export async function handleNotifications({ req, res, url, authedUser }) {
  const ctx = createRouteContext(authedUser);

  // Require authentication for all notification endpoints
  if (!authedUser?.email) {
    return false;
  }

  const userEmail = authedUser.email;

  // GET /api/notifications/events - SSE endpoint for real-time notifications
  if (url.pathname === '/api/notifications/events' && req.method === 'GET') {
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Start the heartbeat interval (idempotent)
    startHeartbeat();

    // Register client
    addClient(userEmail, res);

    // Send initial connection event with current unread count
    const unreadCount = await getUnreadCount(userEmail, ctx);
    res.write(`event: connected\ndata: ${JSON.stringify({ unreadCount })}\n\n`);

    // Clean up on client disconnect
    req.on('close', () => {
      removeClient(userEmail, res);
    });

    // Keep the connection open (don't return true, don't end response)
    return true;
  }

  // GET /api/notifications/unread-count - Get unread notification count
  if (url.pathname === '/api/notifications/unread-count' && req.method === 'GET') {
    const count = await getUnreadCount(userEmail, ctx);
    serveJson(res, 200, { unreadCount: count });
    return true;
  }

  // POST /api/notifications/mark-read - Mark notification(s) as read
  if (url.pathname === '/api/notifications/mark-read' && req.method === 'POST') {
    const jsonResult = await requireJsonBody(req, res);
    if (!jsonResult.ok) return true;
    const body = jsonResult.body;

    // Mark all as read
    if (body?.all === true) {
      const result = await markAllAsRead(userEmail, ctx);
      if (!result.ok) {
        return badRequest(res, result.reason);
      }
      serveJson(res, 200, { ok: true, updatedCount: result.updatedCount });
      return true;
    }

    // Mark single notification as read
    const notificationId = body?.notificationId;
    if (!notificationId) {
      return badRequest(res, 'notificationId or all:true is required');
    }

    const result = await markAsRead(notificationId, userEmail, ctx);
    if (!result.ok) {
      if (result.reason === 'not_found') {
        return badRequest(res, 'Notification not found');
      }
      return badRequest(res, result.reason);
    }

    serveJson(res, 200, { ok: true, notification: result.notification });
    return true;
  }

  // POST /api/notifications/archive - Archive one item or all
  if (url.pathname === '/api/notifications/archive' && req.method === 'POST') {
    const jsonResult = await requireJsonBody(req, res);
    if (!jsonResult.ok) return true;
    const body = jsonResult.body;

    if (body?.all === true) {
      const result = await archiveAllNotifications(userEmail, ctx);
      if (!result.ok) {
        return badRequest(res, result.reason);
      }
      serveJson(res, 200, { ok: true, updatedCount: result.updatedCount });
      return true;
    }

    const notificationId = body?.notificationId;
    if (!notificationId) {
      return badRequest(res, 'notificationId or all:true is required');
    }

    const result = await archiveNotification(notificationId, userEmail, ctx);
    if (!result.ok) {
      if (result.reason === 'not_found') {
        return badRequest(res, 'Notification not found');
      }
      return badRequest(res, result.reason);
    }

    serveJson(res, 200, { ok: true, notification: result.notification });
    return true;
  }

  // GET /api/notifications - List notifications
  if (url.pathname === '/api/notifications' && req.method === 'GET') {
    const { limit, offset } = parsePaginationParams(url.searchParams, { defaultLimit: 20 });
    // filter=all|unread|mentions|archived (legacy alias: unread=true)
    const filter = url.searchParams.get('filter')
      || (url.searchParams.get('unread') === 'true' ? 'unread' : 'all');

    const opts = { limit, offset };
    if (filter === 'unread') opts.unreadOnly = true;
    else if (filter === 'mentions') opts.types = ['comment_mention'];
    else if (filter === 'archived') opts.archived = true;

    const notifications = await listNotifications(userEmail, opts, ctx);
    const unreadCount = await getUnreadCount(userEmail, ctx);

    serveJson(res, 200, { notifications, unreadCount, filter });
    return true;
  }

  return false;
}