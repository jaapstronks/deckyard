/**
 * SSE (Server-Sent Events) manager for real-time notification updates.
 * Tracks connected clients per user email and broadcasts notification events.
 */

import { normalizeEmail } from '../utils/normalize.js';
import { formatSSEMessage } from '../utils/sse.js';

// Map of userEmail -> Set of response objects
const clients = new Map();

/**
 * Add a client connection for a user.
 * @param {string} userEmail - The user's email
 * @param {object} res - Express response object (kept open for SSE)
 */
export function addClient(userEmail, res) {
  const email = normalizeEmail(userEmail);
  if (!email) return;

  if (!clients.has(email)) {
    clients.set(email, new Set());
  }
  clients.get(email).add(res);
}

/**
 * Remove a client connection.
 * @param {string} userEmail - The user's email
 * @param {object} res - Express response object
 */
export function removeClient(userEmail, res) {
  const email = normalizeEmail(userEmail);
  if (!email) return;

  const userClients = clients.get(email);
  if (userClients) {
    userClients.delete(res);
    if (userClients.size === 0) {
      clients.delete(email);
    }
  }
}

/**
 * Get the count of connected clients for a user.
 * @param {string} userEmail - The user's email
 * @returns {number} Number of connected clients
 */
export function getClientCount(userEmail) {
  const email = normalizeEmail(userEmail);
  return clients.get(email)?.size || 0;
}

/**
 * Broadcast an event to all clients connected for a user.
 * @param {string} userEmail - The user's email
 * @param {string} eventType - Event type (e.g., 'notification:new', 'notification:counts')
 * @param {object} data - Event data to send
 */
export function broadcastToUser(userEmail, eventType, data) {
  const email = normalizeEmail(userEmail);
  if (!email) return;

  const userClients = clients.get(email);
  if (!userClients || userClients.size === 0) return;

  const message = formatSSEMessage(eventType, data);

  for (const res of userClients) {
    try {
      res.write(message);
    } catch {
      // Client disconnected, will be cleaned up on 'close' event
    }
  }
}

/**
 * Send a heartbeat ping to all clients for a user.
 * Helps keep connections alive through proxies.
 * @param {string} userEmail - The user's email
 */
export function sendHeartbeat(userEmail) {
  const email = normalizeEmail(userEmail);
  if (!email) return;

  const userClients = clients.get(email);
  if (!userClients) return;

  const ping = `: heartbeat\n\n`;
  for (const res of userClients) {
    try {
      res.write(ping);
    } catch {
      // Ignore, will be cleaned up
    }
  }
}

/**
 * Send heartbeats to all connected users.
 * Call this periodically (e.g., every 30 seconds).
 */
export function sendAllHeartbeats() {
  for (const userEmail of clients.keys()) {
    sendHeartbeat(userEmail);
  }
}

// Event type constants
export const NotificationEventTypes = {
  NEW: 'notification:new',
  COUNTS: 'notification:counts',
  READ: 'notification:read',
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