/**
 * API Key Usage Panel - displays usage statistics for an API key.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { fetchKeyUsage } from './actions.js';

/**
 * Show usage stats modal for an API key.
 * @param {Object} key - The API key
 */
export async function showUsagePanel(key) {
  const overlay = h('div', { class: 'modal-overlay' });
  const modal = h('div', { class: 'modal api-key-usage-modal' });

  const modalTitle = h('h3', {
    text: t('settings.apiKeys.usageModal.title', 'API Key Usage'),
  });

  const keyInfo = h('div', { class: 'api-key-usage-info' }, [
    h('strong', { text: key.name }),
    h('code', { class: 'api-key-prefix', text: `${key.prefix}...` }),
  ]);

  const loading = h('div', { class: 'help', text: t('common.loading', 'Loading...') });
  const content = h('div', { class: 'api-key-usage-content' });
  content.append(loading);

  const btnClose = h('button', {
    class: 'btn btn-secondary',
    text: t('common.close', 'Close'),
    type: 'button',
  });

  btnClose.onclick = () => overlay.remove();
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  const btnRow = h('div', { class: 'row is-end', style: 'margin-top: 16px;' });
  btnRow.append(btnClose);

  modal.append(modalTitle, keyInfo, content, btnRow);
  overlay.append(modal);
  document.body.append(overlay);

  // Fetch and display usage data
  const result = await fetchKeyUsage(key.id, 30);

  if (result.error) {
    content.innerHTML = '';
    content.append(h('div', { class: 'help', text: result.error }));
    return;
  }

  const usage = result.usage;
  content.innerHTML = '';

  // Today's stats
  const todaySection = h('div', { class: 'api-key-usage-section' });
  todaySection.append(
    h('h4', { text: t('settings.apiKeys.usageModal.today', 'Today') }),
    h('div', { class: 'api-key-usage-stats' }, [
      createStatCard(t('settings.apiKeys.usageModal.requests', 'Requests'), usage.today?.requestCount || 0),
      createStatCard(t('settings.apiKeys.usageModal.aiCalls', 'AI Calls'), usage.today?.aiRequestCount || 0),
      createStatCard(t('settings.apiKeys.usageModal.exports', 'Exports'), usage.today?.exportCount || 0),
    ])
  );

  // Totals
  const totalsSection = h('div', { class: 'api-key-usage-section' });
  const totals = usage.totals || {};
  totalsSection.append(
    h('h4', { text: t('settings.apiKeys.usageModal.totals', 'Total (Last ' + (usage.days || 30) + ' Days)') }),
    h('div', { class: 'api-key-usage-stats' }, [
      createStatCard(t('settings.apiKeys.usageModal.requests', 'Requests'), totals.requestCount || 0),
      createStatCard(t('settings.apiKeys.usageModal.aiCalls', 'AI Calls'), totals.aiRequestCount || 0),
      createStatCard(t('settings.apiKeys.usageModal.exports', 'Exports'), totals.exportCount || 0),
    ])
  );

  // History (last 7 days)
  const historySection = h('div', { class: 'api-key-usage-section' });
  historySection.append(
    h('h4', { text: t('settings.apiKeys.usageModal.recentHistory', 'Last 7 Days') })
  );

  if (usage.history && usage.history.length > 0) {
    const table = h('table', { class: 'api-key-usage-table' });
    const thead = h('thead');
    thead.append(
      h('tr', {}, [
        h('th', { text: t('settings.apiKeys.usageModal.date', 'Date') }),
        h('th', { text: t('settings.apiKeys.usageModal.requests', 'Requests') }),
        h('th', { text: t('settings.apiKeys.usageModal.aiCalls', 'AI Calls') }),
        h('th', { text: t('settings.apiKeys.usageModal.exports', 'Exports') }),
      ])
    );

    const tbody = h('tbody');
    for (const day of usage.history.slice(0, 7)) {
      tbody.append(
        h('tr', {}, [
          h('td', { text: new Date(day.date).toLocaleDateString() }),
          h('td', { text: String(day.requestCount || 0) }),
          h('td', { text: String(day.aiRequestCount || 0) }),
          h('td', { text: String(day.exportCount || 0) }),
        ])
      );
    }

    table.append(thead, tbody);
    historySection.append(table);
  } else {
    historySection.append(
      h('p', { class: 'help', text: t('settings.apiKeys.usageModal.noHistory', 'No usage history yet.') })
    );
  }

  content.append(todaySection, totalsSection, historySection);
}

/**
 * Create a stat card element.
 * @param {string} label - Stat label
 * @param {number} value - Stat value
 * @returns {HTMLElement}
 */
function createStatCard(label, value) {
  return h('div', { class: 'api-key-stat-card' }, [
    h('div', { class: 'api-key-stat-value', text: String(value) }),
    h('div', { class: 'api-key-stat-label', text: label }),
  ]);
}
