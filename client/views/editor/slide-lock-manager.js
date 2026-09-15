/**
 * Slide Lock Manager
 *
 * Manages per-slide locking for concurrent editing (the collab-live-edits-off
 * path). A lock is taken on the first real change, not on selection (D112):
 * opening a deck or clicking through its slides leaves no trace for anyone
 * else. The module:
 * 1. Records the content fingerprint of the selected slide on selection
 * 2. On an edit, compares the selected slide against that fingerprint; only a
 *    changed slide asks for the lock, and a slide another user holds refuses
 *    the edit (onLockFailed)
 * 3. Refreshes the held lock every 30 seconds while the user keeps editing
 * 4. Releases the held lock on switching slides, after IDLE_RELEASE_MS
 *    without a change, and when the tab is hidden
 * 5. Listens for SSE events to show locks held by other users, and re-fetches
 *    while the selected slide shows as held (an expired lock is not broadcast)
 * 6. Releases all locks on page unload
 */

import { matchesIdentity } from '../../../shared/identity-match.js';
import { slideFingerprint } from '../../../shared/slide-fingerprint.js';

const REFRESH_INTERVAL_MS = 30 * 1000; // 30 seconds
// A held lock is released once its slide saw no change for this long. Equal to
// the server TTL (server/storage/slide-locks.js): the lock ends when it would
// have expired had the refreshes stopped at the last edit, but explicitly, so
// the slide:unlocked broadcast frees it for others at once. Checked on the
// refresh tick, so the release lands between 2:00 and 2:30.
export const IDLE_RELEASE_MS = 2 * 60 * 1000;
const DEBUG = false; // Set to true to enable debug logging

function debugLog(...args) {
  if (DEBUG) console.debug('[slide-lock]', ...args);
}

/**
 * Create a slide lock manager instance.
 * @param {Object} options - Configuration options
 * @param {Function} options.api - API function for making requests
 * @param {string} options.presentationId - The presentation ID
 * @param {Object} [options.user] - The current user ({ id, email }), for the
 *   "is this lock mine?" self-check on SSE lock events
 * @param {Function} options.getSelectedSlideId - Function to get current slide ID
 * @param {Function} options.getSlide - Returns the local slide object for an ID
 *   (or null), for the "did this edit change the slide?" fingerprint check
 * @param {Function} [options.beforeRelease] - Awaited before a held lock is
 *   released on a slide switch, idle or a hidden tab, so pending edits are
 *   saved while the lock still covers them
 * @param {Function} [options.onLocksChanged] - Callback when locks state changes
 * @param {Function} [options.onLockFailed] - Called with `{ slideId, lock }`
 *   when an edit is refused because another user holds the slide: at once
 *   when the lock is already known, or when the acquire comes back held
 * @returns {Object} Slide lock manager API
 */
