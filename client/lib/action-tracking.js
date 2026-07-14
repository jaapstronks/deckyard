/**
 * Action tracking for slide action buttons.
 *
 * Tracks clicks on elements with [data-action-track] attribute.
 * Sends events to analytics if available, otherwise logs to console in dev mode.
 */

const TRACKING_ENABLED = true;

/**
 * Track an action button click.
 * @param {object} data - Tracking data
 * @param {string} data.label - Button label
 * @param {string} data.url - Button URL
 * @param {number} data.index - Button index (0, 1, 2)
 * @param {string} data.slideId - Slide ID
 * @param {string} data.slideType - Slide type
 */
export function trackActionClick({
  label = '',
  url = '',
  index = 0,
  slideId = '',
  slideType = '',
} = {}) {
  if (!TRACKING_ENABLED) return;

  const event = {
    type: 'action_click',
    label: String(label || '').trim(),
    url: String(url || '').trim(),
    index: Number(index) || 0,
    slideId: String(slideId || '').trim(),
    slideType: String(slideType || '').trim(),
    timestamp: new Date().toISOString(),
  };

  // If window has a global analytics handler, use it
  if (typeof window !== 'undefined' && typeof window.sbTrack === 'function') {
    try {
      window.sbTrack('action_click', event);
    } catch {
      // ignore
    }
    return;
  }

  // In development, log to console
  if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
    // eslint-disable-next-line no-console
    console.log('[action-tracking]', event);
  }
}

/**
 * Initialize action tracking for a container element.
 * Attaches click handlers to all [data-action-track] elements.
 *
 * @param {HTMLElement} container - Container to search for action buttons
 * @param {object} context - Context data (slideId, slideType)
 * @returns {function} Cleanup function to remove handlers
 */
export function initActionTracking(container, { slideId = '', slideType = '' } = {}) {
  if (!container || typeof container.querySelectorAll !== 'function') {
    return () => {};
  }

  const buttons = container.querySelectorAll('[data-action-track]');
  const handlers = [];

  buttons.forEach((btn) => {
    const handler = (e) => {
      const label = btn.getAttribute('data-action-label') || btn.textContent || '';
      const url = btn.getAttribute('href') || '';
      const index = parseInt(btn.getAttribute('data-action-track') || '0', 10);

      trackActionClick({
        label,
        url,
        index,
        slideId,
        slideType,
      });
    };

    btn.addEventListener('click', handler);
    handlers.push({ btn, handler });
  });

  // Return cleanup function
  return () => {
    handlers.forEach(({ btn, handler }) => {
      try {
        btn.removeEventListener('click', handler);
      } catch {
        // ignore
      }
    });
    handlers.length = 0;
  };
}

/**
 * Set up global delegation for action tracking.
 * This is an alternative to initActionTracking that works for dynamically added content.
 *
 * @returns {function} Cleanup function
 */
export function initGlobalActionTracking() {
  if (typeof document === 'undefined') return () => {};

  const handler = (e) => {
    const btn = e.target.closest?.('[data-action-track]');
    if (!btn) return;

    const slide = btn.closest?.('.slide');
    const slideId = slide?.getAttribute?.('data-slide-id') || '';
    const slideType = slide?.getAttribute?.('data-slide-type') || '';

    const label = btn.getAttribute('data-action-label') || btn.textContent || '';
    const url = btn.getAttribute('href') || '';
    const index = parseInt(btn.getAttribute('data-action-track') || '0', 10);

    trackActionClick({
      label,
      url,
      index,
      slideId,
      slideType,
    });
  };

  document.addEventListener('click', handler);

  return () => {
    document.removeEventListener('click', handler);
  };
}