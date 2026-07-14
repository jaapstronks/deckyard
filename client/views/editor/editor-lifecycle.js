// Debounce visibility change beacons: only send if tab hidden for 30+ seconds
const VISIBILITY_DEBOUNCE_MS = 30 * 1000;

export function attachEditorLifecycle({
  saveManager,
  detachThumbScale,
} = {}) {
  let visibilityDebounceTimer = null;
  let beaconSentForCurrentHide = false;

  const sendSessionEndBeacon = () => {
    const beacon = saveManager?.getSessionEndBeacon?.();
    if (beacon?.url) {
      try {
        navigator.sendBeacon(beacon.url, beacon.body);
      } catch {
        // Beacon API not available or failed - best effort
      }
    }
  };

  const onBeforeUnload = (e) => {
    // If dirty, warn user about unsaved changes
    if (saveManager?.isDirty?.()) {
      e.preventDefault();
      e.returnValue = '';
    }

    // Clear any pending visibility debounce
    if (visibilityDebounceTimer) {
      clearTimeout(visibilityDebounceTimer);
      visibilityDebounceTimer = null;
    }

    // Send session-end beacon for reliable delivery even if tab closes
    // This creates a snapshot capturing the session's work
    sendSessionEndBeacon();
  };

  const onPopState = () => {
    saveManager?.cancelAutosave?.();
    detachThumbScale?.();
  };

  // Handle visibility change (tab hidden) - trigger session-end if idle for 30+ seconds
  // Debounced to avoid excessive snapshots from frequent alt-tabbing
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      // Start debounce timer when tab goes to background
      beaconSentForCurrentHide = false;
      if (visibilityDebounceTimer) clearTimeout(visibilityDebounceTimer);
      visibilityDebounceTimer = setTimeout(() => {
        if (document.visibilityState === 'hidden' && !beaconSentForCurrentHide) {
          sendSessionEndBeacon();
          beaconSentForCurrentHide = true;
        }
        visibilityDebounceTimer = null;
      }, VISIBILITY_DEBOUNCE_MS);
    } else {
      // Tab became visible again - cancel debounce timer
      if (visibilityDebounceTimer) {
        clearTimeout(visibilityDebounceTimer);
        visibilityDebounceTimer = null;
      }
    }
  };

  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('popstate', onPopState);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('popstate', onPopState);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (visibilityDebounceTimer) {
      clearTimeout(visibilityDebounceTimer);
      visibilityDebounceTimer = null;
    }
  };
}
