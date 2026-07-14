/**
 * Field List Editor Component
 * Renders an editable list of slide type field definitions.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { confirmModal } from '../../../lib/modal.js';

const FIELD_TYPES = [
  { value: 'string', label: 'String' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'image', label: 'Image' },
  { value: 'images', label: 'Images' },
  { value: 'enum', label: 'Enum' },
  { value: 'items', label: 'Items (repeater)' },
];

/**
 * Create a field list editor.
 * @param {Object} options
 * @param {Array} options.fields - Initial field definitions
 * @param {Function} options.onChange - Called with updated fields array
 * @returns {{ el: HTMLElement, update: Function }}
 */
export function createFieldListEditor({ fields = [], onChange }) {
  const el = h('div', { class: 'field-list-editor' });
  let currentFields = structuredClone(fields);

  function notify() {
    onChange?.(structuredClone(currentFields));
  }

  function render() {
    el.innerHTML = '';

    if (currentFields.length === 0) {
      el.append(h('div', {
        class: 'field-list-empty help',
        text: t('settings.slideTypes.fields.empty', 'No fields defined. Add fields to define the slide content structure.'),
      }));
    }

    for (let i = 0; i < currentFields.length; i++) {
      el.append(renderFieldRow(i));
    }

    // Add field button
    const addBtn = h('button', {
      class: 'btn btn-secondary btn-sm',
      type: 'button',
      text: t('settings.slideTypes.fields.add', '+ Add Field'),
      onclick: () => {
        currentFields.push({
          key: `field${currentFields.length + 1}`,
          type: 'string',
          label: `Field ${currentFields.length + 1}`,
        });
        notify();
        render();
      },
    });
    el.append(addBtn);
  }

  function renderFieldRow(index) {
    const field = currentFields[index];
    const details = h('details', { class: 'field-list-item' });

    // Summary row
    const summary = h('summary', { class: 'field-list-item-summary' });
    const summaryInfo = h('div', { class: 'field-list-item-info' });
    summaryInfo.append(
      h('span', { class: 'field-list-item-label', text: field.label || field.key }),
      h('span', { class: 'field-list-item-type-badge', text: field.type }),
      h('span', { class: 'field-list-item-key', text: field.key })
    );

    const summaryActions = h('div', { class: 'field-list-item-actions' });

    // Reorder buttons
    if (index > 0) {
      summaryActions.append(h('button', {
        class: 'btn btn-secondary btn-icon btn-xs field-list-reorder',
        type: 'button',
        title: t('common.moveUp', 'Move up'),
        'aria-label': t('common.moveUp', 'Move up'),
        text: '\u2191',
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          [currentFields[index - 1], currentFields[index]] = [currentFields[index], currentFields[index - 1]];
          notify();
          render();
        },
      }));
    }

    if (index < currentFields.length - 1) {
      summaryActions.append(h('button', {
        class: 'btn btn-secondary btn-icon btn-xs field-list-reorder',
        type: 'button',
        title: t('common.moveDown', 'Move down'),
        'aria-label': t('common.moveDown', 'Move down'),
        text: '\u2193',
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          [currentFields[index], currentFields[index + 1]] = [currentFields[index + 1], currentFields[index]];
          notify();
          render();
        },
      }));
    }

    // Remove button
    summaryActions.append(h('button', {
      class: 'btn btn-danger btn-icon btn-xs',
      type: 'button',
      title: t('common.remove', 'Remove'),
      'aria-label': t('common.remove', 'Remove'),
      text: '\u00d7',
      onclick: async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const confirmed = await confirmModal(h, document.body, {
          title: t('common.remove', 'Remove'),
          message: t('settings.slideTypes.fields.removeConfirm', `Remove field "${field.label}"?`),
          confirmLabel: t('common.remove', 'Remove'),
          danger: true,
        });
        if (!confirmed) return;
        currentFields.splice(index, 1);
        notify();
        render();
      },
    }));

    summary.append(summaryInfo, summaryActions);

    // Expanded body
    const body = h('div', { class: 'field-list-item-body' });

    // Key
    const keyRow = h('div', { class: 'field-list-field-row' });
    keyRow.append(
      h('label', { class: 'field-label field-label-sm', text: 'Key' }),
      createInput(field.key, (val) => {
        field.key = val.replace(/[^a-zA-Z0-9_]/g, '');
        notify();
      }, { class: 'input input-sm font-mono', placeholder: 'fieldKey' })
    );

    // Label
    const labelRow = h('div', { class: 'field-list-field-row' });
    labelRow.append(
      h('label', { class: 'field-label field-label-sm', text: 'Label' }),
      createInput(field.label, (val) => { field.label = val; notify(); }, { class: 'input input-sm', placeholder: 'Field label' })
    );

    // Type
    const typeRow = h('div', { class: 'field-list-field-row' });
    const typeSelect = h('select', { class: 'input input-sm' });
    for (const ft of FIELD_TYPES) {
      typeSelect.append(h('option', {
        value: ft.value,
        text: ft.label,
        selected: field.type === ft.value,
      }));
    }
    typeSelect.addEventListener('change', () => {
      field.type = typeSelect.value;
      notify();
      render();
    });
    typeRow.append(
      h('label', { class: 'field-label field-label-sm', text: 'Type' }),
      typeSelect
    );

    // Required
    const reqRow = h('div', { class: 'field-list-field-row field-list-field-row-inline' });
    const reqCheckbox = h('input', {
      type: 'checkbox',
      checked: field.required === true,
    });
    reqCheckbox.addEventListener('change', () => { field.required = reqCheckbox.checked; notify(); });
    reqRow.append(reqCheckbox, h('label', { class: 'field-label field-label-sm', text: 'Required' }));

    body.append(keyRow, labelRow, typeRow, reqRow);

    // maxLength (string, markdown)
    if (field.type === 'string' || field.type === 'markdown') {
      const maxRow = h('div', { class: 'field-list-field-row' });
      maxRow.append(
        h('label', { class: 'field-label field-label-sm', text: 'Max length' }),
        createInput(field.maxLength != null ? String(field.maxLength) : '', (val) => {
          const n = parseInt(val, 10);
          field.maxLength = Number.isFinite(n) && n > 0 ? n : undefined;
          notify();
        }, { class: 'input input-sm', type: 'number', placeholder: 'No limit' })
      );
      body.append(maxRow);
    }

    // Placeholder
    const phRow = h('div', { class: 'field-list-field-row' });
    phRow.append(
      h('label', { class: 'field-label field-label-sm', text: 'Placeholder' }),
      createInput(field.placeholder || '', (val) => {
        field.placeholder = val || undefined;
        notify();
      }, { class: 'input input-sm', placeholder: 'Optional placeholder' })
    );
    body.append(phRow);

    // Help text
    const helpRow = h('div', { class: 'field-list-field-row' });
    helpRow.append(
      h('label', { class: 'field-label field-label-sm', text: 'Help text' }),
      createInput(field.helpText || '', (val) => {
        field.helpText = val || undefined;
        notify();
      }, { class: 'input input-sm', placeholder: 'Optional help text' })
    );
    body.append(helpRow);

    // Options (enum)
    if (field.type === 'enum') {
      const optRow = h('div', { class: 'field-list-field-row' });
      const optLabel = h('label', { class: 'field-label field-label-sm', text: 'Options (one per line)' });
      const optArea = h('textarea', {
        class: 'input input-sm code-textarea',
        rows: '4',
        placeholder: 'option1\noption2\noption3',
      });
      optArea.value = Array.isArray(field.options) ? field.options.join('\n') : '';
      optArea.addEventListener('input', () => {
        field.options = optArea.value.split('\n').map(s => s.trim()).filter(Boolean);
        notify();
      });
      optRow.append(optLabel, optArea);
      body.append(optRow);
    }

    // Items sub-fields (nested)
    if (field.type === 'items') {
      const itemsSection = h('div', { class: 'field-list-nested' });
      itemsSection.append(h('div', { class: 'field-label field-label-sm', text: 'Item fields' }));

      const minRow = h('div', { class: 'field-list-field-row' });
      minRow.append(
        h('label', { class: 'field-label field-label-sm', text: 'Min items' }),
        createInput(field.minItems != null ? String(field.minItems) : '', (val) => {
          const n = parseInt(val, 10);
          field.minItems = Number.isFinite(n) && n >= 0 ? n : undefined;
          notify();
        }, { class: 'input input-sm', type: 'number', placeholder: '0' })
      );

      const maxRow = h('div', { class: 'field-list-field-row' });
      maxRow.append(
        h('label', { class: 'field-label field-label-sm', text: 'Max items' }),
        createInput(field.maxItems != null ? String(field.maxItems) : '', (val) => {
          const n = parseInt(val, 10);
          field.maxItems = Number.isFinite(n) && n > 0 ? n : undefined;
          notify();
        }, { class: 'input input-sm', type: 'number', placeholder: 'No limit' })
      );

      const nestedEditor = createFieldListEditor({
        fields: Array.isArray(field.itemFields) ? field.itemFields : [],
        onChange: (subFields) => {
          field.itemFields = subFields;
          notify();
        },
      });

      itemsSection.append(minRow, maxRow, nestedEditor.el);
      body.append(itemsSection);
    }

    details.append(summary, body);
    return details;
  }

  function update(newFields) {
    currentFields = structuredClone(newFields);
    render();
  }

  render();
  return { el, update };
}

function createInput(value, onInput, attrs = {}) {
  const input = h('input', { type: 'text', value, ...attrs });
  input.addEventListener('input', () => onInput(input.value));
  return input;
}
