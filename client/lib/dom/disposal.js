/**
 * Disposal helper for view teardown (B150).
 *
 * Teardown code wants "best effort, keep going": one broken handle must not
 * abort the rest of the unmount, or the next view mounts on top of live
 * listeners and timers. Before this helper that intent was spelled as a
 * `try { x?.(); } catch {}` per handle — ~38 sites, 21 of them in the
 * presenter teardown alone — and every one of those empty catches swallowed
 * the failure without a trace, which is exactly what the silent-failure lint
 * gate (eslint.config.js, B106/B150) now rejects.
 *
 * `disposeAll` is the one place that swallow is allowed to live: it runs each
 * disposer in order, never lets one failure stop the next, and records every
 * failure through debugLog so a reproducing session can see which handle
 * broke (enable with ?debugLog=1).
 */

import { debugLog } from '../util/debug.js';

/**
 * Run every disposer, in order, best-effort.
 *
 * Entries may be `null`/`undefined` (skipped), so optional handles go in
 * as-is: `disposeAll([detachKeys, detachSwipe])`. A method on an optional
 * object is wrapped at the call site: `() => widget?.destroy?.()`. A disposer
 * that returns a promise gets the same treatment asynchronously — its
 * rejection is recorded, not left unhandled.
 *
 * @param {Array<(() => unknown)|null|undefined>} disposers
 */
export function disposeAll(disposers) {
  for (const dispose of disposers) {
    if (typeof dispose !== 'function') continue;
    try {
      const result = dispose();
      if (result && typeof result.catch === 'function') {
        result.catch((err) => debugLog('[disposeAll] disposer rejected', err));
      }
    } catch (err) {
      debugLog('[disposeAll] disposer threw', err);
    }
  }
}
