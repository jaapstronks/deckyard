/**
 * Overview panel with summary metric cards.
 */

import { t } from '../../lib/ui-i18n.js';
import { formatDuration, formatNumber, formatPercent } from '../../lib/format/analytics-format.js';
import { iconUrl } from '../../../shared/icon-names.js';

/**
 * Create an overview panel with metric cards.
 * @param {Object} options
 * @param {Function} options.h - DOM helper
 * @param {Object} options.data - Overview data
 * @returns {Object} Panel API with el and update method
 */
export function createOverviewPanel({ h, data }) {
  const el = h('div', { class: 'analytics-section analytics-overview' });

  const cardsContainer = h('div', { class: 'analytics-overview-cards' });

  const cards = {
    views: createCard(h, {
      label: t('analytics.totalViews', 'Total Views'),
      value: formatNumber(data?.totalViews || 0),
      icon: 'eye',
    }),
    viewers: createCard(h, {
      label: t('analytics.uniqueViewers', 'Unique Viewers'),
      value: formatNumber(data?.uniqueViewers || 0),
      icon: 'user',
    }),
    duration: createCard(h, {
      label: t('analytics.avgTime', 'Avg. Time'),
      value: formatDuration(data?.avgDurationSeconds || 0),
      icon: 'timer',
    }),
    completion: createCard(h, {
      label: t('analytics.completionRate', 'Completion'),
      value: formatPercent(data?.completionRate || 0),
      icon: 'circle-check',
    }),
  };

  cardsContainer.append(cards.views.el, cards.viewers.el, cards.duration.el, cards.completion.el);
  el.append(cardsContainer);

  function update(newData) {
    cards.views.update(formatNumber(newData?.totalViews || 0));
    cards.viewers.update(formatNumber(newData?.uniqueViewers || 0));
    cards.duration.update(formatDuration(newData?.avgDurationSeconds || 0));
    cards.completion.update(formatPercent(newData?.completionRate || 0));
  }

  return { el, update };
}

/**
 * Create a single metric card.
 * @param {Function} h - DOM helper
 * @param {Object} options
 * @returns {Object} Card API
 */
function createCard(h, { label, value, icon }) {
  const valueEl = h('div', { class: 'analytics-card-value', text: value });

  const el = h('div', { class: 'analytics-card' }, [
    h('div', { class: 'analytics-card-icon' }, [
      h('img', { src: iconUrl(icon), alt: '', 'aria-hidden': 'true', class: 'analytics-card-icon-img' }),
    ]),
    h('div', { class: 'analytics-card-content' }, [
      valueEl,
      h('div', { class: 'analytics-card-label', text: label }),
    ]),
  ]);

  function update(newValue) {
    valueEl.textContent = newValue;
  }

  return { el, update };
}