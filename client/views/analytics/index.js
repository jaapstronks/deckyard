/**
 * Analytics dashboard view for presentation metrics.
 */

import { h } from '../../lib/dom.js';
import { api } from '../../lib/api.js';
import { t } from '../../lib/ui-i18n.js';
import { createOverviewPanel } from './overview-panel.js';
import { createTimelineChart } from './timeline-chart.js';
import { createSlideHeatmap } from './slide-heatmap.js';
import { createViewerList } from './viewer-list.js';
import { createDatePicker } from './date-picker.js';
import { createReportModal } from './report-modal.js';
import { createRealtimeViewer } from './realtime-viewer.js';
import { createLeadsTab } from './leads-tab.js';

/**
 * Render the analytics dashboard for a presentation.
 * @param {HTMLElement} root - Root element
 * @param {string} presentationId - The presentation ID
 * @param {Object} options - Options
 * @param {Function} options.nav - Navigation function
 * @returns {Promise<Function>} Cleanup function
 */
export async function renderAnalytics(root, presentationId, { nav } = {}) {
  document.documentElement.classList.add('is-analytics');

  const shell = h('div', { class: 'analytics-shell' });
  root.append(shell);

  // State
  let presentation = null;
  let dateRange = getDefaultDateRange();
  let overview = null;
  let slideMetrics = null;
  let sessions = null;
  let leads = null;
  let realtimeConnection = null;

  // Show skeleton loading state
  const loading = h('div', { class: 'analytics-content' }, [
    // Skeleton overview cards
    h('div', { class: 'analytics-section' }, [
      h('div', { class: 'analytics-section-header' }, [
        h('div', { class: 'analytics-skeleton analytics-skeleton-text', style: 'width: 120px; height: 20px;' }),
      ]),
      h('div', { class: 'analytics-overview-cards' }, [
        h('div', { class: 'analytics-skeleton analytics-skeleton-card' }),
        h('div', { class: 'analytics-skeleton analytics-skeleton-card' }),
        h('div', { class: 'analytics-skeleton analytics-skeleton-card' }),
        h('div', { class: 'analytics-skeleton analytics-skeleton-card' }),
      ]),
    ]),
    // Skeleton chart
    h('div', { class: 'analytics-section' }, [
      h('div', { class: 'analytics-section-header' }, [
        h('div', { class: 'analytics-skeleton analytics-skeleton-text', style: 'width: 140px; height: 20px;' }),
      ]),
      h('div', { class: 'analytics-skeleton analytics-skeleton-chart' }),
    ]),
    // Skeleton table rows
    h('div', { class: 'analytics-section' }, [
      h('div', { class: 'analytics-section-header' }, [
        h('div', { class: 'analytics-skeleton analytics-skeleton-text', style: 'width: 160px; height: 20px;' }),
      ]),
      h('div', {}, [
        h('div', { class: 'analytics-skeleton analytics-skeleton-row' }),
        h('div', { class: 'analytics-skeleton analytics-skeleton-row' }),
        h('div', { class: 'analytics-skeleton analytics-skeleton-row' }),
      ]),
    ]),
  ]);
  shell.append(loading);

  // Load presentation data
  try {
    presentation = await api(`/api/presentations/${presentationId}`);
    if (!presentation) {
      throw new Error('Presentation not found');
    }
  } catch (err) {
    shell.innerHTML = '';
    shell.append(h('div', { class: 'analytics-error' }, [
      h('div', { class: 'analytics-error-text', text: err.message || 'Failed to load presentation' }),
      h('button', {
        class: 'btn btn-secondary',
        text: t('common.back', 'Back'),
        onclick: () => nav?.('/app'),
      }),
    ]));
    return cleanup;
  }

  // Load initial analytics data
  await loadAnalyticsData();

  // Render dashboard
  shell.innerHTML = '';
  renderDashboard();

  async function loadAnalyticsData() {
    const params = new URLSearchParams();
    if (dateRange.since) params.set('since', dateRange.since);
    if (dateRange.until) params.set('until', dateRange.until);

    try {
      [overview, slideMetrics, sessions, leads] = await Promise.all([
        api(`/api/presentations/${presentationId}/analytics?${params}`),
        api(`/api/presentations/${presentationId}/analytics/slides?${params}`),
        api(`/api/presentations/${presentationId}/analytics/sessions?${params}&limit=10`),
        api(`/api/presentations/${presentationId}/leads?limit=50`).catch(() => ({ leads: [], total: 0 })),
      ]);
    } catch {
      overview = { totalViews: 0, uniqueViewers: 0, avgDurationSeconds: 0, viewsByDay: [], topSourceTypes: [] };
      slideMetrics = { slides: [] };
      sessions = { sessions: [], total: 0 };
      leads = { leads: [], total: 0 };
    }
  }

  function renderDashboard() {
    // Topbar
    const topbar = h('div', { class: 'analytics-topbar' }, [
      h('button', {
        class: 'btn btn-secondary btn-icon',
        text: '←',
        title: t('common.back', 'Back'),
        onclick: () => nav?.(`/app/${presentationId}`),
      }),
      h('div', { class: 'analytics-title' }, [
        h('span', { text: t('analytics.title', 'Presentation Analytics') }),
        h('span', { class: 'analytics-pres-name', text: presentation.title || 'Untitled' }),
      ]),
      h('div', { class: 'analytics-topbar-spacer' }),
    ]);

    // Date picker
    const datePicker = createDatePicker({
      h,
      initialRange: dateRange,
      onChange: async (newRange) => {
        dateRange = newRange;
        await loadAnalyticsData();
        updateDashboard();
      },
    });
    topbar.append(datePicker.el);

    // Settings/actions
    const actions = h('div', { class: 'analytics-actions' }, [
      h('button', {
        class: 'btn btn-secondary',
        text: t('analytics.generateReport', 'Generate Report'),
        onclick: () => openReportModal(),
      }),
    ]);
    topbar.append(actions);

    // Main content
    const content = h('div', { class: 'analytics-content' });

    // Overview panel
    const overviewPanel = createOverviewPanel({
      h,
      data: overview,
    });
    content.append(overviewPanel.el);

    // Real-time viewer count
    realtimeConnection = createRealtimeViewer({
      h,
      presentationId,
    });
    overviewPanel.el.querySelector('.analytics-overview-cards')?.append(realtimeConnection.el);

    // Timeline chart
    const timeline = createTimelineChart({
      h,
      data: overview?.viewsByDay || [],
    });
    content.append(timeline.el);

    // Slide heatmap
    const heatmap = createSlideHeatmap({
      h,
      slides: slideMetrics?.slides || [],
      presentation,
    });
    content.append(heatmap.el);

    // Viewer list
    const viewerList = createViewerList({
      h,
      sessions: sessions?.sessions || [],
      total: sessions?.total || 0,
      onLoadMore: async (offset) => {
        const params = new URLSearchParams();
        if (dateRange.since) params.set('since', dateRange.since);
        if (dateRange.until) params.set('until', dateRange.until);
        params.set('limit', '20');
        params.set('offset', String(offset));
        const more = await api(`/api/presentations/${presentationId}/analytics/sessions?${params}`);
        return more?.sessions || [];
      },
      onGenerateReport: () => openReportModal(),
    });
    content.append(viewerList.el);

    // Leads tab
    const leadsTab = createLeadsTab({
      h,
      presentationId,
      leads: leads?.leads || [],
      total: leads?.total || 0,
    });
    content.append(leadsTab.el);

    shell.append(topbar, content);

    // Store references for updates
    shell._overviewPanel = overviewPanel;
    shell._timeline = timeline;
    shell._heatmap = heatmap;
    shell._viewerList = viewerList;
    shell._leadsTab = leadsTab;
  }

  function updateDashboard() {
    shell._overviewPanel?.update(overview);
    shell._timeline?.update(overview?.viewsByDay || []);
    shell._heatmap?.update(slideMetrics?.slides || []);
    shell._viewerList?.update(sessions?.sessions || [], sessions?.total || 0);
    shell._leadsTab?.update(leads?.leads || [], leads?.total || 0);
  }

  function openReportModal() {
    createReportModal({
      h,
      root,
      presentationId,
      presentation,
      dateRange,
    });
  }

  function cleanup() {
    document.documentElement.classList.remove('is-analytics');
    realtimeConnection?.destroy?.();
  }

  return cleanup;
}

/**
 * Get default date range (last 30 days).
 * @returns {{since: string, until: string}}
 */
function getDefaultDateRange() {
  const until = new Date();
  const since = new Date();
  since.setDate(since.getDate() - 30);

  return {
    since: since.toISOString().split('T')[0],
    until: until.toISOString().split('T')[0],
  };
}