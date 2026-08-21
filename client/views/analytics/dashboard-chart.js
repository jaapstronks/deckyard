/**
 * Dashboard timeline chart component.
 * Simple bar chart showing views over time.
 */

import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';
import { formatDate } from '../../lib/format/analytics-format.js';
import { createEmptyState } from '../../lib/dom/empty-state.js';

/** Full weekday+date label for a chart tooltip. */
const formatDateLong = (dateStr) =>
  formatDate(dateStr, { weekday: 'short', month: 'short', day: 'numeric' });

/** Compact month+day label for a chart axis tick. */
const formatDateShort = (dateStr) =>
  formatDate(dateStr, { month: 'short', day: 'numeric' });

/**
 * Create dashboard timeline chart.
 * @param {Object} options
 * @param {Array} options.timeline - Timeline data [{date, views, uniqueViewers}]
 * @param {string} options.period - Selected period
 * @returns {HTMLElement}
 */
export function createDashboardChart({ timeline, period }) {
  const card = h('div', { class: 'dashboard-card dashboard-chart-card' }, [
    h('h3', {
      class: 'dashboard-card-title',
      text: t('dashboard.chart.title', 'Views Over Time'),
    }),
  ]);

  if (!timeline || !timeline.length) {
    card.append(
      createEmptyState({
        icon: 'chart-column',
        title: t('dashboard.chart.empty', 'No view data for this period'),
      }),
    );
    return card;
  }

  // Find max value for scaling
  const maxViews = Math.max(...timeline.map((d) => d.views), 1);

  // Create chart with accessibility support
  const chartWrap = h('div', {
    class: 'dashboard-chart-wrap',
    role: 'img',
    'aria-label': t(
      'dashboard.chart.ariaLabel',
      'Bar chart showing views over time',
    ),
  });
  const barsWrap = h('div', {
    class: 'dashboard-chart-bars',
    'aria-hidden': 'true',
  });

  for (const day of timeline) {
    const heightPercent = Math.max((day.views / maxViews) * 100, 2); // Min 2% height for visibility
    const bar = h('div', { class: 'dashboard-chart-bar-col' }, [
      h('div', {
        class: 'dashboard-chart-bar',
        style: `height: ${heightPercent}%`,
        title: `${formatDateLong(day.date)}: ${day.views} views`,
      }),
    ]);
    barsWrap.append(bar);
  }

  // X-axis labels (show first, middle, last dates)
  const labels = h('div', { class: 'dashboard-chart-labels' });
  if (timeline.length > 0) {
    labels.append(h('span', { text: formatDateShort(timeline[0].date) }));
    if (timeline.length > 2) {
      const midIndex = Math.floor(timeline.length / 2);
      labels.append(
        h('span', { text: formatDateShort(timeline[midIndex].date) }),
      );
    }
    labels.append(
      h('span', { text: formatDateShort(timeline[timeline.length - 1].date) }),
    );
  }

  chartWrap.append(barsWrap, labels);
  card.append(chartWrap);

  return card;
}
