/**
 * SSE (Server-Sent Events) manager for real-time notification updates.
 * Tracks connected clients per user email and broadcasts notification events.
 *
 * The registry + heartbeat lifecycle is the shared `createSseHub` (B87); this
 * module is the notification channel over it: the key is a normalized email,
 * and the domain names below re-export the hub's methods.
 */

import { normalizeEmail } from '../utils/normalize.js';
import { createSseHub } from '../utils/sse.js';

const hub = createSseHub({ normalizeKey: normalizeEmail });

/**
 * Add a client connection for a user.
 * @param {string} userEmail - The user's email
 * @param {object} res - Response object (kept open for SSE)
 */
export const addClient = hub.addClient;

/**
 * Remove a client connection.
 * @param {string} userEmail - The user's email
 * @param {object} res - Response object
 */
export const removeClient = hub.removeClient;

/**
 * Broadcast an event to all clients connected for a user.
 * @param {string} userEmail - The user's email
 * @param {string} eventType - Event type (e.g. 'notification:new', 'notification:counts')
 * @param {object} data - Event data to send
 */
export const broadcastToUser = hub.broadcast;

/**
 * Start the global heartbeat interval. Safe to call multiple times (idempotent).
 */
export const startHeartbeat = hub.startHeartbeat;

/**
 * Stop the global heartbeat interval.
 */
export const stopHeartbeat = hub.stopHeartbeat;

// Event type constants
export const NotificationEventTypes = {
  NEW: 'notification:new',
  COUNTS: 'notification:counts',
  READ: 'notification:read',
};
