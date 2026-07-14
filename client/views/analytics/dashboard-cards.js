/**
 * Dashboard summary metric cards component.
 */

import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';
import { formatDuration as formatDurationBase } from '../../lib/analytics-format.js';

/**
 * Format duration in seconds to human readable (short form).
 * @param {number} seconds - Duration in seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  return formatDurationBase(seconds, { short: true });
}

/**
 * Format large numbers with K/M suffix.
 * @param {number} num - Number to format
 * @returns {string}
 */
function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
}

/**
 * Create dashboard summary cards.
 * @param {Object} options
 * @param {Object} options.summary - Summary metrics
 * @param {Object} options.trend - Trend data
 * @returns {HTMLElement}
 */
export function createDashboardCards({ summary, trend }) {
  const trendArrow = trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '';
  const trendClass = `dashboard-trend dashboard-trend-${trend.direction}`;
  const trendText = trend.percentChange > 0
    ? `${trendArrow}${trend.percentChange}% ${t('dashboard.trend.vsPrevious', 'vs previous period')}`
    : t('dashboard.trend.noPrevious', 'No previous data');

  const cards = h('div', { class: 'dashboard-cards' }, [
    createCard({
      label: t('dashboard.cards.totalViews', 'Total Views'),
      value: formatNumber(summary.totalViews),
      trend: trendText,
      trendClass,
    }),
    createCard({
      label: t('dashboard.cards.uniqueViewers', 'Unique Viewers'),
      value: formatNumber(summary.uniqueViewers),
    }),
    createCard({
      label: t('dashboard.cards.avgDuration', 'Avg Duration'),
      value: formatDuration(summary.avgDurationSeconds),
    }),
    createCard({
      label: t('dashboard.cards.completionRate', 'Completion Rate'),
      value: summary.completionRate > 0 ? `${Math.round(summary.completionRate * 100)}%` : '—',
    }),
  ]);

  return cards;
}

function createCard({ label, value, trend, trendClass }) {
  const card = h('div', { class: 'dashboard-metric-card' }, [
    h('div', { class: 'dashboard-metric-label', text: label }),
    h('div', { class: 'dashboard-metric-value', text: value }),
  ]);

  if (trend) {
    card.append(h('div', { class: trendClass, text: trend }));
  }

  return card;
}
