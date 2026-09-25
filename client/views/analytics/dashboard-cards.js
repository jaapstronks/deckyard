/**
 * Dashboard summary metric cards component.
 */

import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';
import { icon } from '../../lib/dom/icons.js';
import {
  formatDuration,
  formatCompact,
} from '../../lib/format/analytics-format.js';

/** The trend arrow per direction; a flat trend has none. */
const TREND_ICONS = { up: 'arrow-up', down: 'arrow-down' };

/**
 * Create dashboard summary cards.
 * @param {Object} options
 * @param {Object} options.summary - Summary metrics
 * @param {Object} options.trend - Trend data
 * @returns {HTMLElement}
 */
export function createDashboardCards({ summary, trend }) {
  const trendIcon = TREND_ICONS[trend.direction];
  const trendClass = `dashboard-trend dashboard-trend-${trend.direction}`;
  const trendText =
    trend.percentChange > 0
      ? t('dashboard.trend.change', '{percent}% vs previous period', {
          percent: trend.percentChange,
        })
      : t('dashboard.trend.noPrevious', 'No previous data');

  const cards = h('div', { class: 'dashboard-cards' }, [
    createCard({
      label: t('dashboard.cards.totalViews', 'Total Views'),
      value: formatCompact(summary.totalViews),
      trend: trendText,
      trendIcon: trend.percentChange > 0 ? trendIcon : undefined,
      trendClass,
    }),
    createCard({
      label: t('dashboard.cards.uniqueViewers', 'Unique Viewers'),
      value: formatCompact(summary.uniqueViewers),
    }),
    createCard({
      label: t('dashboard.cards.avgDuration', 'Avg Duration'),
      value: formatDuration(summary.avgDurationSeconds, { short: true }),
    }),
    createCard({
      label: t('dashboard.cards.completionRate', 'Completion Rate'),
      value:
        summary.completionRate > 0
          ? `${Math.round(summary.completionRate * 100)}%`
          : '—',
    }),
  ]);

  return cards;
}

function createCard({ label, value, trend, trendIcon, trendClass }) {
  const card = h('div', { class: 'dashboard-metric-card' }, [
    h('div', { class: 'dashboard-metric-label', text: label }),
    h('div', { class: 'dashboard-metric-value', text: value }),
  ]);

  if (trend) {
    card.append(
      h('div', { class: trendClass }, [
        trendIcon ? icon(trendIcon, { size: 12 }) : null,
        h('span', { text: trend }),
      ]),
    );
  }

  return card;
}
