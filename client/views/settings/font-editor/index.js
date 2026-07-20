/**
 * Font Family Editor Component
 * Full editor for creating and editing font families from any source.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { api } from '../../../lib/api.js';
import { toast } from '../../../lib/toast.js';
import { confirmModal } from '../../../lib/modal.js';
import { createUploadPanel } from './upload-panel.js';
import { createAdobePanel } from './adobe-panel.js';
import { createMonotypePanel } from './monotype-panel.js';
import { createGooglePanel } from './google-panel.js';

// Labels carry an i18n key + English fallback; resolved via t() at render time
// (the dictionary is not loaded yet at import time).
const SOURCES = [
  { key: 'upload', labelKey: 'fonts.source.upload', label: 'Upload Custom Font' },
  { key: 'adobe', labelKey: 'fonts.source.adobe', label: 'Adobe Fonts (Typekit)' },
  { key: 'monotype', labelKey: 'fonts.source.monotype', label: 'fonts.com (Monotype)' },
  { key: 'google', labelKey: 'fonts.source.google', label: 'Google Fonts' },
];

const CATEGORIES = [
  { value: 'sans-serif', labelKey: 'fonts.category.sansSerif', label: 'Sans-serif' },
  { value: 'serif', labelKey: 'fonts.category.serif', label: 'Serif' },
  { value: 'display', labelKey: 'fonts.category.display', label: 'Display' },
  { value: 'monospace', labelKey: 'fonts.category.monospace', label: 'Monospace' },
];

/**
 * Create the font family editor.
 * @param {Object} options
 * @param {Object|null} options.fontFamily - Font family to edit, or null for new
 * @param {Function} options.onSave - Save callback (receives saved family)
 * @param {Function} options.onCancel - Cancel callback
 * @param {Function} options.onDelete - Delete callback
 * @returns {{ el: HTMLElement }}
 */
