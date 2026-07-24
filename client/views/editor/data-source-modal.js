/**
 * Data source configuration modal.
 *
 * Allows users to connect a slide to an external data source,
 * configure bindings, and preview fetched data.
 */

import { createModal } from '../../lib/dom/modal.js';
import { t } from '../../lib/ui-i18n.js';
import {
  DATA_SOURCE_PROVIDERS,
  BINDABLE_SLIDE_TYPES,
  PROVIDER_LABELS,
  validateDataSource,
} from '../../../shared/data-source.js';

const PROVIDER_OPTIONS = [
  {
    value: 'notion-database',
    label: PROVIDER_LABELS['notion-database'],
    hint: 'Query a Notion database and map properties to slide fields',
    configFields: [
      { key: 'databaseId', label: 'Database ID or URL', type: 'text', placeholder: 'abc123... or https://notion.so/...' },
    ],
  },
  {
    value: 'notion-block',
    label: PROVIDER_LABELS['notion-block'],
    hint: 'Fetch content from a specific Notion page or block',
    configFields: [
      { key: 'pageId', label: 'Page ID or URL', type: 'text', placeholder: 'abc123... or https://notion.so/...' },
    ],
  },
  {
    value: 'csv-url',
    label: PROVIDER_LABELS['csv-url'],
    hint: 'Fetch CSV data from a URL (Google Sheets: File → Share → Publish to web → CSV)',
    configFields: [
      { key: 'url', label: 'CSV URL', type: 'text', placeholder: 'https://docs.google.com/spreadsheets/d/.../gviz/tq?tqx=out:csv' },
    ],
  },
];

