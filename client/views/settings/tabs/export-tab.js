/**
 * Data Export Tab Component
 * Allows users to export all their data as a ZIP backup.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { api } from '../../../lib/api.js';

/**
 * Create the data export tab component.
 * @param {Object} options
 * @param {Object} options.user - Current user
 * @returns {Object} { el, load }
 */
export function createExportTab({ user }) {
  const container = h('div', {
    class: 'settings-tab-view',
    id: 'settings-tab-export',
    role: 'tabpanel',
    'aria-labelledby': 'settings-tab-export-btn',
    'data-tab': 'export',
  });

  const title = h('h2', {
    class: 'settings-tab-title',
    text: t('settings.export.title', 'Data Export'),
  });

  const description = h('p', {
    class: 'settings-tab-description',
    text: t(
      'settings.export.description',
      'Download a backup of your presentations and related data as a ZIP archive.'
    ),
  });

  // Options card
  const optionsCard = h('div', { class: 'stack editor-card' });
  optionsCard.append(
    h('div', {
      class: 'field-label',
      text: t('settings.export.optionsTitle', 'Export options'),
    })
  );

  const hint = h('div', {
    class: 'help',
    style: 'margin-bottom: var(--ps-space-3);',
    text: t(
      'settings.export.optionsHint',
      'All your presentations are always included. Select additional data to include:'
    ),
  });
  optionsCard.append(hint);

  // Checkbox options
  const checkboxes = {};

  const createCheckbox = (key, label, description) => {
    const id = `export-opt-${key}`;
    const item = h('label', { class: 'admin-checkbox-item', for: id });
    const input = h('input', { type: 'checkbox', id });
    const text = h('span');

    const labelEl = h('span', {
      style: 'font-size: var(--ps-text-sm); color: hsl(var(--app-text-primary));',
      text: label,
    });
    const descEl = h('div', {
      class: 'help',
      style: 'margin: 0;',
      text: description,
    });
    text.append(labelEl, descEl);
    item.append(input, text);
    checkboxes[key] = input;
    return item;
  };

  const checkboxList = h('div', { class: 'admin-checkbox-list' });
  checkboxList.append(
    createCheckbox(
      'includeVersions',
      t('settings.export.versions', 'Version history'),
      t('settings.export.versionsDesc', 'Saved snapshots and autosaves for each presentation.')
    ),
    createCheckbox(
      'includeImageLibrary',
      t('settings.export.imageLibrary', 'Image library'),
      t('settings.export.imageLibraryDesc', 'Shared image library metadata and referenced images.')
    ),
    createCheckbox(
      'includeSlideLibrary',
      t('settings.export.slideLibrary', 'Slide library'),
      t('settings.export.slideLibraryDesc', 'Personal and team saved slide templates.')
    ),
    createCheckbox(
      'includeThemes',
      t('settings.export.themes', 'Custom themes'),
      t('settings.export.themesDesc', 'Organization theme configurations and logos.')
    ),
  );
  optionsCard.append(checkboxList);

  // Actions area
  const actionsRow = h('div', {
    class: 'bulk-export-actions',
    style: 'margin-top: var(--ps-space-4);',
  });

  const startBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: t('settings.export.start', 'Start export'),
  });

  const cancelBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('settings.export.hideProgress', 'Hide progress'),
    style: 'display: none;',
  });

  actionsRow.append(startBtn, cancelBtn);
  optionsCard.append(actionsRow);

  // Progress section (hidden initially)
  const progressSection = h('div', {
    class: 'bulk-export-progress',
    style: 'display: none; margin-top: var(--ps-space-4);',
  });

  const progressBar = h('div', { class: 'bulk-export-bar' });
  const progressFill = h('div', { class: 'bulk-export-bar-fill' });
  progressBar.append(progressFill);

  const statusText = h('div', {
    class: 'help',
    style: 'margin-top: var(--ps-space-2);',
    text: '',
  });

  progressSection.append(progressBar, statusText);
  optionsCard.append(progressSection);

  // Download section (hidden initially)
  const downloadSection = h('div', {
    style: 'display: none; margin-top: var(--ps-space-3);',
  });

  const downloadBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: t('settings.export.download', 'Download backup'),
  });

  const downloadHint = h('div', {
    class: 'help',
    style: 'margin-top: var(--ps-space-1);',
    text: '',
  });

  downloadSection.append(downloadBtn, downloadHint);
  optionsCard.append(downloadSection);

  const cards = h('div', { class: 'settings-tab-cards' }, [optionsCard]);
  container.append(title, description, cards);

  // ── State ──────────────────────────────────────────────────
  let pollInterval = null;
  let currentJobId = null;
  let sseSource = null;

  function getProgressText(pct) {
    if (pct < 15) return t('settings.export.progress.collecting', 'Collecting presentations...');
    if (pct < 35) return t('settings.export.progress.versions', 'Collecting version history...');
    if (pct < 45) return t('settings.export.progress.images', 'Collecting image library...');
    if (pct < 50) return t('settings.export.progress.slides', 'Collecting slide library...');
    if (pct < 55) return t('settings.export.progress.themes', 'Collecting themes...');
    if (pct < 85) return t('settings.export.progress.downloading', 'Downloading images...');
    if (pct < 95) return t('settings.export.progress.building', 'Building ZIP archive...');
    return t('settings.export.progress.finishing', 'Finishing up...');
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function setExporting(active) {
    startBtn.disabled = active;
    startBtn.style.display = active ? 'none' : '';
    cancelBtn.style.display = active ? '' : 'none';
    progressSection.style.display = active ? '' : 'none';
    downloadSection.style.display = 'none';

    // Disable checkboxes during export
    for (const cb of Object.values(checkboxes)) {
      cb.disabled = active;
    }
  }

  function showDownload(downloadUrl, stats) {
    setExporting(false);
    progressSection.style.display = 'none';
    downloadSection.style.display = '';

    const parts = [];
    if (stats?.presentations != null) {
      parts.push(t('settings.export.presentationCount', '{count} presentation(s)', { count: stats.presentations }));
    }
    if (stats?.size) {
      parts.push(formatBytes(stats.size));
    }
    downloadHint.textContent = parts.length
      ? t('settings.export.readySummary', 'Ready: {summary}', { summary: parts.join(', ') })
      : '';

    downloadBtn.onclick = () => {
      window.location.href = downloadUrl;
    };
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    currentJobId = null;
  }

  function reset() {
    stopPolling();
    setExporting(false);
    progressFill.style.width = '0%';
    statusText.textContent = '';
    downloadSection.style.display = 'none';
  }

  async function pollJobStatus(jobId, downloadUrl) {
    try {
      const status = await api(`/api/jobs/${jobId}`);

      if (status.state === 'completed') {
        stopPolling();
        progressFill.style.width = '100%';
        statusText.textContent = t('settings.export.done', 'Export complete!');
        showDownload(
          status.downloadUrl || downloadUrl,
          status.result,
        );
        return;
      }

      if (status.state === 'failed') {
        stopPolling();
        setExporting(false);
        toast.error(
          t('settings.export.failed', 'Export failed. Please try again.'),
          { id: 'bulk-export' }
        );
        return;
      }

      // Update progress
      const pct = status.progress || 0;
      progressFill.style.width = `${pct}%`;
      statusText.textContent = getProgressText(pct);
    } catch (err) {
      // Network error - keep polling
      console.warn('[export-tab] Poll error:', err.message);
    }
  }

  /**
   * Start polling for an active job.
   * @param {string} jobId - Full job ID
   * @param {string} downloadUrl - Download URL
   */
  function startPollingForJob(jobId, downloadUrl) {
    currentJobId = jobId;
    setExporting(true);
    progressFill.style.width = '0%';
    statusText.textContent = t('settings.export.progress.collecting', 'Collecting presentations...');

    // Poll immediately, then on interval
    pollJobStatus(jobId, downloadUrl);
    pollInterval = setInterval(
      () => pollJobStatus(jobId, downloadUrl),
      2000
    );
  }

  /**
   * Connect to the notification SSE stream to listen for export_ready events.
   */
  function connectSSE() {
    if (sseSource) return;

    try {
      sseSource = new EventSource('/api/notifications/events', { withCredentials: true });

      sseSource.addEventListener('notification:new', (e) => {
        try {
          const notif = JSON.parse(e.data);
          if (notif.notificationType === 'export_ready' && notif.data?.jobId) {
            // Export completed — show download button
            const downloadUrl = `/api/jobs/${notif.data.jobId}/download`;
            stopPolling();
            progressFill.style.width = '100%';
            statusText.textContent = t('settings.export.done', 'Export complete!');
            showDownload(downloadUrl, {
              size: notif.data.size,
            });
          }
        } catch {
          // ignore parse errors
        }
      });

      sseSource.onerror = () => {
        // Don't reconnect — the notification-bell already has its own SSE connection.
        // This is a lightweight supplemental listener for the export tab only.
        disconnectSSE();
      };
    } catch {
      // SSE not available
    }
  }

  function disconnectSSE() {
    if (sseSource) {
      sseSource.close();
      sseSource = null;
    }
  }

  // ── Event handlers ─────────────────────────────────────────
  startBtn.addEventListener('click', async () => {
    if (startBtn.disabled) return;

    const options = {};
    for (const [key, input] of Object.entries(checkboxes)) {
      options[key] = input.checked;
    }

    setExporting(true);
    progressFill.style.width = '0%';
    statusText.textContent = t('settings.export.starting', 'Starting export...');
    downloadSection.style.display = 'none';

    try {
      const resp = await api('/api/bulk-export', {
        method: 'POST',
        body: JSON.stringify(options),
      });

      if (!resp?.ok) {
        throw new Error(resp?.error || 'Failed to start export');
      }

      // If sync (completed immediately), show download right away
      if (resp.sync) {
        progressFill.style.width = '100%';
        statusText.textContent = t('settings.export.done', 'Export complete!');
        showDownload(resp.downloadUrl, null);
        return;
      }

      // Start polling (polls immediately, then every 2s)
      startPollingForJob(resp.jobId, resp.downloadUrl);
    } catch (err) {
      setExporting(false);
      const msg = String(err?.message || err);
      if (msg.includes('429') || msg.includes('already in progress')) {
        toast.error(
          t('settings.export.alreadyRunning', 'An export is already in progress.'),
          { id: 'bulk-export' }
        );
      } else {
        toast.error(msg, { id: 'bulk-export' });
      }
    }
  });

  cancelBtn.addEventListener('click', () => {
    reset();
    toast.info(
      t('settings.export.hiddenNotice', 'Progress hidden. The export continues in the background — you\'ll be notified when it\'s ready.'),
      { id: 'bulk-export', durationMs: 4000 }
    );
  });

  // ── Lifecycle ──────────────────────────────────────────────
  let sseConnected = false;
  const load = async () => {
    // Connect SSE once for real-time export completion events
    if (!sseConnected) {
      sseConnected = true;
      connectSSE();
    }

    // Always re-check status (handles tab re-activation and navigation back)
    if (currentJobId) return; // Already tracking a job

    try {
      const status = await api('/api/bulk-export/status');

      if (status.active && status.jobId) {
        // Resume polling for the active export
        startPollingForJob(status.jobId, status.downloadUrl);
      } else if (status.lastExport) {
        // Show download button for the last completed export
        showDownload(status.lastExport.downloadUrl, null);
      }
    } catch {
      // Status check failed — not critical, user can start a new export
    }
  };

  // Cleanup when tab is destroyed
  const cleanup = () => {
    stopPolling();
    disconnectSSE();
  };

  // Store cleanup for external access
  container._cleanup = cleanup;

  return { el: container, load };
}
