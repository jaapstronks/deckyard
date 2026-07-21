/**
 * Leads tab for analytics view.
 * Shows captured leads with ability to export and delete.
 */

import { t } from '../../lib/ui-i18n.js';
import { confirmModal } from '../../lib/dom/modal.js';
import { fmtRelativeTime } from '../../lib/user/user-format.js';
import { api } from '../../lib/api.js';
import { iconUrl } from '../../../shared/icon-names.js';

/**
 * Create leads tab component.
 * @param {Object} options
 * @param {Function} options.h - DOM helper
 * @param {string} options.presentationId - Presentation ID
 * @param {Array} [options.leads] - Initial leads data
 * @param {number} [options.total] - Total lead count
 * @param {Function} [options.onDelete] - Callback when a lead is deleted
 * @returns {Object} Tab API with el, update, and refresh methods
 */
export function createLeadsTab({ h, presentationId, leads = [], total = 0, onDelete }) {
  const el = h('div', { class: 'analytics-section analytics-leads' });

  const header = h('div', { class: 'analytics-section-header' }, [
    h('h3', { text: t('analytics.leads', 'Leads') }),
    h('div', { class: 'analytics-leads-actions' }, [
      h('button', {
        class: 'btn btn-secondary analytics-leads-export',
        text: t('analytics.exportCSV', 'Export CSV'),
        onclick: () => handleExport(),
      }),
    ]),
  ]);

  const countBadge = h('span', { class: 'analytics-leads-count' });
  header.querySelector('h3')?.append(countBadge);

  const container = h('div', { class: 'analytics-leads-container', role: 'grid', 'aria-label': t('analytics.leads', 'Leads') });
  const loadMoreBtn = h('button', {
    class: 'btn btn-secondary analytics-load-more',
    text: t('analytics.loadMore', 'Load More'),
    style: 'display: none;',
  });

  el.append(header, container, loadMoreBtn);

  let currentLeads = leads || [];
  let currentTotal = total;
  let loadedCount = currentLeads.length;

  renderList();
  updateCountBadge();

  function renderList() {
    container.innerHTML = '';

    if (currentLeads.length === 0) {
      container.append(
        h('div', { class: 'analytics-empty-state' }, [
          h('img', { class: 'analytics-empty-state-icon', src: iconUrl('mail'), alt: '', 'aria-hidden': 'true' }),
          h('p', { class: 'analytics-empty-state-title', text: t('analytics.noLeadsYet', 'No leads captured yet') }),
          h('p', { class: 'analytics-empty-state-description', text: t('analytics.addLeadCaptureHint', 'Add a Lead Capture slide to your presentation to start collecting contact information from viewers.') }),
        ])
      );
      loadMoreBtn.style.display = 'none';
      return;
    }

    // Table header
    const tableHeader = h('div', { class: 'analytics-lead-row analytics-lead-header', role: 'row' }, [
      h('div', { class: 'analytics-lead-cell analytics-lead-cell-name', role: 'columnheader', text: t('analytics.name', 'Name') }),
      h('div', { class: 'analytics-lead-cell analytics-lead-cell-email', role: 'columnheader', text: t('analytics.email', 'Email') }),
      h('div', { class: 'analytics-lead-cell analytics-lead-cell-date', role: 'columnheader', text: t('analytics.submitted', 'Submitted') }),
      h('div', { class: 'analytics-lead-cell analytics-lead-cell-actions', role: 'columnheader', text: '' }),
    ]);
    container.append(tableHeader);

    // Lead rows
    currentLeads.forEach((lead) => {
      const row = createLeadRow(h, lead);
      container.append(row);
    });

    // Show/hide load more button
    if (loadedCount < currentTotal) {
      loadMoreBtn.style.display = 'block';
      loadMoreBtn.onclick = () => handleLoadMore();
    } else {
      loadMoreBtn.style.display = 'none';
    }
  }

  function createLeadRow(h, lead) {
    const row = h('div', { class: 'analytics-lead-row', role: 'row', 'data-lead-id': lead.id }, [
      h('div', { class: 'analytics-lead-cell analytics-lead-cell-name', role: 'gridcell', 'data-label': '' }, [
        h('span', { class: 'analytics-lead-name', text: lead.name }),
      ]),
      h('div', { class: 'analytics-lead-cell analytics-lead-cell-email', role: 'gridcell', 'data-label': t('analytics.email', 'Email') }, [
        h('a', { href: `mailto:${lead.email}`, class: 'analytics-lead-email', text: lead.email }),
      ]),
      h('div', { class: 'analytics-lead-cell analytics-lead-cell-date', role: 'gridcell', 'data-label': t('analytics.submitted', 'Submitted') }, [
        h('span', { class: 'analytics-lead-date', text: fmtRelativeTime(lead.submittedAt) }),
        h('span', { class: 'analytics-lead-date-full', text: formatDate(lead.submittedAt) }),
      ]),
      h('div', { class: 'analytics-lead-cell analytics-lead-cell-actions', role: 'gridcell', 'data-label': '' }, [
        h('button', {
          class: 'btn btn-sm btn-danger-text analytics-lead-delete',
          text: t('common.delete', 'Delete'),
          title: t('analytics.deleteLead', 'Delete this lead'),
          onclick: (e) => handleDelete(e, lead),
        }),
      ]),
    ]);

    return row;
  }

  async function handleLoadMore() {
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = t('common.loading', 'Loading...');

    try {
      const result = await api(`/api/presentations/${presentationId}/leads?offset=${loadedCount}&limit=50`);
      if (result?.leads && result.leads.length > 0) {
        currentLeads = [...currentLeads, ...result.leads];
        loadedCount = currentLeads.length;
        renderList();
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[leads] Failed to load more:', err);
      loadMoreBtn.textContent = t('analytics.loadFailed', 'Failed to load');
      setTimeout(() => {
        loadMoreBtn.textContent = t('analytics.loadMore', 'Load More');
      }, 2000);
    } finally {
      loadMoreBtn.disabled = false;
    }
  }

  async function handleExport() {
    const exportBtn = el.querySelector('.analytics-leads-export');
    if (exportBtn) {
      exportBtn.disabled = true;
      exportBtn.textContent = t('common.exporting', 'Exporting...');
    }

    try {
      // Trigger download via API
      const url = `/api/presentations/${presentationId}/leads/export`;
      const link = document.createElement('a');
      link.href = url;
      link.download = `leads-${presentationId.slice(0, 8)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[leads] Failed to export:', err);
    } finally {
      if (exportBtn) {
        exportBtn.disabled = false;
        exportBtn.textContent = t('analytics.exportCSV', 'Export CSV');
      }
    }
  }

  async function handleDelete(e, lead) {
    const btn = e.target;
    if (!(await confirmModal(h, document.body, {
      title: t('common.delete', 'Delete'),
      message: t('analytics.confirmDeleteLead', 'Are you sure you want to delete this lead? This action cannot be undone.'),
      confirmLabel: t('common.delete', 'Delete'),
      danger: true,
    }))) {
      return;
    }

    btn.disabled = true;
    btn.textContent = t('common.deleting', 'Deleting...');

    try {
      await api(`/api/leads/${lead.id}`, { method: 'DELETE' });

      // Remove from list
      currentLeads = currentLeads.filter((l) => l.id !== lead.id);
      currentTotal = Math.max(0, currentTotal - 1);
      loadedCount = currentLeads.length;
      renderList();
      updateCountBadge();

      onDelete?.(lead);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[leads] Failed to delete:', err);
      btn.textContent = t('common.failed', 'Failed');
      setTimeout(() => {
        btn.textContent = t('common.delete', 'Delete');
        btn.disabled = false;
      }, 2000);
    }
  }

  function updateCountBadge() {
    countBadge.textContent = currentTotal > 0 ? ` (${currentTotal})` : '';
  }

  function update(newLeads, newTotal) {
    currentLeads = newLeads || [];
    currentTotal = newTotal;
    loadedCount = currentLeads.length;
    renderList();
    updateCountBadge();
  }

  async function refresh() {
    try {
      const result = await api(`/api/presentations/${presentationId}/leads?limit=50`);
      if (result) {
        update(result.leads || [], result.total || 0);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[leads] Failed to refresh:', err);
    }
  }

  return {
    el,
    update,
    refresh,
    getCount: () => currentTotal,
  };
}

/**
 * Format date for display.
 * @param {string} isoDate - ISO date string
 * @returns {string} Formatted date
 */
function formatDate(isoDate) {
  if (!isoDate) return '-';
  try {
    return new Date(isoDate).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '-';
  }
}
