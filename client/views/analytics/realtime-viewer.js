/**
 * Real-time viewer count component using SSE.
 */

import { t } from '../../lib/ui-i18n.js';
import { createSSEConnection } from '../../lib/net/sse-connection.js';

/**
 * Create real-time viewer count component.
 * @param {Object} options
 * @param {Function} options.h - DOM helper
 * @param {string} options.presentationId - Presentation ID
 * @returns {Object} Component API with el and destroy method
 */
export function createRealtimeViewer({ h, presentationId }) {
  let connection = null;
  let count = 0;

  const el = h('div', { class: 'analytics-card analytics-realtime' }, [
    h('div', { class: 'analytics-card-icon analytics-realtime-icon' }, [
      h('span', { class: 'analytics-realtime-dot' }),
    ]),
    h('div', { class: 'analytics-card-content' }, [
      h('div', {
        class: 'analytics-card-value analytics-realtime-count',
        text: '0',
      }),
      h('div', {
        class: 'analytics-card-label',
        text: t('analytics.liveViewers', 'Live Viewers'),
      }),
    ]),
  ]);

  const countEl = el.querySelector('.analytics-realtime-count');
  const iconEl = el.querySelector('.analytics-realtime-icon');
  const dotEl = el.querySelector('.analytics-realtime-dot');

  // Connect to SSE. This card is a nice-to-have, so it gives up after a few
  // failed attempts (maxReconnectAttempts) rather than reconnecting forever.
  function connect() {
    connection = createSSEConnection({
      url: `/api/presentations/${presentationId}/analytics/realtime`,
      events: ['viewerCount'],
      onEvent: (event) => {
        try {
          const data = JSON.parse(event.data);
          count = Number(data?.count) || 0;
          updateDisplay();
        } catch (err) {
          console.warn(
            '[analytics] Failed to parse viewer count data:',
            err.message,
          );
        }
      },
      onConnected: () => {
        dotEl.classList.remove('is-disconnected');
        iconEl.title = t('analytics.connected', 'Connected');
      },
      onStateChange: (state) => {
        if (state === connection.STATE.RECONNECTING) {
          dotEl.classList.add('is-disconnected');
          iconEl.title = t('analytics.reconnecting', 'Reconnecting…');
        } else if (state === connection.STATE.FAILED) {
          dotEl.classList.add('is-disconnected');
          iconEl.title = t('analytics.connectionFailed', 'Connection failed');
        }
      },
      onError: () => {
        dotEl.classList.add('is-disconnected');
      },
      maxReconnectAttempts: 5,
    });
    connection.connect();
  }

  function updateDisplay() {
    countEl.textContent = String(count);
    el.classList.toggle('has-viewers', count > 0);
  }

  function destroy() {
    connection?.stop();
    connection = null;
  }

  // Initial connection
  connect();

  return { el, destroy };
}
