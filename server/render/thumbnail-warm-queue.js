/**
 * Debounced, fire-and-forget queue for warming deck thumbnails on save.
 *
 * The deck-grid raster is produced by headless Chrome, and a save is the
 * autosave path: the editor fires a PUT ~1.5s after the last keystroke, so a
 * typing burst is a stream of saves. Warming straight from the route handler
 * therefore means one Chrome launch per keystroke-batch — that is exactly what
 * was measured and reverted during PR #422 (the test suite went from ~10s to
 * >10 minutes). This module is the throttle that makes warming affordable:
 *
 * - **Trailing-edge debounce, keyed per deck.** A burst of saves collapses into
 *   one render, fired only after the deck has been quiet for {@link WARM_DEBOUNCE_MS}.
 *   Two different decks never share a timer.
 * - **Never holds the process open.** Timers are `unref()`d, so a pending warm
 *   cannot keep a server (or a test run) alive.
 * - **Never throws to the caller.** Warming is best-effort; the on-demand
 *   thumbnail route regenerates whatever this misses.
 * - **Off under `node --test` by default.** See {@link warmOnSaveEnabled}.
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('thumbnail-warm');

/**
 * Quiet period a deck must have before its warm fires. Comfortably longer than
 * the editor's 1500ms autosave debounce (client/views/editor/save-manager.js),
 * so continuous typing keeps pushing the render out instead of stacking renders.
 */
export const WARM_DEBOUNCE_MS = 5000;

/** deckKey -> { timer, task } */
const pending = new Map();

/**
 * Whether saves may schedule a warm at all.
 *
 * Default is on, *except* under the node test runner: an unattended suite that
 * saves decks would otherwise spend its wall-clock launching Chrome for rasters
 * nobody looks at. `DECK_THUMBNAIL_WARM_ON_SAVE=1|0` overrides in either
 * direction (the queue's own tests opt in explicitly, with a stub task).
 *
 * @returns {boolean}
 */
export function warmOnSaveEnabled() {
  const raw = String(process.env.DECK_THUMBNAIL_WARM_ON_SAVE ?? '').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return !process.env.NODE_TEST_CONTEXT;
}

/**
 * Queue `task` for `key`, replacing any warm already pending for that key.
 *
 * @param {string} key - Deck id. One pending warm per deck, last one wins.
 * @param {() => Promise<any>} task - The actual warm; run at most once per burst.
 * @param {{ delayMs?: number }} [options]
 * @returns {boolean} whether a warm is now pending (false = warming is disabled).
 */
export function scheduleThumbnailWarm(key, task, { delayMs = WARM_DEBOUNCE_MS } = {}) {
  if (!key || typeof task !== 'function') return false;
  if (!warmOnSaveEnabled()) return false;

  const existing = pending.get(key);
  if (existing) clearTimeout(existing.timer);

  const timer = setTimeout(() => {
    pending.delete(key);
    void run(key, task);
  }, delayMs);
  // A queued raster is never worth delaying shutdown for.
  timer.unref?.();

  pending.set(key, { timer, task });
  return true;
}

/** Run one warm, swallowing everything. @param {string} key @param {Function} task */
async function run(key, task) {
  try {
    await task();
  } catch (err) {
    log.warn(`warm failed for ${key}:`, err?.message);
  }
}

/**
 * Deck ids with a warm still pending. Lets callers (and tests) observe the
 * debounce without waiting for it.
 * @returns {string[]}
 */
export function pendingWarmKeys() {
  return [...pending.keys()];
}

/** Drop every pending warm without running it. Used by tests. */
export function cancelPendingWarms() {
  for (const { timer } of pending.values()) clearTimeout(timer);
  pending.clear();
}

/**
 * Run every pending warm now instead of waiting out the debounce. Test-only —
 * production always goes through the timer.
 * @returns {Promise<void>}
 */
export async function flushPendingWarms() {
  const entries = [...pending.entries()];
  cancelPendingWarms();
  await Promise.all(entries.map(([key, { task }]) => run(key, task)));
}
