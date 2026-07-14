/**
 * Slide Type Editor Component
 * Two-column editor for creating and editing custom slide types.
 * Follows the theme-editor layout pattern.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/toast.js';
import { createFieldListEditor } from './field-editor.js';
import { createSlideTypePreview } from './preview.js';

/**
 * Generate a slug from a label.
 * @param {string} label
 * @returns {string}
 */
function generateSlug(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Validate a slug string.
 * @param {string} slug
 * @returns {boolean}
 */
function isValidSlug(slug) {
  if (!slug || typeof slug !== 'string') return false;
  if (slug.length > 80) return false;
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug);
}

/**
 * Try to parse JSON, return null on failure.
 * @param {string} str
 * @returns {Object|null}
 */
function tryParseJson(str) {
  try {
    const obj = JSON.parse(str);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

/**
 * Create the slide type editor component.
 * @param {Object} options
 * @param {Object|null} options.slideType - Existing type to edit, or null for new
 * @param {Object} options.coreTypes - SLIDE_TYPES registry for base type dropdown
 * @param {Function} options.onSave - Called with slide type data
 * @param {Function} options.onCancel - Cancel callback
 * @returns {{ el: HTMLElement }}
 */
export function createSlideTypeEditor({ slideType, coreTypes, onSave, onCancel }) {
  const isEditing = Boolean(slideType?.id);

  const container = h('div', { class: 'slide-type-editor' });

  // ============================================================
  // State
  // ============================================================
  const state = {
    label: slideType?.label || '',
    slug: slideType?.slug || '',
    baseType: slideType?.baseType || '',
    fields: Array.isArray(slideType?.fields) ? structuredClone(slideType.fields) : [],
    defaults: slideType?.defaults || {},
    template: slideType?.template || '',
    css: slideType?.css || '',
    isPublished: slideType?.isPublished === true,
  };

  // JSON string for defaults textarea
  let defaultsJson = Object.keys(state.defaults).length
    ? JSON.stringify(state.defaults, null, 2)
    : '';

  // ============================================================
  // Header
  // ============================================================
  const header = h('div', { class: 'slide-type-editor-header row is-between is-center' });
  const backBtn = h('button', {
    class: 'btn btn-secondary btn-icon',
    type: 'button',
    'aria-label': t('common.back', 'Back'),
    title: t('common.back', 'Back'),
    onclick: onCancel,
  });
  backBtn.innerHTML = '&larr;';

  const headerTitle = h('h3', {
    class: 'slide-type-editor-title',
    text: isEditing
      ? t('settings.slideTypes.editType', 'Edit Slide Type')
      : t('settings.slideTypes.createType', 'Create Slide Type'),
  });

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

  header.append(
    h('div', { class: 'row is-center gap-3' }, [backBtn, headerTitle]),
    headerActions
  );

  // ============================================================
  // Left column: Form
  // ============================================================
  const formColumn = h('div', { class: 'slide-type-editor-form' });

  // --- Name & slug ---
  const nameCard = h('div', { class: 'editor-card stack' });
  nameCard.append(h('div', { class: 'field-label', text: t('settings.slideTypes.name', 'Name') }));

  const nameInput = h('input', {
    class: 'input',
    type: 'text',
    placeholder: t('settings.slideTypes.namePlaceholder', 'My Custom Slide'),
    value: state.label,
    maxlength: '255',
  });
  nameInput.addEventListener('input', () => {
    state.label = nameInput.value;
    // Auto-generate slug for new types
    if (!isEditing) {
      state.slug = generateSlug(nameInput.value);
      slugInput.value = state.slug;
    }
    updatePreview();
  });

  const slugLabel = h('div', {
    class: 'field-label field-label-secondary',
    text: t('settings.slideTypes.slug', 'Slug'),
  });
  const slugInput = h('input', {
    class: 'input font-mono',
    type: 'text',
    placeholder: 'my-custom-slide',
    value: state.slug,
    maxlength: '80',
    readonly: isEditing,
  });
  if (!isEditing) {
    slugInput.addEventListener('input', () => {
      state.slug = slugInput.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
      slugInput.value = state.slug;
    });
  }
  const slugHint = h('div', {
    class: 'help',
    text: isEditing
      ? t('settings.slideTypes.slugReadonly', 'Slug cannot be changed after creation.')
      : t('settings.slideTypes.slugHint', 'Auto-generated from name. Used as the internal type key.'),
  });

  nameCard.append(nameInput, slugLabel, slugInput, slugHint);

  // --- Base type ---
  const baseTypeCard = h('div', { class: 'editor-card stack' });
  baseTypeCard.append(
    h('div', { class: 'field-label', text: t('settings.slideTypes.baseType', 'Base Type') })
  );

  const baseTypeSelect = h('select', { class: 'input' });
  baseTypeSelect.append(h('option', { value: '', text: t('settings.slideTypes.baseTypeNone', '(None)') }));

  const coreTypeKeys = Object.keys(coreTypes || {}).sort((a, b) => {
    const aLabel = coreTypes[a]?.label || a;
    const bLabel = coreTypes[b]?.label || b;
    return String(aLabel).localeCompare(String(bLabel));
  });
  for (const key of coreTypeKeys) {
    baseTypeSelect.append(h('option', {
      value: key,
      text: `${coreTypes[key]?.label || key} (${key})`,
      selected: state.baseType === key,
    }));
  }

  baseTypeSelect.addEventListener('change', () => {
    state.baseType = baseTypeSelect.value;
  });

  const baseTypeHint = h('div', {
    class: 'help',
    text: t('settings.slideTypes.baseTypeHint', 'Optional. The core type this custom type extends. Used for fallback rendering.'),
  });

  baseTypeCard.append(baseTypeSelect, baseTypeHint);

  // --- Fields ---
  const fieldsCard = h('div', { class: 'editor-card stack' });
  fieldsCard.append(
    h('div', { class: 'field-label', text: t('settings.slideTypes.fields', 'Fields') })
  );

  const fieldEditor = createFieldListEditor({
    fields: state.fields,
    onChange: (fields) => {
      state.fields = fields;
      updatePreview();
    },
  });
  fieldsCard.append(fieldEditor.el);

  // --- Defaults ---
  const defaultsCard = h('div', { class: 'editor-card stack' });
  defaultsCard.append(
    h('div', { class: 'field-label', text: t('settings.slideTypes.defaults', 'Defaults (JSON)') })
  );

  const defaultsArea = h('textarea', {
    class: 'input code-textarea',
    rows: '6',
    placeholder: '{\n  "title": "Default Title"\n}',
  });
  defaultsArea.value = defaultsJson;

  const defaultsError = h('div', { class: 'help', style: 'color: hsl(var(--app-danger))' });
  defaultsError.style.display = 'none';

  defaultsArea.addEventListener('input', () => {
    defaultsJson = defaultsArea.value;
    updatePreview();
  });
  defaultsArea.addEventListener('blur', () => {
    if (!defaultsJson.trim()) {
      state.defaults = {};
      defaultsError.style.display = 'none';
      return;
    }
    const parsed = tryParseJson(defaultsJson);
    if (parsed) {
      state.defaults = parsed;
      defaultsError.style.display = 'none';
    } else {
      defaultsError.textContent = t('settings.slideTypes.defaultsInvalid', 'Invalid JSON');
      defaultsError.style.display = '';
    }
  });

  const defaultsHint = h('div', {
    class: 'help',
    text: t('settings.slideTypes.defaultsHint', 'Default field values for new slides of this type.'),
  });

  defaultsCard.append(defaultsArea, defaultsError, defaultsHint);

  // --- Template ---
  const templateCard = h('div', { class: 'editor-card stack' });
  templateCard.append(
    h('div', { class: 'field-label', text: t('settings.slideTypes.template', 'Template (HTML)') })
  );

  const templateArea = h('textarea', {
    class: 'input code-textarea',
    rows: '12',
    placeholder: '<div class="my-slide">\n  <h1>{{esc title}}</h1>\n  {{markdown body}}\n</div>',
  });
  templateArea.value = state.template;
  templateArea.addEventListener('input', () => {
    state.template = templateArea.value;
    updatePreview();
  });

  const templateHint = h('div', { class: 'help' });
  templateHint.innerHTML = 'Syntax: <code>{{esc field}}</code> (escaped), <code>{{markdown field}}</code> (raw HTML), <code>{{#if field}}...{{/if}}</code>, <code>{{#each items}}...{{/each}}</code>';

  templateCard.append(templateArea, templateHint);

  // --- CSS ---
  const cssCard = h('div', { class: 'editor-card stack' });
  cssCard.append(
    h('div', { class: 'field-label', text: t('settings.slideTypes.css', 'Custom CSS') })
  );

  const cssArea = h('textarea', {
    class: 'input code-textarea',
    rows: '8',
    placeholder: '.my-slide {\n  padding: 2em;\n}',
  });
  cssArea.value = state.css;
  cssArea.addEventListener('input', () => {
    state.css = cssArea.value;
    updatePreview();
  });

  const cssHint = h('div', {
    class: 'help',
    text: t('settings.slideTypes.cssHint', 'Scoped CSS injected into the slide rendering context.'),
  });

  cssCard.append(cssArea, cssHint);

  // --- Publish toggle ---
  const publishCard = h('div', { class: 'editor-card stack' });
  publishCard.append(
    h('div', { class: 'field-label', text: t('settings.slideTypes.publish', 'Publish') })
  );

  const publishToggle = h('div', { class: 'slide-type-publish-toggle' });
  const publishCheckboxId = `publish-toggle-${Date.now()}`;
  const publishCheckbox = h('input', {
    type: 'checkbox',
    id: publishCheckboxId,
    checked: state.isPublished,
  });
  publishCheckbox.addEventListener('change', () => {
    state.isPublished = publishCheckbox.checked;
  });
  const publishLabel = h('label', {
    htmlFor: publishCheckboxId,
    text: t('settings.slideTypes.publishLabel', 'Make available in slide picker'),
  });

  publishToggle.append(publishCheckbox, publishLabel);

  const publishHint = h('div', {
    class: 'help',
    text: t('settings.slideTypes.publishHint', 'Draft types are only visible in settings. Published types appear in the slide picker for all users.'),
  });

  publishCard.append(publishToggle, publishHint);

  // Assemble form column
  formColumn.append(nameCard, baseTypeCard, fieldsCard, defaultsCard, templateCard, cssCard, publishCard);

  // ============================================================
  // Right column: Live Preview
  // ============================================================
  const previewColumn = h('div', { class: 'slide-type-editor-preview' });
  const previewLabel = h('div', {
    class: 'field-label',
    text: t('settings.slideTypes.preview', 'Preview'),
  });

  const previewComponent = createSlideTypePreview();
  previewColumn.append(previewLabel, previewComponent.el);

  function updatePreview() {
    // Parse defaults JSON for preview (use last valid parse)
    let previewDefaults = state.defaults;
    if (defaultsJson.trim()) {
      const parsed = tryParseJson(defaultsJson);
      if (parsed) previewDefaults = parsed;
    }

    previewComponent.update({
      template: state.template,
      css: state.css,
      fields: state.fields,
      defaults: previewDefaults,
    });
  }

  // Initial preview render
  updatePreview();

  // ============================================================
  // Main layout
  // ============================================================
  const main = h('div', { class: 'slide-type-editor-main' });
  main.append(formColumn, previewColumn);
  container.append(header, main);

  // ============================================================
  // Save handler
  // ============================================================
  saveBtn.addEventListener('click', async () => {
    // Validate
    if (!state.label.trim()) {
      toast.error(t('settings.slideTypes.errorNameRequired', 'Slide type name is required.'));
      nameInput.focus();
      return;
    }

    if (!isValidSlug(state.slug)) {
      toast.error(t('settings.slideTypes.errorInvalidSlug', 'Invalid slug. Use lowercase letters, numbers, and hyphens.'));
      slugInput.focus();
      return;
    }

    if (state.fields.length === 0) {
      toast.error(t('settings.slideTypes.errorFieldsRequired', 'At least one field is required.'));
      return;
    }

    // Parse defaults if not yet parsed
    if (defaultsJson.trim()) {
      const parsed = tryParseJson(defaultsJson);
      if (!parsed) {
        toast.error(t('settings.slideTypes.errorInvalidDefaults', 'Defaults JSON is invalid.'));
        defaultsArea.focus();
        return;
      }
      state.defaults = parsed;
    } else {
      state.defaults = {};
    }

    const data = {
      label: state.label.trim(),
      slug: state.slug,
      baseType: state.baseType || null,
      fields: state.fields,
      defaults: state.defaults,
      template: state.template || null,
      css: state.css || null,
      isPublished: state.isPublished,
    };

    saveBtn.disabled = true;
    cancelBtn.disabled = true;

    try {
      await onSave(data);
    } finally {
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  });

  return { el: container };
}
