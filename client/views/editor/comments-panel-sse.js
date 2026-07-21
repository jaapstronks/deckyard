/**
 * SSE (Server-Sent Events) handler for real-time comment updates.
 * Extracted from comments-panel.js for better modularity.
 */

import { createSSEConnection } from '../../lib/net/sse-connection.js';

/**
 * Creates SSE handling functions for comment updates.
 * @param {Object} deps - Dependencies
 * @param {string} deps.presentationId - The presentation ID
 * @param {Function} deps.getOpenCount - Function to get current open count
 * @param {Function} deps.setOpenCount - Function to set open count
 * @param {Function} deps.getSlideCommentCounts - Function to get current slide counts
 * @param {Function} deps.setSlideCommentCounts - Function to set slide counts
 * @param {Function} deps.getIsVisible - Function to check if panel is visible
 * @param {Function} deps.markAsSeen - Function to mark comments as seen
 * @param {Function} deps.notifyBadge - Function to notify badge of changes
 * @param {Function} deps.loadComments - Function to reload comments
 * @param {Function} deps.onSlideCommentCountsChange - Callback for slide count changes
 * @returns {Object} SSE control functions
 */
export function createCommentSSE({
  presentationId,
  getOpenCount,
  setOpenCount,
  getSlideCommentCounts,
  setSlideCommentCounts,
  getIsVisible,
  markAsSeen,
  notifyBadge,
  loadComments,
  onSlideCommentCountsChange,
  onSlideLockEvent,
}) {
  let sseConnection = null;

  /**
   * Handle SSE events for real-time comment updates.
   */
  function handleSSEEvent(event) {
    try {
      const data = JSON.parse(event.data);

      switch (event.type) {
        case 'comment:counts':
          // Update counts from server
          if (typeof data.total === 'number' && data.total !== getOpenCount()) {
            setOpenCount(data.total);
            // If panel is visible, mark as seen immediately (user is viewing)
            if (getIsVisible()) {
              markAsSeen();
              loadComments();
            }
            notifyBadge();
          }
          if (data.counts) {
            const currentCounts = getSlideCommentCounts();
            const countsChanged = JSON.stringify(data.counts) !== JSON.stringify(currentCounts);
            if (countsChanged) {
              setSlideCommentCounts(data.counts);
              onSlideCommentCountsChange?.(data.counts);
            }
          }
          break;

        case 'comment:created':
        case 'comment:updated':
        case 'comment:deleted':
        case 'comment:resolved':
        case 'comment:reopened':
          // For individual events, refresh if panel is visible
          // The counts event will follow and update the badge
          if (getIsVisible()) {
            loadComments();
          }
          break;

        // Slide lock events for concurrent editing
        case 'slide:locked':
        case 'slide:unlocked':
        case 'slide:locks-changed':
          try {
            onSlideLockEvent?.({ type: event.type, data });
            // Also dispatch a custom event for the slide lock manager
            window.dispatchEvent(new CustomEvent('sse:slide-lock', {
              detail: { type: event.type, data },
            }));
          } catch {
            // ignore
          }
          break;

        // Presentation update events (real-time sync between editors)
        case 'presentation:updated':
          try {
            window.dispatchEvent(new CustomEvent('sse:presentation-updated', {
              detail: { type: event.type, data },
            }));
          } catch {
            // ignore
          }
          break;
      }
    } catch {
      // Ignore parse errors
    }
  }

  /**
   * Start real-time updates via SSE.
   * Safe to call multiple times.
   */
  function startPolling() {
    if (sseConnection) return; // Already connected

    const sseUrl = `/api/presentations/${presentationId}/comments/events`;
    sseConnection = createSSEConnection({
      url: sseUrl,
      events: [
        // Comment events
        'comment:counts',
        'comment:created',
        'comment:updated',
        'comment:deleted',
        'comment:resolved',
        'comment:reopened',
        // Slide lock events (for concurrent editing)
        'slide:locked',
        'slide:unlocked',
        'slide:locks-changed',
        // Presentation update events (real-time sync)
        'presentation:updated',
      ],
      onEvent: handleSSEEvent,
      onError: (err) => {
        console.warn('SSE connection error:', err);
      },
    });
    sseConnection.connect();
  }

  /**
   * Stop real-time updates.
   */
  function stopPolling() {
    if (sseConnection) {
      sseConnection.stop();
      sseConnection = null;
    }
  }

  return {
    startPolling,
    stopPolling,
  };
}