export function openDataSourceConfigModal({
  h,
  root,
  slide,
  api,
  markDirty,
  editorState,
  openOverlayClosers,
} = {}) {
  const slideType = slide?.type;
  const bindableInfo = BINDABLE_SLIDE_TYPES[slideType];
  if (!bindableInfo) return;

  const modal = createModal(h, {
    title: t('dataSource.modal.title', 'Connect Data Source'),
    hint: t('dataSource.modal.hint', 'Bind live data to this {type} slide', {
      type: bindableInfo.label,
    }),
    modalClass: 'data-source-modal',
    closeOnBackdrop: true,
  });

  // State
  let selectedProvider = null;
  let configValues = {};
  let previewData = null;
  let bindings = [];

  // Step 1: Provider selection
  const providerSection = h('div', { class: 'data-source-section' });
  const providerLabel = h('div', { class: 'form-label', text: t('dataSource.provider', 'Data source') });
  const providerSelect = h('select', { class: 'form-select' });
  providerSelect.append(h('option', { value: '', text: t('dataSource.selectProvider', 'Select a provider…') }));
  for (const opt of PROVIDER_OPTIONS) {
    providerSelect.append(h('option', { value: opt.value, text: opt.label }));
  }
  providerSection.append(providerLabel, providerSelect);

  // Step 2: Configuration (rendered dynamically)
  const configSection = h('div', { class: 'data-source-section data-source-config' });

  // Step 3: Preview data
  const previewSection = h('div', { class: 'data-source-section data-source-preview' });

  // Step 4: Binding configuration
  const bindingSection = h('div', { class: 'data-source-section data-source-bindings' });

  // Status area
  const statusEl = h('div', { class: 'data-source-modal-status' });

  // Actions
  const actionsRow = h('div', { class: 'row is-end is-mt-8' });
  const previewBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('dataSource.preview', 'Preview data'),
    disabled: true,
  });
  const connectBtn = h('button', {
    class: 'btn btn-primary',
    text: t('dataSource.connect', 'Connect'),
    disabled: true,
  });
  actionsRow.append(previewBtn, connectBtn);

  function renderConfigFields() {
    configSection.innerHTML = '';
    const providerOpt = PROVIDER_OPTIONS.find((p) => p.value === selectedProvider);
    if (!providerOpt) return;

    const hint = h('div', { class: 'help', text: providerOpt.hint });
    configSection.append(hint);

    for (const field of providerOpt.configFields) {
      const wrap = h('div', { class: 'form-group' });
      const label = h('label', { class: 'form-label', text: field.label });
      const input = h('input', {
        type: field.type || 'text',
        class: 'form-input',
        placeholder: field.placeholder || '',
        value: configValues[field.key] || '',
      });
      input.addEventListener('input', () => {
        configValues[field.key] = input.value.trim();
        updateActionStates();
      });
      wrap.append(label, input);
      configSection.append(wrap);
    }
  }

  function updateActionStates() {
    const hasProvider = !!selectedProvider;
    const hasConfig = Object.values(configValues).some((v) => v);
    previewBtn.disabled = !hasProvider || !hasConfig;
    connectBtn.disabled = !previewData || bindings.length === 0;
  }

  function renderPreviewData(data) {
    previewSection.innerHTML = '';
    if (!data) return;

    const heading = h('div', { class: 'form-label', text: t('dataSource.previewData', 'Available data') });
    previewSection.append(heading);

    if (Array.isArray(data)) {
      // Database rows
      const table = h('div', { class: 'data-source-preview-table' });
      const maxRows = Math.min(data.length, 5);

      for (let i = 0; i < maxRows; i++) {
        const row = data[i];
        const rowEl = h('div', { class: 'data-source-preview-row' });
        const rowLabel = h('div', {
          class: 'data-source-preview-row-label',
          text: `row[${i}]`,
        });
        rowEl.append(rowLabel);

        for (const [key, value] of Object.entries(row)) {
          if (key.startsWith('_')) continue;
          const cell = h('div', { class: 'data-source-preview-cell' });
          cell.append(
            h('span', { class: 'data-source-preview-key', text: key }),
            h('span', { class: 'data-source-preview-value', text: String(value || '').slice(0, 60) })
          );
          rowEl.append(cell);
        }
        table.append(rowEl);
      }

      if (data.length > 5) {
        table.append(h('div', { class: 'help', text: `…and ${data.length - 5} more rows` }));
      }
      previewSection.append(table);
    } else if (data?.blocks) {
      // Block content
      for (let i = 0; i < Math.min(data.blocks.length, 10); i++) {
        const block = data.blocks[i];
        const blockEl = h('div', { class: 'data-source-preview-cell' });
        blockEl.append(
          h('span', { class: 'data-source-preview-key', text: `block[${i}]` }),
          h('span', { class: 'data-source-preview-value', text: String(block.text || '').slice(0, 80) })
        );
        previewSection.append(blockEl);
      }
    }
  }

  function renderBindings() {
    bindingSection.innerHTML = '';
    if (!previewData || !bindableInfo) return;

    const heading = h('div', { class: 'form-label', text: t('dataSource.bindings', 'Field bindings') });
    const hint = h('div', {
      class: 'help',
      text: t('dataSource.bindings.hint', 'Map source data to slide fields. Use row[0].PropertyName for databases, or A1/B2 for CSV cells.'),
    });
    bindingSection.append(heading, hint);

    // Pre-populate bindings from bindable fields
    const targets = getConcreteTargets(bindableInfo, slide);
    bindings = [];

    for (const target of targets) {
      const row = h('div', { class: 'data-source-binding-row' });
      const targetLabel = h('span', {
        class: 'data-source-binding-target',
        text: target.path,
        title: target.label,
      });
      const arrow = h('span', { class: 'data-source-binding-arrow', text: '←' });
      const sourceInput = h('input', {
        type: 'text',
        class: 'form-input form-input-sm',
        placeholder: target.sourceHint || 'row[0].Property',
        value: '',
      });
      sourceInput.addEventListener('input', () => {
        const existing = bindings.find((b) => b.target === target.path);
        if (existing) {
          existing.source = sourceInput.value.trim();
        } else if (sourceInput.value.trim()) {
          bindings.push({ target: target.path, source: sourceInput.value.trim() });
        }
        updateActionStates();
      });
      row.append(targetLabel, arrow, sourceInput);
      bindingSection.append(row);
    }
  }

  // Event handlers
  providerSelect.addEventListener('change', () => {
    selectedProvider = providerSelect.value || null;
    configValues = {};
    previewData = null;
    renderConfigFields();
    previewSection.innerHTML = '';
    bindingSection.innerHTML = '';
    updateActionStates();
  });

  previewBtn.addEventListener('click', async () => {
    previewBtn.disabled = true;
    statusEl.textContent = t('dataSource.fetching', 'Fetching data…');
    try {
      const result = await api('/api/data-sources/preview', {
        method: 'POST',
        body: { provider: selectedProvider, config: configValues },
      });
      previewData = result?.data;
      statusEl.textContent = '';
      renderPreviewData(previewData);
      renderBindings();
      updateActionStates();
    } catch (err) {
      statusEl.textContent = t('dataSource.error', 'Error: {message}', {
        message: err.message || t('editor.dataSource.fetchFailed', 'Failed to fetch data'),
      });
    } finally {
      previewBtn.disabled = false;
    }
  });

  connectBtn.addEventListener('click', () => {
    const activeBindings = bindings.filter((b) => b.source);
    if (!activeBindings.length) return;

    const dataSource = {
      provider: selectedProvider,
      config: configValues,
      bindings: activeBindings,
      refresh: { mode: 'frozen' },
      lastSync: new Date().toISOString(),
    };

    const validation = validateDataSource(dataSource);
    if (!validation.valid) {
      statusEl.textContent = validation.error;
      return;
    }

    slide.dataSource = dataSource;
    markDirty?.();
    editorState?.dirtyRefreshAll?.();
    modal.close();
  });

  // Assemble
  modal.content.append(
    providerSection,
    configSection,
    previewSection,
    bindingSection,
    statusEl,
    actionsRow
  );

  modal.show(root, openOverlayClosers);
}

/**
 * Expand wildcard targets (e.g., `metrics[*].value`) into concrete paths
 * based on the current slide content.
 */
function getConcreteTargets(bindableInfo, slide) {
  const targets = [];

  for (const field of bindableInfo.fields) {
    const pattern = field.target;

    if (pattern.includes('[*]')) {
      // Expand wildcard — look at current content to determine count
      const match = pattern.match(/^(\w+)\[\*\]\.(.+)$/);
      if (match) {
        const arrayKey = match[1];
        const subKey = match[2];
        const arr = slide?.content?.[arrayKey];
        const count = Array.isArray(arr) ? arr.length : 4;

        for (let i = 0; i < count; i++) {
          targets.push({
            path: `${arrayKey}[${i}].${subKey}`,
            label: `${field.label} ${i + 1}`,
            sourceHint: field.sourceHint,
          });
        }
      }
    } else {
      targets.push({
        path: pattern,
        label: field.label,
        sourceHint: field.sourceHint,
      });
    }
  }

  return targets;
}
