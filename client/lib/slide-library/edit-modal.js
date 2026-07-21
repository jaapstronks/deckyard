/**
 * Slide Library Edit Modal
 * Allows editing slide content directly in the library
 */

import { t } from '../ui-i18n.js';
import { toast } from '../dom/toast.js';
import { renderSlideElement } from '../slide-runtime/slide-render.js';
import { cleanStr } from '../../../shared/string-utils.js';
import { SLIDE_TYPES } from '../../../shared/slide-types.js';

/**
 * Field types that we support editing in the library
 */
const EDITABLE_FIELD_TYPES = ['string', 'markdown', 'text'];

/**
 * Field types that need a textarea (multi-line)
 */
const MULTILINE_TYPES = ['markdown', 'text'];

/**
 * Fields to skip in the editor (complex types that need the full editor)
 */
const SKIP_FIELD_KEYS = [
  'background',
  'actions',
  'cards',
  'items',
  'logos',
  'members',
  'images',
  'image',
  'icon',
  'video',
  'embed',
  'chartData',
  'tableData',
  'data',
  'options',
  'pollId',
  'layout', // enum - could be added later
];

/**
 * Create a field editor element
 */
function createFieldEditor(h, field, value, onChange) {
  const { key, label, type, maxLength, placeholder, helpText } = field;
  const isMultiline = MULTILINE_TYPES.includes(type);

  const wrap = h('div', { class: 'field ps-lib-edit-field' });
  const labelEl = h('label', {
    class: 'field-label',
    text: label || key,
    for: `lib-edit-${key}`,
  });

  let input;
  if (isMultiline) {
    input = h('textarea', {
      class: 'form-input',
      id: `lib-edit-${key}`,
      rows: type === 'markdown' ? 6 : 3,
      placeholder: placeholder || '',
      maxlength: maxLength || undefined,
    });
    input.value = value || '';
  } else {
    input = h('input', {
      class: 'form-input',
      type: 'text',
      id: `lib-edit-${key}`,
      placeholder: placeholder || '',
      maxlength: maxLength || undefined,
      value: value || '',
    });
  }

  input.addEventListener('input', () => {
    onChange(key, input.value);
  });

  wrap.append(labelEl, input);

  if (helpText) {
    wrap.append(h('div', { class: 'help is-small', text: helpText }));
  }

  return wrap;
}

/**
 * Open the edit modal for a slide library item
 */
