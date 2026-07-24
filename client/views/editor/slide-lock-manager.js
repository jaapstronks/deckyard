/**
 * Slide Lock Manager
 *
 * Manages per-slide locking for concurrent editing.
 * When a user selects a slide, this module:
 * 1. Acquires a lock on that slide
 * 2. Refreshes the lock periodically (every 30 seconds)
 * 3. Releases the lock when switching to a different slide
 * 4. Listens for SSE events to show locks held by other users
 * 5. Releases all locks on page unload
 */

const REFRESH_INTERVAL_MS = 30 * 1000; // 30 seconds
const DEBUG = false; // Set to true to enable debug logging

function debugLog(...args) {
  if (DEBUG) console.debug('[slide-lock]', ...args);
}

/**
 * Create a slide lock manager instance.
 * @param {Object} options - Configuration options
 * @param {Function} options.api - API function for making requests
 * @param {string} options.presentationId - The presentation ID
 * @param {Function} options.getSelectedSlideId - Function to get current slide ID
 * @param {Function} [options.onLocksChanged] - Callback when locks state changes
 * @param {Function} [options.onLockFailed] - Callback when lock acquisition fails
 * @returns {Object} Slide lock manager API
 */
export function createSlideLockManager({
  api,
  presentationId,
  onLocksChanged,
  onLockFailed,
} = {}) {
  if (!api || !presentationId) {
    return {
      init: () => {},
      destroy: () => {},
      onSlideSelected: () => {},
      getLocks: () => ({}),
      isLockedByOther: () => false,
      refreshLocks: async () => {},
    };
  }

  let locks = {}; // slideId -> lock info
  let lockedByOthers = new Set(); // slide IDs locked by other users
  let currentLockedSlideId = null;
  let currentSlideIsLocked = false; // true if current slide is locked by another user
  let refreshTimer = null;
  let stopped = false;

  /**
   * Notify listeners that locks have changed.
   */
  const emitLocksChanged = () => {
    try {
      onLocksChanged?.({
        locks,
        lockedByOthers: Array.from(lockedByOthers),
        currentLockedSlideId,
        currentSlideIsLocked,
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
      const resp = await api(`/api/presentations/${presentationId}/slide-locks`);
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
      const resp = await api(`/api/presentations/${presentationId}/slides/${slideId}/lock`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (resp?.ok) {
        currentLockedSlideId = slideId;
        currentSlideIsLocked = false;
        locks[slideId] = resp.lock;
        lockedByOthers.delete(slideId);
        emitLocksChanged();
        return true;
      }
      // Lock held by another user
      if (resp?.reason === 'held' && resp?.lock) {
        currentSlideIsLocked = true;
        locks[slideId] = resp.lock;
        lockedByOthers.add(slideId);
        emitLocksChanged();
        onLockFailed?.({
          slideId,
          reason: 'held',
          lock: resp.lock,
        });
      }
      return false;
    } catch (err) {
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
      const resp = await api(`/api/presentations/${presentationId}/slides/${slideId}/lock`, {
        method: 'DELETE',
        body: JSON.stringify({}),
      });
      if (resp?.ok) {
        delete locks[slideId];
        if (currentLockedSlideId === slideId) {
          currentLockedSlideId = null;
        }
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
    if (stopped || !currentLockedSlideId) return;
    try {
      const resp = await api(
        `/api/presentations/${presentationId}/slides/${currentLockedSlideId}/lock/refresh`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        }
      );
      if (resp?.ok) {
        locks[currentLockedSlideId] = resp.lock;
        emitLocksChanged();
      } else if (resp?.reason === 'expired' || resp?.reason === 'missing') {
        // Lock was lost, try to reacquire
        await acquireLock(currentLockedSlideId);
      }
    } catch (err) {
      debugLog('refreshCurrentLock error:', err.message);
    }
  };

  /**
   * Release all locks held by this user.
   */
  const releaseAllLocks = async () => {
    try {
      await api(`/api/presentations/${presentationId}/slide-locks/release-all`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
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
            // Check if this is locked by someone else
            const currentEmail = window.__currentUserEmail?.toLowerCase?.();
            if (currentEmail && data.lock.holderEmail !== currentEmail) {
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
   * Called when a slide is selected.
   * Releases the previous lock and acquires a new one.
   * @param {string} slideId - The newly selected slide ID
   */
  const onSlideSelected = async (slideId) => {
    if (stopped) return;

    // Same slide - no action needed
    if (slideId === currentLockedSlideId) return;

    // Release previous lock
    if (currentLockedSlideId) {
      await releaseLock(currentLockedSlideId);
    }

    // Acquire new lock (if slide is provided)
    if (slideId) {
      await acquireLock(slideId);
    }
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

    // Set up periodic refresh
    refreshTimer = setInterval(refreshCurrentLock, REFRESH_INTERVAL_MS);

    // Set up SSE for real-time updates
    const cleanupSSE = setupSSE();

    // Release locks on page unload
    const onBeforeUnload = () => {
      releaseAllLocks().catch(() => {});
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    // Store cleanup reference
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      cleanupSSE();
    };
  };

  /**
   * Clean up and release resources.
   */
  const destroy = async () => {
    stopped = true;
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    await releaseAllLocks();
  };

  return {
    init,
    destroy,
    onSlideSelected,
    getLocks: () => ({ ...locks }),
    getLockedByOthers: () => Array.from(lockedByOthers),
    isLockedByOther,
    getLockInfo,
    refreshLocks: fetchLocks,
    getCurrentLockedSlideId: () => currentLockedSlideId,
    isCurrentSlideEditable: () => !currentSlideIsLocked,
    isCurrentSlideLocked: () => currentSlideIsLocked,
  };
}