export function createSlideLockManager({
  api,
  presentationId,
  user,
  getSelectedSlideId,
  getSlide,
  beforeRelease,
  onLocksChanged,
  onLockFailed,
} = {}) {
  if (!api || !presentationId) {
    return {
      init: () => {},
      detach: () => {},
      onSlideSelected: () => {},
      onSlideEdited: () => true,
      resyncSlide: () => {},
      getLocks: () => ({}),
      isLockedByOther: () => false,
      refreshLocks: async () => {},
    };
  }

  let locks = {}; // slideId -> lock info
  let lockedByOthers = new Set(); // slide IDs locked by other users
  // The slide this user holds or is acquiring. Set synchronously when an edit
  // asks for the lock, so the next keystroke doesn't ask again and the remote
  // update handler already protects the slide while the acquire is in flight.
  let currentLockedSlideId = null;
  let lastEditAt = 0;
  // Fingerprint of the selected slide as last seen: at selection, after each
  // edit, after a server-truth rebase. An edit that leaves it unchanged (deck
  // title, settings) is no slide edit and takes no lock.
  let seen = { slideId: null, fingerprint: null };
  let refreshTimer = null;
  let stopped = false;
  let lastEmittedSignature = null;
  // Acquire/release requests run one at a time, in order: a release queued by
  // a slide switch must not land after the acquire of an edit that followed it.
  let lockOps = Promise.resolve();
  const enqueue = (op) => {
    lockOps = lockOps.then(op).catch((err) => {
      debugLog('lock op error:', err?.message);
    });
    return lockOps;
  };

  const selectedSlideId = () => getSelectedSlideId?.() || null;
  const currentSlideIsLocked = () => lockedByOthers.has(selectedSlideId());
  const fingerprintOf = (slideId) => {
    const slide = getSlide?.(slideId);
    return slide ? slideFingerprint(slide) : null;
  };

  /**
   * Stable signature of the state emitLocksChanged would broadcast, used to
   * suppress redundant emits (each of which triggers a full slide-list
   * rebuild downstream). Only the display-relevant fields go in:
   * - `lockedByOthers` is a Set emitted as an Array, so it is sorted first —
   *   iteration order must not read as a change.
   * - per-slide the holder identity (the `holder` pair), the only lock field
   *   the slide-list indicator and the locked-slide banner read.
   *   Volatile lock timestamps (`expiresAt` / `refreshedAt`) are deliberately
   *   excluded: a 30s lock refresh advances them without changing anything on
   *   screen, and letting that through would defeat this guard on exactly the
   *   concurrent-editing path it exists for.
   * A real lock take/release still flips `lockedByOthers` membership (and the
   * holder identity), so indicators appear and disappear as before.
   */
  const computeLockSignature = () =>
    JSON.stringify({
      locks: Object.keys(locks)
        .sort()
        .map((slideId) => {
          const lock = locks[slideId] || {};
          return [
            slideId,
            lock.holder?.id || '',
            lock.holder?.displayName || '',
          ];
        }),
      lockedByOthers: Array.from(lockedByOthers).sort(),
      currentLockedSlideId,
      // The selected slide goes in: the shell's locked-slide state is
      // recomputed for every selection, also between two held slides.
      selectedSlideId: selectedSlideId(),
      currentSlideIsLocked: currentSlideIsLocked(),
    });

  /**
   * Notify listeners that locks have changed. No-op when the broadcast state
   * is identical to the last one emitted — the SSE stream produces a flood of
   * echoes that leave the visible lock state untouched.
   */
  const emitLocksChanged = () => {
    const signature = computeLockSignature();
    if (signature === lastEmittedSignature) return;
    lastEmittedSignature = signature;
    try {
      onLocksChanged?.({
        locks,
        lockedByOthers: Array.from(lockedByOthers),
        currentLockedSlideId,
        currentSlideIsLocked: currentSlideIsLocked(),
      });
    } catch (err) {
      debugLog('onLocksChanged callback error:', err.message);
    }
  };

  /**
   * Fetch current lock state from server.
   */
  const fetchLocks = async () => {
    if (stopped) return;
    try {
      const resp = await api(
        `/api/presentations/${presentationId}/slide-locks`,
      );
      if (resp?.ok) {
        locks = resp.locks || {};
        lockedByOthers = new Set(resp.lockedByOthers || []);
        emitLocksChanged();
      }
    } catch (err) {
      debugLog('fetchLocks error:', err.message);
    }
  };

  /**
   * Acquire a lock on a slide.
   * @param {string} slideId - The slide to lock
   * @returns {Promise<boolean>} True if lock was acquired
   */
  const acquireLock = async (slideId) => {
    if (stopped || !slideId) return false;
    try {
      const resp = await api(
        `/api/presentations/${presentationId}/slides/${slideId}/lock`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      );
      if (resp?.ok) {
        locks[slideId] = resp.lock;
        lockedByOthers.delete(slideId);
        emitLocksChanged();
        return true;
      }
      // Soft-fail (no lock backend / invalid): locking is a no-op, stay quiet.
      return false;
    } catch (err) {
      // Held by another user: the 409 envelope carries the competing lock.
      // The edit that asked for it already landed locally; onLockFailed is
      // where the editor takes it back.
      if (err.code === 'held' && err.details?.lock) {
        if (currentLockedSlideId === slideId) currentLockedSlideId = null;
        locks[slideId] = err.details.lock;
        lockedByOthers.add(slideId);
        emitLocksChanged();
        onLockFailed?.({
          slideId,
          reason: 'held',
          lock: err.details.lock,
        });
        return false;
      }
      debugLog('acquireLock error:', slideId, err.message);
      return false;
    }
  };

  /**
   * Release a lock on a slide.
   * @param {string} slideId - The slide to unlock
   * @returns {Promise<boolean>} True if lock was released
   */
  const releaseLock = async (slideId) => {
    if (!slideId) return false;
    try {
      const resp = await api(
        `/api/presentations/${presentationId}/slides/${slideId}/lock`,
        {
          method: 'DELETE',
          body: JSON.stringify({}),
        },
      );
      // currentLockedSlideId is the caller's to clear: by the time a queued
      // release lands, a new edit may already have claimed the same slide.
      if (resp?.ok) {
        delete locks[slideId];
        emitLocksChanged();
        return true;
      }
      return false;
    } catch (err) {
      debugLog('releaseLock error:', slideId, err.message);
      return false;
    }
  };

  /**
   * Refresh the lock on the currently locked slide.
   */
  const refreshCurrentLock = async () => {
    const slideId = currentLockedSlideId;
    if (stopped || !slideId) return;
    try {
      const resp = await api(
        `/api/presentations/${presentationId}/slides/${slideId}/lock/refresh`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      );
      if (currentLockedSlideId !== slideId) return;
      if (resp?.ok) {
        locks[slideId] = resp.lock;
        emitLocksChanged();
      } else if (resp?.reason === 'expired' || resp?.reason === 'not_found') {
        // Lock was lost, try to reacquire
        await acquireLock(slideId);
      }
    } catch (err) {
      debugLog('refreshCurrentLock error:', err.message);
    }
  };

  /**
   * Ask the server again while the selected slide shows as held by someone
   * else. Such a lock can end without a broadcast (the holder's tab crashed or
   * slept past the TTL; only a release announces itself). Before D112 this
   * user's own acquire on selection corrected that; with no acquire until an
   * edit, and editing surfaces blocked by the stale state, nothing would.
   */
  const verifySelectedLock = () => {
    if (lockedByOthers.has(selectedSlideId())) fetchLocks();
  };

  const isTabHidden = () =>
    typeof document !== 'undefined' && document.visibilityState === 'hidden';

  /**
   * Give up the held lock (slide switch, idle, hidden tab). Pending edits are
   * saved first, while the lock still covers them.
   */
  const releaseHeldLock = () => {
    const slideId = currentLockedSlideId;
    if (!slideId) return lockOps;
    currentLockedSlideId = null;
    return enqueue(async () => {
      try {
        await beforeRelease?.();
      } catch (err) {
        debugLog('beforeRelease error:', err?.message);
      }
      // An edit during that save may have claimed the slide again.
      if (currentLockedSlideId === slideId) return;
      await releaseLock(slideId);
    });
  };

  /**
   * Refresh tick: keep the lock of a user who is still editing, release the
   * lock of one who stopped or left the tab.
   */
  const tick = () => {
    if (stopped) return lockOps;
    verifySelectedLock();
    if (!currentLockedSlideId) return lockOps;
    if (isTabHidden() || Date.now() - lastEditAt >= IDLE_RELEASE_MS) {
      return releaseHeldLock();
    }
    return enqueue(refreshCurrentLock);
  };

  /**
   * Release all locks held by this user.
   */
  const releaseAllLocks = async () => {
    try {
      await api(
        `/api/presentations/${presentationId}/slide-locks/release-all`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      );
      currentLockedSlideId = null;
      emitLocksChanged();
    } catch (err) {
      debugLog('releaseAllLocks error (TTL will clean up):', err.message);
    }
  };

  /**
   * Handle SSE events for real-time lock updates.
   */
  const handleSSEEvent = (event) => {
    if (stopped) return;
    try {
      const data = JSON.parse(event.data);
      switch (event.type) {
        case 'slide:locked':
          if (data.slideId && data.lock) {
            locks[data.slideId] = data.lock;
            // Locked by someone else unless the holder is me. Decided on the
            // stable id the payload carries (shared/identity-match.js), so a
            // renamed holder still recognizes their own lock.
            if (!matchesIdentity(user, { userId: data.lock.holder?.id })) {
              lockedByOthers.add(data.slideId);
            }
            emitLocksChanged();
          }
          break;

        case 'slide:unlocked':
          if (data.slideId) {
            delete locks[data.slideId];
            lockedByOthers.delete(data.slideId);
            emitLocksChanged();
          }
          break;

        case 'slide:locks-changed':
          // Refresh locks from server
          fetchLocks();
          break;
      }
    } catch (err) {
      debugLog('handleSSEEvent parse error:', err.message);
    }
  };

  /**
   * Set up SSE connection for real-time updates.
   */
  const setupSSE = () => {
    // Reuse the existing comment events SSE connection
    // by listening on the window for forwarded events
    const handleMessage = (e) => {
      if (e.detail?.type?.startsWith('slide:')) {
        handleSSEEvent({
          type: e.detail.type,
          data: JSON.stringify(e.detail.data),
        });
      }
    };
    window.addEventListener('sse:slide-lock', handleMessage);
    return () => window.removeEventListener('sse:slide-lock', handleMessage);
  };

  /**
   * Called when a slide is selected. Takes no lock: it releases the lock held
   * on another slide, records the new slide's fingerprint and re-emits, so
   * the shell shows whether someone else is editing the slide now in view.
   * @param {string} slideId - The newly selected slide ID
   * @returns {Promise<void>} Settles once a queued release has gone out
   */
  const onSlideSelected = (slideId) => {
    if (stopped) return lockOps;
    seen = { slideId, fingerprint: slideId ? fingerprintOf(slideId) : null };
    const pending =
      currentLockedSlideId && currentLockedSlideId !== slideId
        ? releaseHeldLock()
        : lockOps;
    emitLocksChanged();
    verifySelectedLock();
    return pending;
  };

  /**
   * Called on every edit (markDirty) with the selected slide. Decides whether
   * the edit changed that slide and, if so, whether it may stand:
   * - the slide's fingerprint is unchanged → no slide edit, allowed, no lock
   * - another user holds the slide → refused: onLockFailed fires, and the
   *   caller takes the local change back
   * - otherwise → allowed; the lock is asked for once (a held reply later
   *   still refuses through onLockFailed) and its idle clock restarts
   * A slide that is gone from the deck (a deletion) takes no lock here; the
   * server's write enforcement covers it.
   * @param {string} slideId - The selected slide
   * @returns {boolean} False when the edit is refused
   */
  const onSlideEdited = (slideId) => {
    if (stopped || !slideId) return true;
    const fingerprint = fingerprintOf(slideId);
    if (!fingerprint) return true;
    if (seen.slideId === slideId && seen.fingerprint === fingerprint) {
      return true;
    }
    if (lockedByOthers.has(slideId)) {
      onLockFailed?.({ slideId, reason: 'held', lock: locks[slideId] || null });
      return false;
    }
    seen = { slideId, fingerprint };
    lastEditAt = Date.now();
    if (currentLockedSlideId === slideId) return true;
    if (currentLockedSlideId) releaseHeldLock();
    currentLockedSlideId = slideId;
    enqueue(async () => {
      if (currentLockedSlideId === slideId) await acquireLock(slideId);
    });
    return true;
  };

  /**
   * Re-record a slide's fingerprint after its local copy was replaced from
   * the server (save response, remote update adopted, refused edit taken
   * back), so that replacement doesn't read as an edit by this user.
   * @param {string} [slideId] - Defaults to the selected slide
   */
  const resyncSlide = (slideId = selectedSlideId()) => {
    if (!slideId || seen.slideId !== slideId) return;
    seen = { slideId, fingerprint: fingerprintOf(slideId) };
  };

  /**
   * Check if a slide is locked by another user.
   * @param {string} slideId - The slide ID to check
   * @returns {boolean} True if locked by another user
   */
  const isLockedByOther = (slideId) => {
    return lockedByOthers.has(slideId);
  };

  /**
   * Get lock info for a specific slide.
   * @param {string} slideId - The slide ID
   * @returns {Object|null} Lock info or null
   */
  const getLockInfo = (slideId) => {
    return locks[slideId] || null;
  };

  /**
   * Initialize the slide lock manager.
   */
  const init = async () => {
    // Fetch initial lock state
    await fetchLocks();

    // destroy() can land while that fetch is in flight (the user navigated away
    // from the editor). Everything below outlives this function, so bail before
    // wiring anything — otherwise the refresh interval and both window
    // listeners stay attached for the lifetime of the tab.
    if (stopped) return () => {};

    // Set up periodic refresh (and the idle release it checks for)
    refreshTimer = setInterval(tick, REFRESH_INTERVAL_MS);

    // Set up SSE for real-time updates
    const cleanupSSE = setupSSE();

    // Release locks on page unload
    const onBeforeUnload = () => {
      releaseAllLocks().catch(() => {});
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    // A tab left in the background holds nothing: the next edit after
    // coming back asks for the lock again.
    const onVisibilityChange = () => {
      if (isTabHidden()) releaseHeldLock();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Store cleanup reference
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      cleanupSSE();
    };
  };

  /**
   * Clean up and release resources.
   */
  const detach = async () => {
    stopped = true;
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    await releaseAllLocks();
  };

  return {
    init,
    detach,
    onSlideSelected,
    onSlideEdited,
    resyncSlide,
    getLocks: () => ({ ...locks }),
    getLockedByOthers: () => Array.from(lockedByOthers),
    isLockedByOther,
    getLockInfo,
    refreshLocks: fetchLocks,
    getCurrentLockedSlideId: () => currentLockedSlideId,
  };
}
