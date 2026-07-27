/**
 * Announcing maintenance mode to connected clients.
 *
 * Split from `config/maintenance.js` on purpose: the config module owns the
 * flag and must stay dependency-free (route handlers and tests read it on every
 * request), while announcing needs the SSE hub. Everything that flips the flag
 * for real goes through here, so the broadcast can never be forgotten at one of
 * the call sites.
 */

import {
  getMaintenanceState,
  setMaintenanceActive,
} from '../config/maintenance.js';
import { broadcastToAll, MaintenanceEventTypes } from './comment-events.js';

/**
 * Flip maintenance mode and tell every connected client.
 *
 * Broadcasts even when the state did not change, so a client that connected
 * after the flip still gets a fresh answer if this is called again. The
 * broadcast is best-effort by construction: a client that is not connected
 * learns the state from `GET /api/maintenance` on its next page load.
 *
 * @param {boolean} active - Target state.
 * @param {Object} [options]
 * @param {string} [options.reason] - Short reason, echoed to clients.
 * @returns {{ changed: boolean, notified: number, state: object }}
 */
export function announceMaintenance(active, { reason } = {}) {
  const changed = setMaintenanceActive(active, { reason });
  const state = getMaintenanceState();
  const notified = broadcastToAll(MaintenanceEventTypes.CHANGED, state);
  return { changed, notified, state };
}
