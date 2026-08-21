/**
 * Overview panel with summary metric cards.
 */

import { t } from '../../lib/ui-i18n.js';
import {
  formatDuration,
  formatCount,
  formatPercent,
} from '../../lib/format/analytics-format.js';
import { icon as uiIcon } from '../../lib/dom/icons.js';
import { h } from '../../lib/dom.js';

/**
 * Create an overview panel with metric cards.
 * @param {Object} options
 * @param {Object} options.data - Overview data
 * @returns {Object} Panel API with el and update method
 */
export function createOverviewPanel({ data }) {
  const el = h('div', { class: 'analytics-section analytics-overview' });

  const cardsContainer = h('div', { class: 'analytics-overview-cards' });

  const cards = {
    views: createCard({
      label: t('analytics.totalViews', 'Total Views'),
      value: formatCount(data?.totalViews || 0),
      icon: 'eye',
    }),
    viewers: createCard({
      label: t('analytics.uniqueViewers', 'Unique Viewers'),
      value: formatCount(data?.uniqueViewers || 0),
      icon: 'user',
    }),
    duration: createCard({
      label: t('analytics.avgTime', 'Avg. Time'),
      value: formatDuration(data?.avgDurationSeconds || 0),
      icon: 'timer',
    }),
    completion: createCard({
      label: t('analytics.completionRate', 'Completion'),
      value: formatPercent(data?.completionRate || 0),
      icon: 'circle-check',
    }),
  };

  cardsContainer.append(
    cards.views.el,
    cards.viewers.el,
    cards.duration.el,
    cards.completion.el,
  );
  el.append(cardsContainer);

  function update(newData) {
    cards.views.update(formatCount(newData?.totalViews || 0));
    cards.viewers.update(formatCount(newData?.uniqueViewers || 0));
    cards.duration.update(formatDuration(newData?.avgDurationSeconds || 0));
    cards.completion.update(formatPercent(newData?.completionRate || 0));
  }

  return { el, update };
}

/**
 * Create a single metric card.
 * @param {Object} options
 * @returns {Object} Card API
 */
function createCard({ label, value, icon }) {
  const valueEl = h('div', { class: 'analytics-card-value', text: value });

  const el = h('div', { class: 'analytics-card' }, [
    h('div', { class: 'analytics-card-icon' }, [
      uiIcon(icon, { size: 24, className: 'analytics-card-icon-img' }),
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
