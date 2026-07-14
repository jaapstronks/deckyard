/**
 * Data source indicator and controls for the slide editor.
 *
 * Shows connection status, refresh controls, and a link to
 * the data source configuration modal.
 */

import { t } from '../../lib/ui-i18n.js';
import { REFRESH_MODES, BINDABLE_SLIDE_TYPES, PROVIDER_LABELS } from '../../../shared/data-source.js';

const MODE_LABELS = {
  frozen: 'Snapshot',
  manual: 'Manual refresh',
  'on-view': 'Live (auto)',
};

/**
 * Build the data source indicator bar for a slide.
 * Returns null if the slide has no data source or the feature is disabled.
 */
export function buildDataSourceIndicator({
  h,
  slide,
  pres,
  api,
  markDirty,
  editorState,
  features,
  openOverlayClosers,
} = {}) {
  const flags = features && typeof features === 'object' ? features : {};
  if (!flags.enableLiveData) return null;

  const ds = slide?.dataSource;
  const slideType = slide?.type;
  const isBindable = !!(slideType && BINDABLE_SLIDE_TYPES[slideType]);

  // No data source and not a bindable type — nothing to show
  if (!ds && !isBindable) return null;

  const bar = h('div', { class: 'data-source-bar' });

  if (ds) {
    // Connected state
    const isFrozen = ds.refresh?.mode === 'frozen';
    const providerLabel = PROVIDER_LABELS[ds.provider] || ds.provider;
    const modeLabel = MODE_LABELS[ds.refresh?.mode] || ds.refresh?.mode;

    bar.classList.add(isFrozen ? 'data-source-bar--frozen' : 'data-source-bar--live');

    // Status indicator
    const statusDot = h('span', {
      class: `data-source-dot ${isFrozen ? 'data-source-dot--frozen' : 'data-source-dot--live'}`,
    });
    const statusText = h('span', {
      class: 'data-source-status',
      text: isFrozen
        ? t('dataSource.snapshot', 'Snapshot from {date}', {
            date: ds.lastSync ? new Date(ds.lastSync).toLocaleDateString() : '—',
          })
        : t('dataSource.connected', 'Connected to {provider}', { provider: providerLabel }),
    });

    const statusRow = h('div', { class: 'data-source-status-row' }, [statusDot, statusText]);
    bar.append(statusRow);

    // Actions row
    const actionsRow = h('div', { class: 'data-source-actions' });

    // Refresh button (for non-frozen modes, or as "Pull latest" for frozen)
    const refreshBtn = h('button', {
      class: 'btn btn-xs btn-secondary',
      text: isFrozen
        ? t('dataSource.pullLatest', 'Pull latest')
        : t('dataSource.refresh', 'Refresh'),
      onclick: async () => {
        refreshBtn.disabled = true;
        refreshBtn.textContent = t('dataSource.refreshing', 'Refreshing…');
        try {
          const result = await api('/api/data-sources/refresh', {
            method: 'POST',
            body: {
              dataSource: { ...ds, refresh: { mode: 'manual' } },
              content: slide.content,
              presentationId: pres?.id,
              slideId: slide.id,
            },
          });
          if (result?.content) {
            slide.content = result.content;
            slide.dataSource = {
              ...ds,
              lastSync: result.lastSync,
            };
            markDirty?.();
            editorState?.dirtyRefreshAll?.();
          }
        } catch (err) {
          console.warn('[data-source] Refresh failed:', err.message);
        } finally {
          refreshBtn.disabled = false;
          refreshBtn.textContent = isFrozen
            ? t('dataSource.pullLatest', 'Pull latest')
            : t('dataSource.refresh', 'Refresh');
        }
      },
    });
    actionsRow.append(refreshBtn);

    // Mode switcher
    const modeSelect = h('select', {
      class: 'form-select form-select-xs',
      'aria-label': t('dataSource.mode', 'Refresh mode'),
    });
    for (const mode of REFRESH_MODES) {
      const opt = h('option', {
        value: mode,
        text: MODE_LABELS[mode] || mode,
        selected: ds.refresh?.mode === mode ? '' : undefined,
      });
      if (ds.refresh?.mode === mode) opt.selected = true;
      modeSelect.append(opt);
    }
    modeSelect.addEventListener('change', () => {
      slide.dataSource = {
        ...ds,
        refresh: { mode: modeSelect.value },
      };
      markDirty?.();
      editorState?.dirtyRefreshAll?.();
    });
    actionsRow.append(modeSelect);

    // Disconnect button
    const disconnectBtn = h('button', {
      class: 'btn btn-xs btn-ghost',
      text: t('dataSource.disconnect', 'Disconnect'),
      title: t('dataSource.disconnect.title', 'Remove data source connection'),
      onclick: () => {
        delete slide.dataSource;
        markDirty?.();
        editorState?.dirtyRefreshAll?.();
      },
    });
    actionsRow.append(disconnectBtn);

    bar.append(actionsRow);
  } else {
    // No data source yet — show "Connect" prompt
    bar.classList.add('data-source-bar--empty');

    const connectBtn = h('button', {
      class: 'btn btn-xs btn-secondary',
      text: t('dataSource.connect', 'Connect data source'),
      title: t('dataSource.connect.title', 'Bind this slide to live data from Notion, CSV, or an API'),
      onclick: () => {
        openDataSourceModal({
          h,
          root: document.body,
          slide,
          pres,
          api,
          markDirty,
          editorState,
          openOverlayClosers,
        });
      },
    });

    bar.append(connectBtn);
  }

  return bar;
}

/**
 * Open the data source configuration modal.
 */
function openDataSourceModal({
  h,
  root,
  slide,
  pres,
  api,
  markDirty,
  editorState,
  openOverlayClosers,
} = {}) {
  // Lazy import to avoid circular deps
  import('./data-source-modal.js').then(({ openDataSourceConfigModal }) => {
    openDataSourceConfigModal({
      h,
      root,
      slide,
      pres,
      api,
      markDirty,
      editorState,
      openOverlayClosers,
    });
  }).catch(err => {
    console.error('Failed to load data source modal:', err);
  });
}