export function createFontEditor({ fontFamily, onSave, onCancel, onDelete }) {
  const isEditing = Boolean(fontFamily?.id);
  const el = h('div', { class: 'font-editor-panel' });

  // State
  const state = {
    name: fontFamily?.name || '',
    source: fontFamily?.source || 'upload',
    category: fontFamily?.category || 'sans-serif',
    sourceConfig: fontFamily?.sourceConfig || {},
    variants: fontFamily?.variants || [],
  };

  // ─── Header ──────────────────────────────────────────────
  const header = h('div', { class: 'font-editor-header' });
  const headerLeft = h('div', { class: 'font-editor-header-title' });

  const backBtn = h('button', {
    class: 'btn btn-secondary btn-icon',
    type: 'button',
    'aria-label': t('common.back', 'Back'),
    title: t('common.back', 'Back'),
    onclick: onCancel,
  });
  backBtn.innerHTML = '&larr;';

  const title = h('h3', {
    class: 'font-editor-title',
    text: isEditing
      ? t('fonts.editFamily', 'Edit Font Family')
      : t('fonts.addFamily', 'Add Font Family'),
  });
  headerLeft.append(backBtn, title);

  const headerActions = h('div', { class: 'row gap-2' });
  const cancelBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('common.cancel', 'Cancel'),
    onclick: onCancel,
  });
  const saveBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: t('common.save', 'Save'),
  });
  headerActions.append(cancelBtn, saveBtn);

  if (isEditing && onDelete) {
    const deleteBtn = h('button', {
      class: 'btn btn-secondary is-danger',
      type: 'button',
      text: t('common.delete', 'Delete'),
      onclick: async () => {
        const confirmed = await confirmModal(h, document.body, {
          title: t('common.delete', 'Delete'),
          message: t('fonts.confirmDelete', 'Delete "{name}" and all its variants?', {
            name: fontFamily.name,
          }),
          confirmLabel: t('common.delete', 'Delete'),
          danger: true,
        });
        if (!confirmed) return;
        try {
          await api(`/api/font-families/${fontFamily.id}`, { method: 'DELETE' });
          toast.success(t('fonts.deleted', 'Font family deleted.'));
          if (onDelete) onDelete();
        } catch (err) {
          toast.error(err.message || t('fonts.deleteError', 'Failed to delete font family.'));
        }
      },
    });
    headerActions.prepend(deleteBtn);
  }

  header.append(headerLeft, headerActions);

  // ─── Source Selector (only for new families) ─────────────
  let sourceSelector = null;
  if (!isEditing) {
    sourceSelector = h('div', { class: 'editor-card stack' });
    sourceSelector.append(
      h('div', { class: 'field-label', text: t('fonts.source', 'Font Source') })
    );

    const sourceGroup = h('div', { class: 'font-source-selector' });

    for (const src of SOURCES) {
      const option = h('label', {
        class: `font-source-option ${src.key === state.source ? 'is-selected' : ''}`,
      });
      const radio = h('input', {
        type: 'radio',
        name: 'font-source',
        value: src.key,
        checked: src.key === state.source,
      });
      radio.addEventListener('change', () => {
        state.source = src.key;
        // Update selected state
        for (const opt of sourceGroup.querySelectorAll('.font-source-option')) {
          opt.classList.toggle('is-selected', opt.querySelector('input').value === src.key);
        }
        updateSourcePanels();
      });
      const label = h('span', { text: t(src.labelKey, src.label) });
      option.append(radio, label);
      sourceGroup.append(option);
    }

    sourceSelector.append(sourceGroup);
  }

  // ─── Common Fields ────────────────────────────────────────
  const commonCard = h('div', { class: 'editor-card stack' });

  const fieldsGrid = h('div', { class: 'font-editor-fields' });

  // Name
  const nameField = h('div', { class: 'stack' });
  nameField.append(h('label', { class: 'field-label', text: t('fonts.familyName', 'Family Name') }));
  const nameInput = h('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Acme Sans',
    value: state.name,
    maxlength: '255',
    oninput: (e) => {
      state.name = e.target.value;
    },
  });
  nameField.append(nameInput);

  // Category
  const categoryField = h('div', { class: 'stack' });
  categoryField.append(
    h('label', { class: 'field-label', text: t('fonts.category', 'Category') })
  );
  const categorySelect = h('select', {
    class: 'select',
    onchange: (e) => {
      state.category = e.target.value;
    },
  });
  for (const cat of CATEGORIES) {
    const opt = h('option', { value: cat.value, text: t(cat.labelKey, cat.label) });
    if (cat.value === state.category) opt.selected = true;
    categorySelect.append(opt);
  }
  categoryField.append(categorySelect);

  fieldsGrid.append(nameField, categoryField);
  commonCard.append(fieldsGrid);

  // ─── Source-specific Panels ───────────────────────────────
  const panelsCard = h('div', { class: 'editor-card' });
  const panels = {};

  // Upload panel (needs familyId for upload API)
  if (isEditing && state.source === 'upload') {
    const uploadPanel = createUploadPanel({
      familyId: fontFamily.id,
      variants: state.variants,
      onVariantChange: (v) => {
        state.variants = v;
      },
    });
    panels.upload = uploadPanel;
  } else if (!isEditing) {
    // For new families, show a message that variants can be uploaded after creation
    const uploadPlaceholder = h('div', { class: 'font-source-panel' });
    uploadPlaceholder.append(
      h('div', {
        class: 'help',
        text: t(
          'fonts.uploadAfterCreate',
          'Save the font family first, then upload font files for each weight and style.'
        ),
      })
    );
    panels.upload = { el: uploadPlaceholder };
  }

  // Adobe panel
  const adobePanel = createAdobePanel({
    sourceConfig: state.sourceConfig,
    onImport: (imported) => {
      if (onSave) onSave(imported);
    },
  });
  panels.adobe = adobePanel;

  // Monotype panel
  const monotypePanel = createMonotypePanel({
    sourceConfig: state.sourceConfig,
    onChange: (config) => {
      state.sourceConfig = config;
    },
  });
  panels.monotype = monotypePanel;

  // Google panel
  const googlePanel = createGooglePanel({
    sourceConfig: state.sourceConfig,
    onChange: (config) => {
      state.sourceConfig = config;
    },
  });
  panels.google = googlePanel;

  // Add all panels
  for (const panel of Object.values(panels)) {
    panelsCard.append(panel.el);
  }

  function updateSourcePanels() {
    for (const [key, panel] of Object.entries(panels)) {
      panel.el.classList.toggle('is-active', key === state.source);
    }
  }
  updateSourcePanels();

  // ─── Save Handler ─────────────────────────────────────────
  saveBtn.addEventListener('click', async () => {
    if (!state.name.trim()) {
      toast.error(t('fonts.errorNameRequired', 'Font family name is required.'));
      nameInput.focus();
      return;
    }

    // For Adobe source with discover flow, the import button handles creation
    // This save is for upload, monotype, and google sources
    if (!isEditing && state.source === 'adobe') {
      toast.error(
        t('fonts.adobeUseImport', 'Use the "Discover Fonts" button above to import Adobe fonts.')
      );
      return;
    }

    saveBtn.disabled = true;
    cancelBtn.disabled = true;

    try {
      // Gather source config from panels
      let sourceConfig = state.sourceConfig;
      if (state.source === 'monotype' && panels.monotype?.getConfig) {
        sourceConfig = panels.monotype.getConfig();
      } else if (state.source === 'google' && panels.google?.getConfig) {
        sourceConfig = panels.google.getConfig();
      }

      const data = {
        name: state.name.trim(),
        category: state.category,
        sourceConfig,
      };

      let result;
      if (isEditing) {
        result = await api(`/api/font-families/${fontFamily.id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        });
      } else {
        data.source = state.source;
        result = await api('/api/font-families', {
          method: 'POST',
          body: JSON.stringify(data),
        });
      }

      toast.success(
        isEditing
          ? t('fonts.updated', 'Font family updated.')
          : t('fonts.created', 'Font family created.')
      );
      if (onSave) onSave(result);
    } catch (err) {
      toast.error(err.message || t('fonts.saveError', 'Failed to save font family.'));
    } finally {
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  });

  // ─── Assemble ──────────────────────────────────────────────
  el.append(header);
  if (sourceSelector) el.append(sourceSelector);
  el.append(commonCard, panelsCard);

  return { el };
}
