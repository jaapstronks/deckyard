/**
 * Presence lock module for turn-based editing.
 * Manages lock acquisition, refresh, and request workflow.
 */

/**
 * Attaches presence lock handling to a presentation.
 * Automatically acquires/refreshes locks and handles the request workflow.
 * @param {Object} options - Configuration options
 * @param {Function} options.api - API function for making requests
 * @param {string} options.id - The presentation ID
 * @param {Function} [options.onPresenceText] - Callback for presence text updates
 * @param {Function} [options.onLockStateChange] - Callback for lock state changes
 * @param {boolean} [options.useSlideLevelLocking] - If true, skip presentation-level lock acquisition
 * @returns {Function} Cleanup function to detach the presence lock
 */
export function attachPresentationPresenceLock({
  api,
  id,
  onPresenceText,
  onLockStateChange,
  useSlideLevelLocking = false,
} = {}) {
  if (!api || !id) return () => {};

  // When slide-level locking is enabled, we don't use presentation-level locks.
  // Return a no-op detach function - the slide lock manager handles everything.
  if (useSlideLevelLocking) {
    // Immediately report that we're the "holder" so the editor isn't read-only
    try {
      onLockStateChange?.({
        isHolder: true,
        lockInfo: null,
        myRequest: null,
        pendingRequestsCount: 0,
      }, {});
    } catch {
      // ignore
    }
    return () => {};
  }

  let timer = null;
  let isHolder = false;
  let lockInfo = null;
  let myRequest = null;
  let pendingRequestsCount = 0;
  let stopped = false;

  const setPresence = (t) => {
    try {
      onPresenceText?.(String(t || ''));
    } catch {
      // ignore
    }
  };

  const actions = {
    requestAccess: async (message = '') => {
      try {
        const resp = await api(`/api/presentations/${id}/lock/request`, {
          method: 'POST',
          body: JSON.stringify({ message }),
        });
        if (resp?.ok) {
          myRequest = resp?.request || null;
          emitStateChange();
          return { ok: true, request: myRequest };
        }
        return { ok: false, reason: resp?.reason };
      } catch (err) {
        return { ok: false, reason: 'error', error: err };
      }
    },
    getPendingRequests: async () => {
      try {
        const resp = await api(`/api/presentations/${id}/lock/requests`);
        return resp?.requests || [];
      } catch {
        return [];
      }
    },
    acceptRequest: async (requestId) => {
      try {
        const resp = await api(`/api/presentations/${id}/lock/requests/${requestId}/accept`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        if (resp?.ok) {
          isHolder = false;
          pendingRequestsCount = 0;
          // Fetch current lock status to see new holder (if they've acquired)
          await fetchStatus();
          return { ok: true };
        }
        return { ok: false, reason: resp?.reason };
      } catch (err) {
        return { ok: false, reason: 'error', error: err };
      }
    },
    rejectRequest: async (requestId) => {
      try {
        const resp = await api(`/api/presentations/${id}/lock/requests/${requestId}/reject`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        if (resp?.ok) {
          pendingRequestsCount = Math.max(0, pendingRequestsCount - 1);
          emitStateChange();
          return { ok: true };
        }
        return { ok: false, reason: resp?.reason };
      } catch (err) {
        return { ok: false, reason: 'error', error: err };
      }
    },
    forceRelease: async () => {
      try {
        const resp = await api(`/api/presentations/${id}/lock/force-release`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        if (resp?.ok) {
          lockInfo = null;
          emitStateChange();
          await acquire();
          return { ok: true };
        }
        return { ok: false, reason: resp?.reason };
      } catch (err) {
        return { ok: false, reason: 'error', error: err };
      }
    },
    refresh: async () => {
      await tick();
    },
    acquire: async () => {
      await acquire();
    },
  };

  const emitStateChange = () => {
    try {
      onLockStateChange?.({
        isHolder,
        lockInfo,
        myRequest,
        pendingRequestsCount,
      }, actions);
    } catch {
      // ignore
    }
  };

  const fetchStatus = async () => {
    try {
      const resp = await api(`/api/presentations/${id}/lock`);
      lockInfo = resp?.lock || null;
      myRequest = resp?.myRequest || null;

      // Server tells us if we're the holder (handles transferred locks)
      if (resp?.isHolder) {
        isHolder = true;
        pendingRequestsCount = 0;
        setPresence('');
        emitStateChange();
        return;
      }

      if (!lockInfo) {
        isHolder = false;
        setPresence('');
        emitStateChange();
        return;
      }

      isHolder = false;
      const who = String(lockInfo?.holderName || lockInfo?.holderEmail || '').trim();
      setPresence(who ? `Bewerkt door ${who}` : 'Bewerkt door iemand anders');
      emitStateChange();
    } catch {
      // ignore
    }
  };

  const acquire = async () => {
    try {
      const resp = await api(`/api/presentations/${id}/lock/acquire`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (resp?.ok) {
        isHolder = true;
        lockInfo = resp?.lock || null;
        myRequest = null; // Clear request after successfully acquiring
        pendingRequestsCount = 0;
        setPresence('');
        emitStateChange();
        return;
      }
      isHolder = false;
      lockInfo = resp?.lock || null;
      myRequest = null; // Clear request on failure too (it's been processed)
      await fetchStatus();
    } catch {
      // If acquire fails (likely held by someone else), show status.
      isHolder = false;
      myRequest = null;
      await fetchStatus();
    }
  };

  const refresh = async () => {
    try {
      const resp = await api(`/api/presentations/${id}/lock/refresh`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (resp?.ok) {
        isHolder = true;
        lockInfo = resp?.lock || null;
        pendingRequestsCount = resp?.pendingRequestsCount || 0;
        setPresence('');
        emitStateChange();
        return;
      }
      // Lost lock; show who holds it.
      isHolder = false;
      await fetchStatus();
    } catch {
      isHolder = false;
      await fetchStatus();
    }
  };

  const release = async () => {
    try {
      await api(`/api/presentations/${id}/lock/release`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      isHolder = false;
      lockInfo = null;
      emitStateChange();
    } catch {
      // ignore (TTL will clear it)
    }
  };

  const tick = async () => {
    if (stopped) return;
    if (isHolder) await refresh();
    else await fetchStatus();
  };

  const start = async () => {
    await acquire();
    // detach() can land while acquire() is in flight; it clears `timer` before
    // this line ever runs, so starting the poll now would leave an interval
    // nothing can reach.
    if (stopped) return;
    // Poll every 15 seconds to catch lock requests quickly
    timer = setInterval(() => {
      tick().catch(() => {});
    }, 15 * 1000);
  };

  const onBeforeUnload = () => {
    // Best-effort; TTL is the real cleanup.
    if (isHolder) release().catch(() => {});
  };
  window.addEventListener('beforeunload', onBeforeUnload);

  start().catch(() => {});

  const checkMyRequestStatus = async () => {
    try {
      const resp = await api(`/api/presentations/${id}/lock/my-request`);
      myRequest = resp?.request || null;
      emitStateChange();
      return myRequest;
    } catch {
      return null;
    }
  };

  const getState = () => ({
    isHolder,
    lockInfo,
    myRequest,
    pendingRequestsCount,
  });

  const detach = () => {
    stopped = true;
    window.removeEventListener('beforeunload', onBeforeUnload);
    if (timer) clearInterval(timer);
    timer = null;
    if (isHolder) release().catch(() => {});
    setPresence('');
  };

  // Return both detach function and API methods
  detach.requestAccess = actions.requestAccess;
  detach.getPendingRequests = actions.getPendingRequests;
  detach.acceptRequest = actions.acceptRequest;
  detach.rejectRequest = actions.rejectRequest;
  detach.forceRelease = actions.forceRelease;
  detach.checkMyRequestStatus = checkMyRequestStatus;
  detach.getState = getState;
  detach.refresh = tick;

  return detach;
}