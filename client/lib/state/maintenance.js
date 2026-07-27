/**
 * Client-side maintenance state — "we're right back, your work is saved".
 *
 * The server announces maintenance over the SSE stream the editor already holds
 * open (`maintenance:changed`), and answers `GET /api/maintenance` for anyone
 * who needs to ask. This module is the single place that holds the answer, so a
 * banner, the editor's read-only mode and the autosave pause cannot drift apart.
 *
 * Deliberately *not* driven by failed requests. A 503 tells you a write was
 * refused; only the announcement tells you it will come back, and guessing from
 * error codes is how a transient network blip turns into a scary banner.
 */

const listeners = new Set();

/** @type {{ active: boolean, reason: string|null, retryAfter: number }} */
let state = { active: false, reason: null, retryAfter: 30 };

/**
 * The current maintenance state.
 * @returns {{ active: boolean, reason: string|null, retryAfter: number }}
 */
export function getMaintenanceState() {
  return state;
}

/**
 * Whether maintenance is currently active.
 * @returns {boolean}
 */
export function isMaintenanceActive() {
  return state.active;
}

/**
 * Apply a state received from the server and notify subscribers.
 *
 * No-ops when `active` is unchanged, so a repeated announcement (or a reconnect
 * that re-reads the same state) does not re-fire the banner and the toast.
 *
 * @param {{ active?: boolean, reason?: string|null, retryAfter?: number }} next
 * @returns {boolean} Whether the active flag changed.
 */
export function setMaintenanceState(next) {
  const active = !!next?.active;
  const changed = active !== state.active;
  state = {
    active,
    reason: next?.reason ?? null,
    retryAfter: Number(next?.retryAfter) > 0 ? Number(next.retryAfter) : 30,
  };
  if (changed) {
    for (const fn of listeners) {
      try {
        fn(state);
      } catch {
        // one bad subscriber must not stop the others
      }
    }
  }
  return changed;
}

/**
 * Subscribe to maintenance transitions.
 *
 * @param {(state: { active: boolean, reason: string|null, retryAfter: number }) => void} fn
 * @returns {() => void} Unsubscribe.
 */
export function onMaintenanceChange(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Ask the server for the current state.
 *
 * Used after an SSE reconnect: the announcement that maintenance *started*
 * arrived over a connection that the restart then dropped, so nothing would ever
 * announce the end of it. The reconnect itself is the hint; this is the answer.
 * A failed fetch leaves the state untouched — the server being unreachable is
 * not evidence that maintenance is over.
 *
 * @param {typeof fetch} [fetchImpl] - Injectable for tests.
 * @returns {Promise<boolean>} Whether the active flag changed.
 */
export async function refreshMaintenanceState(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl('/api/maintenance', { cache: 'no-store' });
    if (!res?.ok) return false;
    return setMaintenanceState(await res.json());
  } catch {
    return false;
  }
}

/**
 * Reset to the initial state. Tests only.
 */
export function resetMaintenanceStateForTests() {
  state = { active: false, reason: null, retryAfter: 30 };
  listeners.clear();
}