export function openEditModal({
  h,
  item,
  scope,
  apiOps,
  resolveThemeForItem,
  onClose,
  rerender,
} = {}) {
  const slideType = cleanStr(item?.slideType);
  const def = SLIDE_TYPES[slideType];

  if (!def) {
    toast.error(t('slideLibrary.edit.unsupportedType', 'Cannot edit this slide type.'));
    return;
  }

  // Get editable fields
  const fields = (def.fields || []).filter((f) => {
    if (SKIP_FIELD_KEYS.includes(f.key)) return false;
    if (!EDITABLE_FIELD_TYPES.includes(f.type)) return false;
    return true;
  });

  if (fields.length === 0) {
    toast.error(t('slideLibrary.edit.noEditableFields', 'This slide type has no editable text fields.'));
    return;
  }

  // Working copy of the content
  const workingContent = { ...(item.content || {}) };
  let workingName = item.name || '';

  // Create modal elements
  const backdrop = h('div', { class: 'modal-backdrop ps-modal-overlay' });
  const modal = h('div', { class: 'modal ps-modal ps-lib-edit-modal' });

  // Header
  const header = h('div', { class: 'ps-modal-header' });
  const title = h('h2', { text: t('slideLibrary.edit.title', 'Edit slide') });
  const closeBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('common.cancel', 'Cancel'),
    onclick: () => close(false),
  });
  header.append(title, closeBtn);

  // Body with two columns: form and preview
  const body = h('div', { class: 'ps-modal-body ps-lib-edit-body' });

  // Form column
  const formCol = h('div', { class: 'ps-lib-edit-form' });
  const form = h('div', { class: 'stack' });

  // Name field (always editable)
  const nameField = h('div', { class: 'field ps-lib-edit-field' });
  const nameLabel = h('label', {
    class: 'field-label',
    text: t('slideLibrary.edit.name', 'Name'),
    for: 'lib-edit-name',
  });
  const nameInput = h('input', {
    class: 'form-input',
    type: 'text',
    id: 'lib-edit-name',
    placeholder: t('slideLibrary.edit.namePlaceholder', 'Slide name...'),
    maxlength: 120,
    value: workingName,
  });
  nameInput.addEventListener('input', () => {
    workingName = nameInput.value;
  });
  nameField.append(nameLabel, nameInput);
  form.append(nameField);

  // Content fields
  const updatePreview = async () => {
    const slide = {
      id: 'lib-edit-preview',
      type: slideType,
      content: workingContent,
    };
    const thTheme = await resolveThemeForItem(item);
    previewThumb.innerHTML = '';
    const slideEl = renderSlideElement(slide, { theme: thTheme });
    previewThumb.appendChild(slideEl);

    // Scale the slide to fit the preview container
    requestAnimationFrame(() => {
      const containerRect = previewThumb.getBoundingClientRect();
      const slideW = 1600;
      const slideH = 900;
      const scale = Math.min(
        (containerRect.width - 24) / slideW,
        (containerRect.height - 24) / slideH,
        0.5
      );
      previewThumb.style.setProperty('--thumb-scale', String(scale));
    });
  };

  // Debounced preview update
  let previewTimeout = null;
  const schedulePreviewUpdate = () => {
    if (previewTimeout) clearTimeout(previewTimeout);
    previewTimeout = setTimeout(updatePreview, 150);
  };

  for (const field of fields) {
    const fieldEl = createFieldEditor(h, field, workingContent[field.key], (key, val) => {
      workingContent[key] = val;
      schedulePreviewUpdate();
    });
    form.append(fieldEl);
  }

  formCol.append(form);

  // Preview column
  const previewCol = h('div', { class: 'ps-lib-edit-preview' });
  const previewLabel = h('div', { class: 'field-label', text: t('slideLibrary.edit.preview', 'Preview') });
  const previewThumb = h('div', { class: 'thumb ps-lib-edit-preview-thumb' });
  previewCol.append(previewLabel, previewThumb);

  body.append(formCol, previewCol);

  // Footer with save button
  const footer = h('div', { class: 'ps-modal-footer' });
  const status = h('div', { class: 'help modal-status', text: '' });
  const saveBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: t('common.save', 'Save'),
  });

  let saving = false;
  saveBtn.addEventListener('click', async () => {
    const name = String(workingName || '').trim();
    if (!name) {
      status.textContent = t('slideLibrary.edit.nameRequired', 'Please enter a name.');
      nameInput.focus();
      return;
    }

    if (saving) return;
    saving = true;
    saveBtn.disabled = true;
    status.textContent = t('common.saving', 'Saving...');

    const patch = {
      name,
      content: workingContent,
    };

    const result = await apiOps.saveSlide(scope, item, patch, { rerender });

    if (result.ok) {
      toast.success(t('slideLibrary.edit.saved', 'Slide saved.'));
      // Update the item reference for the lightbox
      if (result.item) {
        Object.assign(item, result.item);
      }
      close(true);
    } else {
      status.textContent = String(result.error?.message || result.error || t('common.saveFailed', 'Save failed'));
      toast.error(t('slideLibrary.edit.saveFailed', 'Failed to save slide.'));
      saving = false;
      saveBtn.disabled = false;
    }
  });

  footer.append(status, saveBtn);

  modal.append(header, body, footer);
  backdrop.append(modal);
  document.body.append(backdrop);

  // Initial preview
  updatePreview();

  // Focus name input
  try {
    nameInput.focus();
    nameInput.select();
  } catch {
    // ignore
  }

  // Close handlers
  const onKey = (e) => {
    if (e.key === 'Escape') close(false);
  };
  document.addEventListener('keydown', onKey);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close(false);
  });

  function close(saved) {
    document.removeEventListener('keydown', onKey);
    if (previewTimeout) clearTimeout(previewTimeout);
    backdrop.remove();
    onClose?.(saved);
  }
}
