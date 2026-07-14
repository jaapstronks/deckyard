/**
 * SSE (Server-Sent Events) manager for real-time comment updates.
 * Tracks connected clients per presentation and broadcasts events.
 */

import { formatSSEMessage } from '../utils/sse.js';

// Map of presentationId -> Set of response objects
const clients = new Map();

/**
 * Add a client connection for a presentation.
 * @param {string} presentationId - The presentation ID
 * @param {object} res - Express response object (kept open for SSE)
 */
export function addClient(presentationId, res) {
  if (!clients.has(presentationId)) {
    clients.set(presentationId, new Set());
  }
  clients.get(presentationId).add(res);
}

/**
 * Remove a client connection.
 * @param {string} presentationId - The presentation ID
 * @param {object} res - Express response object
 */
export function removeClient(presentationId, res) {
  const presClients = clients.get(presentationId);
  if (presClients) {
    presClients.delete(res);
    if (presClients.size === 0) {
      clients.delete(presentationId);
    }
  }
}

/**
 * Get the count of connected clients for a presentation.
 * @param {string} presentationId - The presentation ID
 * @returns {number} Number of connected clients
 */
export function getClientCount(presentationId) {
  return clients.get(presentationId)?.size || 0;
}

/**
 * Broadcast an event to all clients connected to a presentation.
 * @param {string} presentationId - The presentation ID
 * @param {string} eventType - Event type (e.g., 'comment:created', 'comment:resolved')
 * @param {object} data - Event data to send
 */
export function broadcastToPresentation(presentationId, eventType, data) {
  const presClients = clients.get(presentationId);
  if (!presClients || presClients.size === 0) return;

  const message = formatSSEMessage(eventType, data);

  for (const res of presClients) {
    try {
      res.write(message);
    } catch {
      // Client disconnected, will be cleaned up on 'close' event
    }
  }
}

/**
 * Send a heartbeat ping to all clients for a presentation.
 * Helps keep connections alive through proxies.
 * @param {string} presentationId - The presentation ID
 */
export function sendHeartbeat(presentationId) {
  const presClients = clients.get(presentationId);
  if (!presClients) return;

  const ping = `: heartbeat\n\n`;
  for (const res of presClients) {
    try {
      res.write(ping);
    } catch {
      // Ignore, will be cleaned up
    }
  }
}

/**
 * Send heartbeats to all connected presentations.
 * Call this periodically (e.g., every 30 seconds).
 */
export function sendAllHeartbeats() {
  for (const presentationId of clients.keys()) {
    sendHeartbeat(presentationId);
  }
}

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

// Data source event types (for live data refresh)
export const DataSourceEventTypes = {
  REFRESHED: 'datasource:refreshed',
  ERROR: 'datasource:error',
};

// Heartbeat interval (30 seconds keeps connections alive through most proxies)
const HEARTBEAT_INTERVAL_MS = 30000;
let heartbeatIntervalId = null;

/**
 * Start the global heartbeat interval.
 * Sends periodic pings to all connected clients to keep connections alive.
 * Safe to call multiple times (idempotent).
 */
export function startHeartbeat() {
  if (heartbeatIntervalId) return; // Already running
  heartbeatIntervalId = setInterval(sendAllHeartbeats, HEARTBEAT_INTERVAL_MS);
}

/**
 * Stop the global heartbeat interval.
 */
export function stopHeartbeat() {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
}