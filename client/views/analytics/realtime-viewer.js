/**
 * Real-time viewer count component using SSE.
 */

import { t } from '../../lib/ui-i18n.js';

/**
 * Create real-time viewer count component.
 * @param {Object} options
 * @param {Function} options.h - DOM helper
 * @param {string} options.presentationId - Presentation ID
 * @returns {Object} Component API with el and destroy method
 */
export function createRealtimeViewer({ h, presentationId }) {
  let eventSource = null;
  let count = 0;

  const el = h('div', { class: 'analytics-card analytics-realtime' }, [
    h('div', { class: 'analytics-card-icon analytics-realtime-icon' }, [
      h('span', { class: 'analytics-realtime-dot' }),
    ]),
    h('div', { class: 'analytics-card-content' }, [
      h('div', { class: 'analytics-card-value analytics-realtime-count', text: '0' }),
      h('div', { class: 'analytics-card-label', text: t('analytics.liveViewers', 'Live Viewers') }),
    ]),
  ]);

  const countEl = el.querySelector('.analytics-realtime-count');
  const iconEl = el.querySelector('.analytics-realtime-icon');
  const dotEl = el.querySelector('.analytics-realtime-dot');

  // Connect to SSE
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;

  function connect() {
    try {
      eventSource = new EventSource(`/api/presentations/${presentationId}/analytics/realtime`);

      eventSource.addEventListener('viewerCount', (event) => {
        try {
          const data = JSON.parse(event.data);
          count = Number(data?.count) || 0;
          updateDisplay();
        } catch (err) {
          console.warn('[analytics] Failed to parse viewer count data:', err.message);
        }
      });

      eventSource.onerror = (event) => {
        console.warn('[analytics] SSE connection error:', event);
        dotEl.classList.add('is-disconnected');

        // EventSource will auto-reconnect for most errors, but we track attempts
        reconnectAttempts++;
        if (reconnectAttempts >= maxReconnectAttempts) {
          iconEl.title = t('analytics.connectionFailed', 'Connection failed');
          eventSource?.close();
        } else {
          iconEl.title = t('analytics.reconnecting', 'Reconnecting...');
        }
      };

      eventSource.onopen = () => {
        reconnectAttempts = 0; // Reset on successful connection
        dotEl.classList.remove('is-disconnected');
        iconEl.title = t('analytics.connected', 'Connected');
      };
    } catch (err) {
      console.error('[analytics] Failed to create SSE connection:', err);
      dotEl.classList.add('is-disconnected');
      iconEl.title = t('analytics.sseNotSupported', 'Live updates unavailable');
    }
  }

  function updateDisplay() {
    countEl.textContent = String(count);
    el.classList.toggle('has-viewers', count > 0);
  }

  function destroy() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  // Initial connection
  connect();

  return { el, destroy };
}