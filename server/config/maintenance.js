/**
 * Maintenance mode — "we're right back, your work is saved".
 *
 * A self-hosted Deckyard restarts on every deploy. Without this, an editor that
 * happens to be open during the restart window shows failing saves and raw 500s
 * with no explanation. Maintenance mode turns that window into something the
 * user can read: writes are refused with a 503 that carries `Retry-After`, and
 * open editors are told to go read-only and pause autosave until the server is
 * back.
 *
 * Two ways in, deliberately:
 *
 * - **`MAINTENANCE_MODE=1`** seeds the flag at boot. This is the deliberate
 *   case: an operator who knows a migration is coming flips it before deploying.
 * - **`setMaintenanceActive(true)`** at runtime, which the SIGTERM handler calls.
 *   That is the case that actually covers a normal deploy, because the container
 *   going down is the one that has the open connections; a fresh container
 *   booting with the env var set would be telling nobody.
 *
 * Reads stay open throughout. A read-only Deckyard is a useful Deckyard, and
 * blocking GETs would turn a restart into a hard outage for viewers and
 * presenters who are not writing anything.
 */

import { envBool } from './utils.js';

/** Seconds a client should wait before retrying a refused write. */
const DEFAULT_RETRY_AFTER_SECONDS = 30;

let active = envBool('MAINTENANCE_MODE');
let reason = active ? 'configured' : null;

/**
 * Whether maintenance mode is currently active.
 * @returns {boolean}
 */
export function isMaintenanceActive() {
  return active;
}

/**
 * Turn maintenance mode on or off at runtime.
 *
 * @param {boolean} next - Target state.
 * @param {Object} [options]
 * @param {string} [options.reason] - Short machine-readable reason
 *   (`'configured'`, `'shutdown'`), echoed to clients for the banner.
 * @returns {boolean} Whether the state actually changed.
 */
export function setMaintenanceActive(next, { reason: nextReason } = {}) {
  const target = !!next;
  if (target === active) return false;
  active = target;
  reason = target ? nextReason || 'manual' : null;
  return true;
}

/**
 * The current maintenance state as sent to clients.
 * @returns {{ active: boolean, reason: string|null, retryAfter: number }}
 */
export function getMaintenanceState() {
  return {
    active,
    reason,
    retryAfter: maintenanceRetryAfterSeconds(),
  };
}

/**
 * How long a client should wait before retrying, in seconds.
 * @returns {number}
 */
export function maintenanceRetryAfterSeconds() {
  const raw = Number(process.env.MAINTENANCE_RETRY_AFTER_SECONDS);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return DEFAULT_RETRY_AFTER_SECONDS;
}

/**
 * Whether a request method writes. Only writes are refused during maintenance.
 *
 * @param {string} method - HTTP method.
 * @returns {boolean}
 */
export function isWriteMethod(method) {
  const m = String(method || '').toUpperCase();
  return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
}

/**
 * Reset to the environment-seeded state. Tests only.
 */
export function resetMaintenanceForTests() {
  active = envBool('MAINTENANCE_MODE');
  reason = active ? 'configured' : null;
}
