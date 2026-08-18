/**
 * SSE (Server-Sent Events) manager for real-time comment updates.
 * Tracks connected clients per presentation and broadcasts events.
 *
 * The registry + heartbeat lifecycle is the shared `createSseHub` (B87); this
 * module is the presentation channel over it: the key is the presentation ID,
 * and the domain names below re-export the hub's methods.
 */

import { createSseHub } from '../utils/sse.js';

const hub = createSseHub();

/**
 * Add a client connection for a presentation.
 * @param {string} presentationId - The presentation ID
 * @param {object} res - Response object (kept open for SSE)
 */
export const addClient = hub.addClient;

/**
 * Remove a client connection.
 * @param {string} presentationId - The presentation ID
 * @param {object} res - Response object
 */
export const removeClient = hub.removeClient;

/**
 * Broadcast an event to all clients connected to a presentation.
 * @param {string} presentationId - The presentation ID
 * @param {string} eventType - Event type (e.g. 'comment:created', 'comment:resolved')
 * @param {object} data - Event data to send
 */
export const broadcastToPresentation = hub.broadcast;

/**
 * Broadcast an event to every connected client, across all presentations.
 *
 * Used for server-wide announcements (maintenance mode) rather than
 * presentation-scoped updates. Deliberately reuses this channel instead of
 * opening a second one: the editor already holds this stream open for the whole
 * session (`editor-controller.js` starts it on load, not when the comments
 * panel opens), so an announcement reaches every open editor without a new
 * connection or any polling.
 *
 * @param {string} eventType - Event type (e.g. 'maintenance:changed').
 * @param {object} data - Event data to send.
 * @returns {number} Number of client connections written to.
 */
export const broadcastToAll = hub.broadcastAll;

/**
 * Start the global heartbeat interval. Safe to call multiple times (idempotent).
 */
export const startHeartbeat = hub.startHeartbeat;

/**
 * Stop the global heartbeat interval.
 */
export const stopHeartbeat = hub.stopHeartbeat;

// Event type constants
export const CommentEventTypes = {
  CREATED: 'comment:created',
  UPDATED: 'comment:updated',
  DELETED: 'comment:deleted',
  RESOLVED: 'comment:resolved',
  REOPENED: 'comment:reopened',
  COUNTS_CHANGED: 'comment:counts',
};

// Slide lock event types (for concurrent editing)
export const SlideLockEventTypes = {
  LOCKED: 'slide:locked',
  UNLOCKED: 'slide:unlocked',
  LOCKS_CHANGED: 'slide:locks-changed',
};

// Presentation-level event types (for real-time sync)
export const PresentationEventTypes = {
  UPDATED: 'presentation:updated',
};

// Server-wide event types (broadcast to every connected client)
export const MaintenanceEventTypes = {
  CHANGED: 'maintenance:changed',
};
