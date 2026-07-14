/**
 * Combined Analytics Dashboard - Aggregate insights across all user presentations.
 */

import { h } from '../../lib/dom.js';
import { api } from '../../lib/api.js';
import { t } from '../../lib/ui-i18n.js';
import { iconUrl } from '../../../shared/icon-names.js';
import { createDashboardCards } from './dashboard-cards.js';
import { createDashboardChart } from './dashboard-chart.js';
import { createTopPresentations } from './top-presentations.js';

/**
 * Render the combined analytics dashboard.
 * @param {HTMLElement} root - Root element
 * @param {Object} options - Options
 * @param {Function} options.nav - Navigation function
 * @returns {Promise<Function>} Cleanup function
 */
export async function renderDashboard(root, { nav } = {}) {
  document.documentElement.classList.add('is-analytics');

  // Create page wrapper with topbar
  const page = h('div', { class: 'dashboard-page' });

  // Topbar with back navigation
  const topbar = h('header', { class: 'dashboard-topbar' }, [
    h('a', {
      href: '/',
      class: 'dashboard-back-btn',
      onclick: (e) => {
        e.preventDefault();
        if (nav) nav('/');
        else window.location.href = '/';
      },
    }, [
      h('svg', {
        width: '20',
        height: '20',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }, [
        h('path', { d: 'M19 12H5' }),
        h('path', { d: 'M12 19l-7-7 7-7' }),
      ]),
      h('span', { text: t('dashboard.back', 'Back to presentations') }),
    ]),
  ]);

  const shell = h('div', { class: 'dashboard-shell' });
  page.append(topbar, shell);
  root.append(page);

  // State
  let period = '30d';
  let category = 'all';
  let dashboardData = null;
  let loadError = null;

  // Show loading state
  const loading = h('div', { class: 'analytics-loading' }, [
    h('div', { class: 'spinner' }),
    h('div', { class: 'analytics-loading-text', text: t('dashboard.loading', 'Loading insights...') }),
  ]);
  shell.append(loading);

  // Load initial data
  await loadDashboardData();

  // Render dashboard
  shell.innerHTML = '';
  render();

  async function loadDashboardData() {
    loadError = null;
    try {
      dashboardData = await api(`/api/analytics/dashboard?period=${period}&category=${category}`);
    } catch (err) {
      loadError = err?.message || t('dashboard.error', 'Failed to load insights');
      dashboardData = {
        summary: { totalViews: 0, uniqueViewers: 0, avgDurationSeconds: 0, completionRate: 0 },
        trend: { percentChange: 0, direction: 'flat' },
        timeline: [],
        topPresentations: [],
        sourceBreakdown: { shareLink: 0, published: 0, follow: 0, embed: 0 },
      };
    }
  }

  function render() {
    shell.innerHTML = '';

    // Show error banner if there was a load error
    if (loadError) {
      const errorBanner = h('div', { class: 'dashboard-error-banner', role: 'alert' }, [
        h('img', { class: 'dashboard-error-icon', src: iconUrl('circle-alert'), alt: '', 'aria-hidden': 'true' }),
        h('span', { text: loadError }),
      ]);
      shell.append(errorBanner);
    }

    // Header
    const header = h('div', { class: 'dashboard-header' }, [
      h('div', { class: 'dashboard-title-row' }, [
        h('h1', { class: 'dashboard-title', text: t('dashboard.title', 'My Engagement Insights') }),
        createPeriodSelector(),
      ]),
    ]);

    // Summary cards
    const cards = createDashboardCards({
      summary: dashboardData.summary,
      trend: dashboardData.trend,
    });

    // Timeline chart
    const chart = createDashboardChart({
      timeline: dashboardData.timeline,
      period,
    });

    // Two-column layout for bottom section
    const bottomRow = h('div', { class: 'dashboard-bottom-row' }, [
      createTopPresentations({
        presentations: dashboardData.topPresentations,
        nav,
      }),
      createSourceBreakdown(),
    ]);

    shell.append(header, cards, chart, bottomRow);
  }

  function createPeriodSelector() {
    const id = 'dashboard-period-select';
    const label = h('label', {
      for: id,
      class: 'visually-hidden',
      text: t('dashboard.periodLabel', 'Time period'),
    });
    const select = h('select', {
      id,
      class: 'dashboard-period-select',
      'aria-label': t('dashboard.periodLabel', 'Time period'),
      onchange: async (e) => {
        period = e.target.value;
        shell.innerHTML = '';
        shell.append(loading);
        await loadDashboardData();
        render();
      },
    }, [
      h('option', { value: '7d', text: t('dashboard.period.7d', 'Last 7 days'), selected: period === '7d' }),
      h('option', { value: '30d', text: t('dashboard.period.30d', 'Last 30 days'), selected: period === '30d' }),
      h('option', { value: '90d', text: t('dashboard.period.90d', 'Last 90 days'), selected: period === '90d' }),
      h('option', { value: '12m', text: t('dashboard.period.12m', 'Last 12 months'), selected: period === '12m' }),
    ]);
    select.value = period;
    const wrapper = h('div', { class: 'dashboard-period-wrapper' }, [label, select]);
    return wrapper;
  }

  function createSourceBreakdown() {
    const breakdown = dashboardData.sourceBreakdown || {};
    const total = breakdown.shareLink + breakdown.published + breakdown.follow + breakdown.embed;

    const sources = [
      { key: 'shareLink', label: t('dashboard.source.shareLink', 'Share Links'), value: breakdown.shareLink || 0 },
      { key: 'published', label: t('dashboard.source.published', 'Published'), value: breakdown.published || 0 },
      { key: 'follow', label: t('dashboard.source.follow', 'Follow Mode'), value: breakdown.follow || 0 },
      { key: 'embed', label: t('dashboard.source.embed', 'Embedded'), value: breakdown.embed || 0 },
    ].filter((s) => s.value > 0);

    const card = h('div', { class: 'dashboard-card dashboard-source-card' }, [
      h('h3', { class: 'dashboard-card-title', text: t('dashboard.source.title', 'Engagement by Source') }),
    ]);

    if (!sources.length) {
      card.append(h('div', { class: 'dashboard-empty', text: t('dashboard.source.empty', 'No data yet') }));
      return card;
    }

    const bars = h('div', { class: 'dashboard-source-bars' });
    for (const source of sources) {
      const percent = total > 0 ? Math.round((source.value / total) * 100) : 0;
      bars.append(
        h('div', { class: 'dashboard-source-row' }, [
          h('div', { class: 'dashboard-source-bar-wrap' }, [
            h('div', {
              class: `dashboard-source-bar dashboard-source-bar-${source.key}`,
              style: `width: ${percent}%`,
            }),
          ]),
          h('span', { class: 'dashboard-source-label', text: `${source.label} (${percent}%)` }),
        ])
      );
    }
    card.append(bars);

    return card;
  }

  function cleanup() {
    document.documentElement.classList.remove('is-analytics');
    page.remove();
  }

  return cleanup;
}
