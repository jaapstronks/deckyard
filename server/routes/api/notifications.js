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
import { dispatchRoutes } from '../../utils/router.js';
import { serveJson, badRequest, requireJsonBody } from '../../utils/http.js';
import { parsePaginationParams } from '../../utils/request-validators.js';

// GET /api/notifications/events - SSE endpoint for real-time notifications
async function handleNotificationEvents({ req, res, authedUser }) {
  const ctx = createRouteContext(authedUser);
  const userEmail = authedUser.email;

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
  const unreadCount = await getUnreadCount(ctx, userEmail);
  res.write(`event: connected\ndata: ${JSON.stringify({ unreadCount })}\n\n`);

  // Clean up on client disconnect
  req.on('close', () => {
    removeClient(userEmail, res);
  });

  // Keep the connection open (don't end response)
  return true;
}

// GET /api/notifications/unread-count - Get unread notification count
async function handleNotificationUnreadCount({ res, authedUser }) {
  const ctx = createRouteContext(authedUser);
  const count = await getUnreadCount(ctx, authedUser.email);
  serveJson(res, 200, { unreadCount: count });
  return true;
}

// POST /api/notifications/mark-read - Mark notification(s) as read
async function handleNotificationMarkRead({ req, res, authedUser }) {
  const ctx = createRouteContext(authedUser);
  const userEmail = authedUser.email;

  const jsonResult = await requireJsonBody(req, res);
  if (!jsonResult.ok) return true;
  const body = jsonResult.body;

  // Mark all as read
  if (body?.all === true) {
    const result = await markAllAsRead(ctx, userEmail);
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

  const result = await markAsRead(ctx, notificationId, userEmail);
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
async function handleNotificationArchive({ req, res, authedUser }) {
  const ctx = createRouteContext(authedUser);
  const userEmail = authedUser.email;

  const jsonResult = await requireJsonBody(req, res);
  if (!jsonResult.ok) return true;
  const body = jsonResult.body;

  if (body?.all === true) {
    const result = await archiveAllNotifications(ctx, userEmail);
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

  const result = await archiveNotification(ctx, notificationId, userEmail);
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
async function handleNotificationList({ res, url, authedUser }) {
  const ctx = createRouteContext(authedUser);
  const userEmail = authedUser.email;

  const { limit, offset } = parsePaginationParams(url.searchParams, { defaultLimit: 20 });
  // filter=all|unread|mentions|archived (legacy alias: unread=true)
  const filter = url.searchParams.get('filter')
    || (url.searchParams.get('unread') === 'true' ? 'unread' : 'all');

  const opts = { limit, offset };
  if (filter === 'unread') opts.unreadOnly = true;
  else if (filter === 'mentions') opts.types = ['comment_mention'];
  else if (filter === 'archived') opts.archived = true;

  const notifications = await listNotifications(ctx, userEmail, opts);
  const unreadCount = await getUnreadCount(ctx, userEmail);

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
  { method: 'GET', pattern: '/api/notifications/events', handler: handleNotificationEvents },
  { method: 'GET', pattern: '/api/notifications/unread-count', handler: handleNotificationUnreadCount },
  { method: 'POST', pattern: '/api/notifications/mark-read', handler: handleNotificationMarkRead },
  { method: 'POST', pattern: '/api/notifications/archive', handler: handleNotificationArchive },
  { method: 'GET', pattern: '/api/notifications', handler: handleNotificationList },
];

/**
 * Handle notification-related API endpoints. The module-wide auth guard falls
 * through (`false`, not a 401) for unauthenticated requests, exactly as the
 * original chain did — the root dispatcher's 404 answers.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export function handleNotifications(ctx) {
  // Require authentication for all notification endpoints
  if (!ctx.authedUser?.email) {
    return false;
  }
  return dispatchRoutes(ROUTES, ctx);
}