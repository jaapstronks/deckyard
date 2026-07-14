/**
 * Top performing presentations table component.
 */

import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';
import { formatDuration as formatDurationBase } from '../../lib/analytics-format.js';

/**
 * Format duration in seconds to human readable.
 * @param {number} seconds - Duration in seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  if (!seconds || seconds < 1) return '—';
  return formatDurationBase(seconds, { short: true });
}

/**
 * Create top presentations table.
 * @param {Object} options
 * @param {Array} options.presentations - Top presentations data
 * @param {Function} options.nav - Navigation function
 * @returns {HTMLElement}
 */
export function createTopPresentations({ presentations, nav }) {
  const card = h('div', { class: 'dashboard-card dashboard-top-card' }, [
    h('h3', { class: 'dashboard-card-title', text: t('dashboard.top.title', 'Top Performing Presentations') }),
  ]);

  if (!presentations || !presentations.length) {
    card.append(
      h('div', { class: 'dashboard-empty', text: t('dashboard.top.empty', 'No presentations with views yet') })
    );
    return card;
  }

  const table = h('table', { class: 'dashboard-top-table', role: 'table' }, [
    h('thead', {}, [
      h('tr', {}, [
        h('th', { scope: 'col', text: t('dashboard.top.presentation', 'Presentation') }),
        h('th', { scope: 'col', class: 'dashboard-top-num', text: t('dashboard.top.views', 'Views') }),
        h('th', { scope: 'col', class: 'dashboard-top-num', text: t('dashboard.top.avgDuration', 'Avg Duration') }),
        h('th', { scope: 'col', class: 'dashboard-top-num', text: t('dashboard.top.completion', 'Completion') }),
      ]),
    ]),
  ]);

  const tbody = h('tbody');
  for (const pres of presentations) {
    const row = h('tr', { class: 'dashboard-top-row' }, [
      h('td', { class: 'dashboard-top-name' }, [
        h('a', {
          href: `/analytics/${pres.id}`,
          text: pres.title || 'Untitled',
          onclick: (e) => {
            e.preventDefault();
            nav?.(`/analytics/${pres.id}`);
          },
        }),
      ]),
      h('td', { class: 'dashboard-top-num', text: String(pres.views || 0) }),
      h('td', { class: 'dashboard-top-num', text: formatDuration(pres.avgDurationSeconds) }),
      h('td', { class: 'dashboard-top-num', text: pres.completionRate > 0 ? `${Math.round(pres.completionRate * 100)}%` : '—' }),
    ]);
    tbody.append(row);
  }

  table.append(tbody);
  card.append(table);

  return card;
}
