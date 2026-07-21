/**
 * Public shared report view.
 */

import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';
import { formatDuration, formatDate, getSourceLabel } from '../../lib/analytics-format.js';

/**
 * Render shared report view.
 * @param {HTMLElement} root - Root element
 * @param {string} token - Share token
 * @returns {Promise<Function>} Cleanup function
 */
export async function renderSharedReport(root, token) {
  document.documentElement.classList.add('is-shared-report');

  const shell = h('div', { class: 'shared-report-shell' });
  root.append(shell);

  // Show loading
  shell.append(
    h('div', { class: 'shared-report-loading' }, [
      h('div', { class: 'spinner' }),
      h('div', { text: t('analytics.loadingReport', 'Loading report...') }),
    ])
  );

  // Fetch report
  let report = null;
  try {
    const response = await fetch(`/api/analytics/reports/${encodeURIComponent(token)}`);
    if (!response.ok) {
      throw new Error(response.status === 404 ? 'Report not found or expired' : 'Failed to load report');
    }
    report = await response.json();
  } catch (err) {
    shell.innerHTML = '';
    shell.append(
      h('div', { class: 'shared-report-error' }, [
        h('h1', { text: t('analytics.reportError', 'Report Not Available') }),
        h('p', { text: err.message || 'This report may have expired or been removed.' }),
      ])
    );
    return cleanup;
  }

  // Render report
  shell.innerHTML = '';
  renderReport(report);

  function renderReport(data) {
    const reportData = data.reportData || {};
    const overview = reportData.overview || {};

    // Header
    const header = h('div', { class: 'shared-report-header' }, [
      h('h1', { text: data.title || 'Analytics Report' }),
      h('div', { class: 'shared-report-meta' }, [
        h('span', {
          text: t('analytics.periodRange', 'Period: {start} - {end}', {
            start: formatDate(data.startDate),
            end: formatDate(data.endDate),
          }),
        }),
        h('span', { text: ' · ' }),
        h('span', {
          text: t('analytics.generatedAtDate', 'Generated: {date}', {
            date: formatDate(data.generatedAt),
          }),
        }),
      ]),
    ]);

    // Overview section
    const overviewSection = h('div', { class: 'shared-report-section' }, [
      h('h2', { text: t('analytics.overview', 'Overview') }),
      h('div', { class: 'shared-report-cards' }, [
        createCard(t('analytics.totalViews', 'Total Views'), overview.totalViews || 0),
        createCard(t('analytics.uniqueViewers', 'Unique Viewers'), overview.uniqueViewers || 0),
        createCard(t('analytics.avgTime', 'Avg. Time'), formatDuration(overview.avgDurationSeconds || 0)),
        createCard(t('analytics.completionRate', 'Completion'), `${Math.round((reportData.journey?.completionRate || 0) * 100)}%`),
      ]),
    ]);

    // Views by day chart (simple text version for shared reports)
    const viewsByDay = overview.viewsByDay || [];
    let viewsSection = null;
    if (viewsByDay.length > 0) {
      const maxViews = Math.max(...viewsByDay.map((d) => d.views), 1);
      viewsSection = h('div', { class: 'shared-report-section' }, [
        h('h2', { text: t('analytics.viewsOverTime', 'Views Over Time') }),
        h('div', { class: 'shared-report-chart' }, viewsByDay.map((d) => {
          const barWidth = (d.views / maxViews) * 100;
          return h('div', { class: 'shared-report-chart-row' }, [
            h('span', { class: 'shared-report-chart-label', text: formatDate(d.date) }),
            h('div', { class: 'shared-report-chart-bar-container' }, [
              h('div', { class: 'shared-report-chart-bar', style: `width: ${barWidth}%;` }),
            ]),
            h('span', { class: 'shared-report-chart-value', text: String(d.views) }),
          ]);
        })),
      ]);
    }

    // Slide engagement (for detailed reports)
    const slideEngagement = reportData.slideEngagement || [];
    let slidesSection = null;
    if (slideEngagement.length > 0) {
      slidesSection = h('div', { class: 'shared-report-section' }, [
        h('h2', { text: t('analytics.slideEngagement', 'Slide Engagement') }),
        h('table', { class: 'shared-report-table' }, [
          h('thead', {}, [
            h('tr', {}, [
              h('th', { text: t('analytics.slide', 'Slide') }),
              h('th', { text: t('analytics.views', 'Views') }),
              h('th', { text: t('analytics.avgTime', 'Avg. Time') }),
              h('th', { text: t('analytics.dropoff', 'Dropoff') }),
            ]),
          ]),
          h('tbody', {}, slideEngagement.map((slide) =>
            h('tr', {}, [
              h('td', { text: `Slide ${(slide.slideIndex || 0) + 1}` }),
              h('td', { text: String(slide.views || 0) }),
              h('td', { text: formatDuration(slide.avgTimeSeconds || 0) }),
              h('td', { text: `${Math.round((slide.dropoffRate || 0) * 100)}%` }),
            ])
          )),
        ]),
      ]);
    }

    // Source breakdown
    const sources = overview.topSourceTypes || [];
    let sourcesSection = null;
    if (sources.length > 0) {
      sourcesSection = h('div', { class: 'shared-report-section' }, [
        h('h2', { text: t('analytics.sources', 'Traffic Sources') }),
        h('div', { class: 'shared-report-sources' }, sources.map((source) =>
          h('div', { class: 'shared-report-source' }, [
            h('span', { class: 'shared-report-source-type', text: getSourceLabel(source.type) }),
            h('span', { class: 'shared-report-source-count', text: String(source.count) }),
          ])
        )),
      ]);
    }

    // Footer
    const footer = h('div', { class: 'shared-report-footer' }, [
      h('p', { text: t('analytics.poweredBy', 'Powered by Deckyard Analytics') }),
      h('button', {
        class: 'btn btn-secondary',
        text: t('analytics.print', 'Print Report'),
        onclick: () => window.print(),
      }),
    ]);

    shell.append(header, overviewSection);
    if (viewsSection) shell.append(viewsSection);
    if (slidesSection) shell.append(slidesSection);
    if (sourcesSection) shell.append(sourcesSection);
    shell.append(footer);
  }

  function createCard(label, value) {
    return h('div', { class: 'shared-report-card' }, [
      h('div', { class: 'shared-report-card-value', text: String(value) }),
      h('div', { class: 'shared-report-card-label', text: label }),
    ]);
  }

  function cleanup() {
    document.documentElement.classList.remove('is-shared-report');
  }

  return cleanup;
}