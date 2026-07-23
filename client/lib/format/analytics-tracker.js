/**
 * Analytics tracker for presentation views.
 *
 * Lightweight, non-blocking tracker that:
 * - Uses navigator.sendBeacon for reliable session end
 * - 30-second heartbeat interval
 * - Visibility API for pause/resume
 * - Device ID in localStorage
 */

import { storage } from '../storage.js';

const DEVICE_ID_KEY = 'ps.analytics.deviceId';
const HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds
const FETCH_TIMEOUT_MS = 10000; // 10 seconds
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000; // 1 second base delay for exponential backoff

/**
 * Generate a unique device ID.
 * @returns {string}
 */
function generateDeviceId() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate device ID format (32 hex chars).
 * @param {string} deviceId - The device ID to validate
 * @returns {boolean}
 */
function isValidDeviceId(deviceId) {
  return deviceId && /^[a-f0-9]{32}$/i.test(deviceId);
}

/**
 * Get or create device ID from localStorage.
 * Validates stored ID and regenerates if invalid.
 * @returns {string}
 */
function getDeviceId() {
  let deviceId = storage.get(DEVICE_ID_KEY);
  // Validate stored device ID - regenerate if invalid or tampered
  if (!isValidDeviceId(deviceId)) {
    deviceId = generateDeviceId();
    storage.set(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

/**
 * Create an analytics tracker for a presentation.
 * @param {Object} options - Tracker options
 * @param {string} options.presentationId - The presentation ID to track
 * @param {string} options.sourceType - 'share_link' | 'follow' | 'embed'
 * @param {string} [options.sourceId] - Share link token or session ID
 * @param {string} [options.viewerEmail] - Viewer's email if authenticated
 * @param {string} [options.viewerType] - 'guest' | 'authenticated' | 'anonymous'
 * @param {string} [options.organizationId] - Organization ID
 * @returns {Object} Tracker API
 */
export function createAnalyticsTracker({
  presentationId,
  sourceType,
  sourceId = null,
  viewerEmail = null,
  viewerType = 'anonymous',
  organizationId = null,
} = {}) {
  let sessionToken = null;
  let currentSlideId = null;
  let currentSlideIndex = 0;
  let heartbeatInterval = null;
  let isActive = true;
  let isStarted = false;
  let isDestroyed = false;

  const deviceId = getDeviceId();

  /**
   * Sleep for a given duration.
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Send tracking request with timeout and retry logic.
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request data
   * @param {Object} [options] - Options
   * @param {boolean} [options.retry] - Whether to retry on failure (default: false)
   * @param {boolean} [options.critical] - Whether this is a critical request (uses retries)
   * @returns {Promise<Object|null>}
   */
  async function sendTrack(endpoint, data, { retry = false, critical = false } = {}) {
    const maxAttempts = (retry || critical) ? MAX_RETRIES : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          keepalive: true, // Allow request to complete even if page unloads
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          return response.json();
        }

        // Don't retry on client errors (4xx)
        if (response.status >= 400 && response.status < 500) {
          return null;
        }
      } catch (error) {
        // Don't retry if aborted intentionally or on final attempt
        if (error.name === 'AbortError' && attempt === maxAttempts) {
          return null;
        }
      }

      // Exponential backoff before retry (only if not final attempt)
      if (attempt < maxAttempts) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }

    return null;
  }

  /**
   * Send tracking request via beacon (for page unload).
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request data
   */
  function sendBeacon(endpoint, data) {
    try {
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      navigator.sendBeacon(endpoint, blob);
    } catch {
      // Ignore errors
    }
  }

  /**
   * Start the tracking session.
   * @returns {Promise<boolean>} True if session started successfully
   */
  async function start() {
    if (isStarted || isDestroyed) return false;

    // Session start is critical - use retry logic
    const result = await sendTrack('/api/track/session/start', {
      presentationId,
      sourceType,
      sourceId,
      viewerEmail,
      viewerType,
      deviceId,
      organizationId,
    }, { critical: true });

    if (result?.sessionToken) {
      sessionToken = result.sessionToken;
      isStarted = true;

      // Start heartbeat
      startHeartbeat();

      // Set up visibility change handler
      document.addEventListener('visibilitychange', handleVisibilityChange);

      // Set up unload handler
      window.addEventListener('beforeunload', handleUnload);
      window.addEventListener('pagehide', handleUnload);

      return true;
    }

    return false;
  }

  /**
   * Track a slide change.
   * @param {string} slideId - The new slide ID
   * @param {number} [slideIndex] - The slide index
   */
  function trackSlide(slideId, slideIndex = 0) {
    if (!isStarted || isDestroyed || !sessionToken) return;

    currentSlideId = slideId;
    currentSlideIndex = slideIndex;

    // Record slide view (don't await - non-blocking)
    sendTrack('/api/track/slide/view', {
      sessionToken,
      slideId,
      slideIndex,
    });
  }

  /**
   * Send heartbeat to keep session alive.
   */
  function heartbeat() {
    if (!isStarted || isDestroyed || !sessionToken || !isActive) return;

    sendTrack('/api/track/session/heartbeat', {
      sessionToken,
      currentSlideId,
      currentSlideIndex,
    });
  }

  /**
   * Start the heartbeat interval.
   */
  function startHeartbeat() {
    if (heartbeatInterval) return;
    heartbeatInterval = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Stop the heartbeat interval.
   */
  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  /**
   * Handle visibility change (pause/resume tracking).
   */
  function handleVisibilityChange() {
    if (document.hidden) {
      isActive = false;
      stopHeartbeat();
    } else {
      isActive = true;
      startHeartbeat();
      // Send immediate heartbeat when becoming visible
      heartbeat();
    }
  }

  /**
   * Handle page unload - end session via beacon.
   */
  function handleUnload() {
    if (!isStarted || isDestroyed || !sessionToken) return;

    sendBeacon('/api/track/session/end', {
      sessionToken,
      exitSlideId: currentSlideId,
      exitSlideIndex: currentSlideIndex,
    });
  }

  /**
   * Destroy the tracker and end the session.
   */
  function destroy() {
    if (isDestroyed) return;
    isDestroyed = true;

    // Clean up event listeners
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('beforeunload', handleUnload);
    window.removeEventListener('pagehide', handleUnload);

    // Stop heartbeat
    stopHeartbeat();

    // End session
    if (isStarted && sessionToken) {
      sendBeacon('/api/track/session/end', {
        sessionToken,
        exitSlideId: currentSlideId,
        exitSlideIndex: currentSlideIndex,
      });
    }
  }

  /**
   * Get the current session token.
   * @returns {string|null}
   */
  function getSessionToken() {
    return sessionToken;
  }

  /**
   * Check if tracker is currently active.
   * @returns {boolean}
   */
  function isTracking() {
    return isStarted && !isDestroyed;
  }

  return {
    start,
    trackSlide,
    destroy,
    getSessionToken,
    isTracking,
  };
}

/**
 * Check if analytics tracking is enabled.
 * Can be disabled via presentation settings or user preferences.
 * @param {Object} [presentation] - Presentation object with settings
 * @returns {boolean}
 */
export function isAnalyticsEnabled(presentation = null) {
  // Check presentation settings
  if (presentation?.settings?.analyticsEnabled === false) {
    return false;
  }

  // Check user preference (localStorage)
  if (storage.getBool('ps.analytics.disabled', false)) {
    return false;
  }

  return true;
}