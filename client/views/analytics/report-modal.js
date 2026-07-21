/**
 * Report generation modal.
 */

import { api } from '../../lib/api.js';
import { t } from '../../lib/ui-i18n.js';

/**
 * Create and show report generation modal.
 * @param {Object} options
 * @param {Function} options.h - DOM helper
 * @param {HTMLElement} options.root - Root element to append modal
 * @param {string} options.presentationId - Presentation ID
 * @param {Object} options.presentation - Presentation data
 * @param {Object} options.dateRange - Current date range
 */
export function createReportModal({ h, root, presentationId, presentation, dateRange }) {
  // State
  let reportType = 'summary';
  let isPublic = true; // Default to public so reports are viewable
  let expiresInDays = 7;
  let isSubmitting = false;

  // Modal backdrop
  const backdrop = h('div', { class: 'modal-backdrop analytics-report-modal-backdrop' });

  // Modal content
  const modal = h('div', { class: 'modal analytics-report-modal' });

  // Header
  const header = h('div', { class: 'modal-header' }, [
    h('h2', { text: t('analytics.generateReport', 'Generate Report') }),
  ]);

  // Close button (uses standard modal-close styling)
  const closeBtn = h('button', {
    class: 'modal-close',
    'aria-label': t('common.close', 'Close'),
    onclick: () => close(),
  });

  // Body
  const body = h('div', { class: 'modal-body' });

  // Report title
  const titleInput = h('input', {
    type: 'text',
    class: 'form-input',
    value: `${presentation?.title || 'Presentation'} - Analytics Report`,
    placeholder: t('analytics.reportTitle', 'Report title'),
  });
  body.append(
    h('div', { class: 'form-group' }, [
      h('label', { text: t('analytics.reportTitle', 'Title') }),
      titleInput,
    ])
  );

  // Report type
  const typeSelect = h('select', {
    class: 'form-input',
    onchange: (e) => { reportType = e.target.value; },
  }, [
    h('option', { value: 'summary', text: t('analytics.reportTypeSummary', 'Summary - Overview metrics and completion rate') }),
    h('option', { value: 'detailed', text: t('analytics.reportTypeDetailed', 'Detailed - Per-slide breakdown and viewer journeys') }),
    h('option', { value: 'engagement', text: t('analytics.reportTypeEngagement', 'Engagement - Polls, Q&A, and feedback') }),
  ]);
  body.append(
    h('div', { class: 'form-group' }, [
      h('label', { text: t('analytics.reportType', 'Report Type') }),
      typeSelect,
    ])
  );

  // Date range display
  const rangeText = dateRange?.since && dateRange?.until
    ? `${dateRange.since} to ${dateRange.until}`
    : t('analytics.allTime', 'All time');
  body.append(
    h('div', { class: 'form-group' }, [
      h('label', { text: t('analytics.dateRange', 'Date Range') }),
      h('div', { class: 'analytics-report-range', text: rangeText }),
    ])
  );

  // Public sharing toggle
  const publicCheckbox = h('input', {
    type: 'checkbox',
    id: 'report-public',
    checked: true, // Default to checked
    onchange: (e) => {
      isPublic = e.target.checked;
      expirationGroup.style.display = isPublic ? 'block' : 'none';
    },
  });
  body.append(
    h('div', { class: 'form-group form-group-checkbox' }, [
      publicCheckbox,
      h('label', { for: 'report-public', text: t('analytics.makePublic', 'Create shareable link') }),
    ])
  );

  // Expiration (visible by default since checkbox is checked)
  const expirationSelect = h('select', {
    class: 'form-input',
    onchange: (e) => { expiresInDays = parseInt(e.target.value, 10); },
  }, [
    h('option', { value: '7', text: t('analytics.expires7Days', '7 days') }),
    h('option', { value: '30', text: t('analytics.expires30Days', '30 days') }),
    h('option', { value: '90', text: t('analytics.expires90Days', '90 days') }),
    h('option', { value: '0', text: t('analytics.neverExpires', 'Never expires') }),
  ]);
  const expirationGroup = h('div', { class: 'form-group' }, [
    h('label', { text: t('analytics.expiration', 'Link expiration') }),
    expirationSelect,
  ]);
  body.append(expirationGroup);

  // Status messages (above footer)
  const errorEl = h('div', { class: 'analytics-report-error', style: 'display: none;' });
  const successEl = h('div', { class: 'analytics-report-success', style: 'display: none;' });
  body.append(errorEl, successEl);

  // Footer
  const submitBtn = h('button', {
    class: 'btn btn-primary',
    text: t('analytics.generate', 'Generate Report'),
    onclick: () => submit(),
  });

  const footer = h('div', { class: 'modal-footer' }, [
    h('button', {
      class: 'btn btn-secondary',
      text: t('common.cancel', 'Cancel'),
      onclick: () => close(),
    }),
    submitBtn,
  ]);

  modal.append(closeBtn, header, body, footer);
  backdrop.append(modal);
  root.append(backdrop);

  // Focus title input
  titleInput.focus();

  // Close on backdrop click
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  // Close on escape
  const handleKeydown = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', handleKeydown);

  async function submit() {
    if (isSubmitting) return;

    const title = titleInput.value.trim();
    if (!title) {
      showError(t('analytics.titleRequired', 'Please enter a title'));
      return;
    }

    isSubmitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = t('common.loading', 'Generating...');
    errorEl.style.display = 'none';

    try {
      const result = await api(`/api/presentations/${presentationId}/analytics/reports`, {
        method: 'POST',
        body: {
          title,
          reportType,
          startDate: dateRange?.since || new Date(0).toISOString(),
          endDate: dateRange?.until || new Date().toISOString(),
          isPublic,
          expiresInDays: isPublic ? expiresInDays : null,
        },
      });

      if (result?.id) {
        showSuccess(result);
      } else {
        throw new Error('Failed to create report');
      }
    } catch (err) {
      showError(err.message || 'Failed to generate report');
    } finally {
      isSubmitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = t('analytics.generate', 'Generate Report');
    }
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }

  function showSuccess(report) {
    successEl.innerHTML = '';
    successEl.style.display = 'block';
    errorEl.style.display = 'none';

    successEl.append(
      h('div', { class: 'analytics-report-success-message' }, [
        h('span', { text: t('analytics.reportGeneratedCheck', '✓ Report generated successfully!') }),
      ])
    );

    if (report.shareToken) {
      const shareUrl = `${window.location.origin}/reports/${report.shareToken}`;
      const linkInput = h('input', {
        type: 'text',
        class: 'form-input',
        value: shareUrl,
        readonly: true,
        onclick: (e) => e.target.select(),
      });
      const copyBtn = h('button', {
        class: 'btn btn-secondary',
        text: t('common.copy', 'Copy'),
        onclick: () => {
          navigator.clipboard?.writeText(shareUrl);
          copyBtn.textContent = t('common.copied', 'Copied!');
          setTimeout(() => {
            copyBtn.textContent = t('common.copy', 'Copy');
          }, 2000);
        },
      });

      successEl.append(
        h('div', { class: 'analytics-report-share-link' }, [
          h('label', { text: t('analytics.shareLink', 'Shareable link:') }),
          h('div', { class: 'analytics-report-share-input' }, [linkInput, copyBtn]),
        ])
      );

      // Add View Report button
      successEl.append(
        h('div', { class: 'analytics-report-actions' }, [
          h('a', {
            href: shareUrl,
            target: '_blank',
            class: 'btn btn-primary',
            text: t('analytics.viewReport', 'View Report'),
          }),
        ])
      );
    } else {
      // No share token - report is private, explain how to access it
      successEl.append(
        h('div', { class: 'analytics-report-private-note' }, [
          h('p', { text: t('analytics.reportSavedPrivate', 'Your report has been saved. Enable "Create shareable link" to generate a viewable link.') }),
        ])
      );
    }

    submitBtn.textContent = t('common.done', 'Done');
    submitBtn.onclick = () => close();
  }

  function close() {
    document.removeEventListener('keydown', handleKeydown);
    backdrop.remove();
  }
}