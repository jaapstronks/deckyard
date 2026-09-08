/**
 * Field List Editor Component
 * Renders an editable list of slide type field definitions.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { confirmModal } from '../../../lib/dom/modal.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import {
  CUSTOM_TYPE_FIELD_TYPES,
  CUSTOM_TYPE_PROPERTY_KEYS,
} from '../../../../shared/slide-types/custom-field-definitions.js';
import {
  headableKeys,
  offeredProperties,
} from '../../../../shared/slide-types/field-definitions.js';
import { enumOptionValues } from '../../../../shared/slide-types/field-types.js';

// The dropdown offers exactly the types the storage layer accepts, in that
// module's order — a seventh option here would be a control for something no
// save can keep. Labels are resolved through t() at render time (the dictionary
// is not loaded at import time).
const FIELD_TYPE_LABELS = {
  string: ['settings.slideTypes.fields.type.string', 'String'],
  markdown: ['settings.slideTypes.fields.type.markdown', 'Markdown'],
  image: ['settings.slideTypes.fields.type.image', 'Image'],
  images: ['settings.slideTypes.fields.type.images', 'Images'],
  enum: ['settings.slideTypes.fields.type.enum', 'Enum'],
  items: ['settings.slideTypes.fields.type.items', 'Items (repeater)'],
};

/**
 * Create a field list editor.
 * @param {Object} options
 * @param {Array} options.fields - Initial field definitions
 * @param {Function} options.onChange - Called with updated fields array
 * @returns {{ el: HTMLElement, update: Function, showProblem: Function, clearProblem: Function }}
 */
export function createFieldListEditor({ fields = [], onChange }) {
  const el = h('div', { class: 'field-list-editor' });
  let currentFields = structuredClone(fields);
  /** @type {{index: number, itemIndex: number|null, message: string}|null} */
  let problem = null;
  // Which rows the user had expanded, keyed on the field object itself so a
  // reorder or a removal carries the state with the row. A row is re-created on
  // every render (a type change rebuilds the body), and a `<details>` that
  // closes itself on change hides the very sub-editor the change just revealed —
  // which is how an `items` field ends up saved with no item fields (B200).
  const openRows = new WeakSet();
  // Controls whose choices are other rows: an item-heading select reads the
  // sub-fields, a fold target reads its own options, a media link reads its
  // string siblings. They are rebuilt on every edit at this level rather than
  // re-rendered, because a re-render per keystroke steals focus from the very
  // row being typed in.
  /** @type {Array<() => void>} */
  let refreshers = [];

  function notify() {
    // Any edit invalidates the located problem: it named a row that may no
    // longer be the offending one. Cleared silently — the callers that also
    // restructure the list call render() right after, and a re-render per
    // keystroke would steal focus.
    if (problem) {
      problem = null;
      for (const node of el.querySelectorAll('.inline-error')) {
        node.remove();
      }
      for (const node of el.querySelectorAll('.field-list-item.is-invalid')) {
        node.classList.remove('is-invalid');
      }
    }
    onChange?.(structuredClone(currentFields));
    for (const refresh of refreshers) refresh();
  }

  function render() {
    el.innerHTML = '';
    refreshers = [];

    if (currentFields.length === 0) {
      el.append(
        h('div', {
          class: 'empty-note',
          text: t(
            'settings.slideTypes.fields.empty',
            'No fields defined. Add fields to define the slide content structure.',
          ),
        }),
      );
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

  /**
   * The string fields beside `field` at this level: the only ones a
   * `mediaRef.linkKey` may name. A declaration that no longer names one is kept
   * as a choice rather than silently re-pointed — the walk warns about it, and
   * a select that quietly swaps the author's answer would hide that.
   * @param {Object} field
   * @returns {string[]}
   */
  function linkKeyChoices(field) {
    const siblings = currentFields
      .filter((f) => f !== field && f?.type === 'string' && f.key?.trim())
      .map((f) => f.key.trim());
    const declared = field.mediaRef?.linkKey;
    return declared && !siblings.includes(declared)
      ? [...siblings, declared]
      : siblings;
  }

  /**
   * The sub-fields that could head an item, from the shared walk, plus a
   * declaration that no longer names one — same reason as above.
   * @param {Object} field
   * @returns {string[]}
   */
  function itemHeadingChoices(field) {
    const headable = [...headableKeys(field.itemFields)];
    const declared = field.itemLabelField;
    return declared && !headable.includes(declared)
      ? [...headable, declared]
      : headable;
  }

  function renderFieldRow(index) {
    const field = currentFields[index];
    const rowProblem = problem?.index === index ? problem : null;
    const details = h('details', { class: 'field-list-item' });
    // A row keeps the state the user left it in, and a located problem forces
    // its row open — an error the user has to hunt for is barely an error.
    details.open = openRows.has(field) || Boolean(rowProblem);
    if (rowProblem) details.classList.add('is-invalid');
    details.addEventListener('toggle', () => {
      if (details.open) openRows.add(field);
      else openRows.delete(field);
    });

    // Summary row
    const summary = h('summary', { class: 'field-list-item-summary' });
    const summaryInfo = h('div', { class: 'field-list-item-info' });
    summaryInfo.append(
      h('span', {
        class: 'field-list-item-label',
        text: field.label || field.key,
      }),
      h('span', { class: 'field-list-item-type-badge', text: field.type }),
      h('span', { class: 'field-list-item-key', text: field.key }),
    );

    const summaryActions = h('div', { class: 'field-list-item-actions' });

    // Reorder buttons
    if (index > 0) {
      summaryActions.append(
        h('button', {
          class: 'btn btn-secondary btn-icon btn-xs field-list-reorder',
          type: 'button',
          title: t('common.moveUp', 'Move up'),
          'aria-label': t('common.moveUp', 'Move up'),
          text: '\u2191',
          onclick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            [currentFields[index - 1], currentFields[index]] = [
              currentFields[index],
              currentFields[index - 1],
            ];
            notify();
            render();
          },
        }),
      );
    }

    if (index < currentFields.length - 1) {
      summaryActions.append(
        h('button', {
          class: 'btn btn-secondary btn-icon btn-xs field-list-reorder',
          type: 'button',
          title: t('common.moveDown', 'Move down'),
          'aria-label': t('common.moveDown', 'Move down'),
          text: '\u2193',
          onclick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            [currentFields[index], currentFields[index + 1]] = [
              currentFields[index + 1],
              currentFields[index],
            ];
            notify();
            render();
          },
        }),
      );
    }

    // Remove button
    summaryActions.append(
      h('button', {
        class: 'btn btn-danger btn-icon btn-xs',
        type: 'button',
        title: t('common.remove', 'Remove'),
        'aria-label': t('common.remove', 'Remove'),
        text: '\u00d7',
        onclick: async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const confirmed = await confirmModal(document.body, {
            title: t('common.remove', 'Remove'),
            message: t(
              'settings.slideTypes.fields.removeConfirm',
              'Remove field "{label}"?',
              {
                label: field.label,
              },
            ),
            confirmLabel: t('common.remove', 'Remove'),
            danger: true,
          });
          if (!confirmed) return;
          currentFields.splice(index, 1);
          notify();
          render();
        },
      }),
    );

    summary.append(summaryInfo, summaryActions);

    // Expanded body
    const body = h('div', { class: 'field-list-item-body' });

    // The problem sits at the top of the body when it is this field's own; a
    // nested one is shown by the sub-editor, at the sub-row it belongs to. The
    // row is a group, not a control, so the message stands on its own and the
    // caller decides where focus lands (the row's summary).
    if (rowProblem && rowProblem.itemIndex == null) {
      const rowError = createInlineError();
      rowError.show(rowProblem.message, { focus: false });
      body.append(rowError.el);
    }

    // Key
    const keyRow = h('div', { class: 'field-list-field-row' });
    keyRow.append(
      h('label', {
        class: 'field-label field-label-sm',
        text: t('settings.slideTypes.fields.key', 'Key'),
      }),
      createInput(
        field.key,
        (val) => {
          field.key = val.replace(/[^a-zA-Z0-9_]/g, '');
          notify();
        },
        {
          class: 'form-input form-input-sm font-mono',
          placeholder: 'fieldKey',
        },
      ),
    );

    // Label
    const labelRow = h('div', { class: 'field-list-field-row' });
    labelRow.append(
      h('label', {
        class: 'field-label field-label-sm',
        text: t('settings.slideTypes.fields.label', 'Label'),
      }),
      createInput(
        field.label,
        (val) => {
          field.label = val;
          notify();
        },
        {
          class: 'form-input form-input-sm',
          placeholder: t(
            'settings.slideTypes.fields.labelPlaceholder',
            'Field label',
          ),
        },
      ),
    );

    // Type
    const typeRow = h('div', { class: 'field-list-field-row' });
    const typeSelect = h('select', { class: 'form-input form-input-sm' });
    for (const value of CUSTOM_TYPE_FIELD_TYPES) {
      const [key, fallback] = FIELD_TYPE_LABELS[value] || [null, value];
      typeSelect.append(
        h('option', {
          value,
          text: key ? t(key, fallback) : fallback,
          selected: field.type === value,
        }),
      );
    }
    typeSelect.addEventListener('change', () => {
      field.type = typeSelect.value;
      // The stored vocabulary is read per type (D84), so a property the old
      // type carried is one a Save would now refuse with no control left on
      // screen to clear it — a `maxLength` on a string that became an enum.
      const offered = offeredProperties(CUSTOM_TYPE_PROPERTY_KEYS, field.type);
      for (const property of Object.keys(field)) {
        if (!offered.has(property)) delete field[property];
      }
      notify();
      render();
    });
    typeRow.append(
      h('label', {
        class: 'field-label field-label-sm',
        text: t('settings.slideTypes.fields.typeLabel', 'Type'),
      }),
      typeSelect,
    );

    // Required
    const reqRow = h('div', {
      class: 'field-list-field-row field-list-field-row-inline',
    });
    const reqCheckbox = h('input', {
      type: 'checkbox',
      checked: field.required === true,
    });
    reqCheckbox.addEventListener('change', () => {
      field.required = reqCheckbox.checked;
      notify();
    });
    reqRow.append(
      reqCheckbox,
      h('label', {
        class: 'field-label field-label-sm',
        text: t('settings.slideTypes.fields.required', 'Required'),
      }),
    );

    body.append(keyRow, labelRow, typeRow, reqRow);

    // maxLength (string, markdown)
    if (field.type === 'string' || field.type === 'markdown') {
      const maxRow = h('div', { class: 'field-list-field-row' });
      maxRow.append(
        h('label', {
          class: 'field-label field-label-sm',
          text: t('settings.slideTypes.fields.maxLength', 'Max length'),
        }),
        createInput(
          field.maxLength != null ? String(field.maxLength) : '',
          (val) => {
            const n = parseInt(val, 10);
            field.maxLength = Number.isFinite(n) && n > 0 ? n : undefined;
            notify();
          },
          {
            class: 'form-input form-input-sm',
            type: 'number',
            placeholder: t('settings.slideTypes.fields.noLimit', 'No limit'),
          },
        ),
      );
      body.append(maxRow);
    }

    // Placeholder
    const phRow = h('div', { class: 'field-list-field-row' });
    phRow.append(
      h('label', {
        class: 'field-label field-label-sm',
        text: t('settings.slideTypes.fields.placeholder', 'Placeholder'),
      }),
      createInput(
        field.placeholder || '',
        (val) => {
          field.placeholder = val || undefined;
          notify();
        },
        {
          class: 'form-input form-input-sm',
          placeholder: t(
            'settings.slideTypes.fields.placeholderPlaceholder',
            'Optional placeholder',
          ),
        },
      ),
    );
    body.append(phRow);

    // Help text
    const helpRow = h('div', { class: 'field-list-field-row' });
    helpRow.append(
      h('label', {
        class: 'field-label field-label-sm',
        text: t('settings.slideTypes.fields.helpText', 'Help text'),
      }),
      createInput(
        field.helpText || '',
        (val) => {
          field.helpText = val || undefined;
          notify();
        },
        {
          class: 'form-input form-input-sm',
          placeholder: t(
            'settings.slideTypes.fields.helpTextPlaceholder',
            'Optional help text',
          ),
        },
      ),
    );
    body.append(helpRow);

    // Media reference (string) — A2.2/D82's declaration, D84's control. A DB
    // type shows a player through its template just as `video-slide` does, so
    // the document projection needs the same stand-in: the reference is not
    // document text and must not be printed as if it were.
    if (field.type === 'string') {
      const mediaRow = h('div', {
        class: 'field-list-field-row field-list-field-row-inline',
      });
      const mediaToggle = h('input', {
        type: 'checkbox',
        checked: Boolean(field.mediaRef),
      });
      mediaToggle.addEventListener('change', () => {
        if (mediaToggle.checked) field.mediaRef = {};
        else delete field.mediaRef;
        notify();
        render();
      });
      mediaRow.append(
        mediaToggle,
        h('label', {
          class: 'field-label field-label-sm',
          text: t(
            'settings.slideTypes.fields.mediaRef',
            'References media (not document text)',
          ),
        }),
      );
      body.append(mediaRow);

      if (field.mediaRef) {
        const mediaSection = h('div', { class: 'field-list-nested' });
        mediaSection.append(
          h('div', {
            class: 'help',
            text: t(
              'settings.slideTypes.fields.mediaRefHelp',
              'The reader and the reflowable export show a named stand-in instead of printing this value, and it is not offered for translation.',
            ),
          }),
        );

        const mediaLabelRow = h('div', { class: 'field-list-field-row' });
        mediaLabelRow.append(
          h('label', {
            class: 'field-label field-label-sm',
            text: t(
              'settings.slideTypes.fields.mediaRefLabel',
              'Name of the stand-in',
            ),
          }),
          createInput(
            field.mediaRef.label || '',
            (val) => {
              field.mediaRef.label = val;
              notify();
            },
            {
              class: 'form-input form-input-sm',
              placeholder: t(
                'settings.slideTypes.fields.mediaRefLabelPlaceholder',
                'Video',
              ),
            },
          ),
        );

        const linkRow = h('div', { class: 'field-list-field-row' });
        const linkSelect = h('select', { class: 'form-input form-input-sm' });
        const syncLink = () => {
          // A refresh runs on any edit at this level, including the toggle that
          // just removed the reference this control belongs to; that row is on
          // its way out of the DOM.
          if (!field.mediaRef) return;
          syncOptions(
            linkSelect,
            [
              {
                value: '',
                text: t(
                  'settings.slideTypes.fields.mediaRefLinkKeyNone',
                  '(none — link the reference itself)',
                ),
              },
              ...linkKeyChoices(field).map((key) => ({
                value: key,
                text: key,
              })),
            ],
            field.mediaRef.linkKey || '',
          );
        };
        syncLink();
        linkSelect.addEventListener('change', () => {
          if (linkSelect.value) field.mediaRef.linkKey = linkSelect.value;
          else delete field.mediaRef.linkKey;
          notify();
        });
        refreshers.push(syncLink);
        linkRow.append(
          h('label', {
            class: 'field-label field-label-sm',
            text: t(
              'settings.slideTypes.fields.mediaRefLinkKey',
              'Link the stand-in to',
            ),
          }),
          linkSelect,
        );

        mediaSection.append(mediaLabelRow, linkRow);
        body.append(mediaSection);
      }
    }

    // Options (enum)
    if (field.type === 'enum') {
      const optRow = h('div', { class: 'field-list-field-row' });
      const optLabel = h('label', {
        class: 'field-label field-label-sm',
        text: t('settings.slideTypes.fields.options', 'Options (one per line)'),
      });
      const optArea = h('textarea', {
        class: 'form-input form-input-sm code-textarea',
        rows: '4',
        placeholder: 'option1\noption2\noption3',
      });
      optArea.value = Array.isArray(field.options)
        ? field.options.join('\n')
        : '';
      optArea.addEventListener('input', () => {
        field.options = optArea.value
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        notify();
      });
      optRow.append(optLabel, optArea);
      body.append(optRow);

      // Where a stored value this field no longer offers lands (A2.3/D84).
      // Driven by the field's own options, so it needs no list of retired
      // values — and it is exactly the case the builder itself creates the
      // moment an author deletes a line above.
      const foldRow = h('div', { class: 'field-list-field-row' });
      const foldSelect = h('select', { class: 'form-input form-input-sm' });
      const syncFold = () =>
        syncOptions(
          foldSelect,
          [
            {
              value: '',
              text: t(
                'settings.slideTypes.fields.foldUnofferedToNone',
                '(none — keep stored values as they are)',
              ),
            },
            ...enumOptionValues(field).map((value) => ({
              value,
              text: value,
            })),
          ],
          field.foldUnofferedTo || '',
        );
      syncFold();
      foldSelect.addEventListener('change', () => {
        if (foldSelect.value) field.foldUnofferedTo = foldSelect.value;
        else delete field.foldUnofferedTo;
        notify();
      });
      refreshers.push(syncFold);
      foldRow.append(
        h('label', {
          class: 'field-label field-label-sm',
          text: t(
            'settings.slideTypes.fields.foldUnofferedTo',
            'A retired value becomes',
          ),
        }),
        foldSelect,
        h('div', {
          class: 'help',
          text: t(
            'settings.slideTypes.fields.foldUnofferedToHelp',
            'Deleting an option above leaves slides holding it. Name where such a value lands, or leave this alone to keep it.',
          ),
        }),
      );
      body.append(foldRow);
    }

    // Items sub-fields (nested)
    if (field.type === 'items') {
      const itemsSection = h('div', { class: 'field-list-nested' });
      itemsSection.append(
        h('div', {
          class: 'field-label field-label-sm',
          text: t('settings.slideTypes.fields.itemFields', 'Item fields'),
        }),
      );

      const minRow = h('div', { class: 'field-list-field-row' });
      minRow.append(
        h('label', {
          class: 'field-label field-label-sm',
          text: t('settings.slideTypes.fields.minItems', 'Min items'),
        }),
        createInput(
          field.minItems != null ? String(field.minItems) : '',
          (val) => {
            const n = parseInt(val, 10);
            field.minItems = Number.isFinite(n) && n >= 0 ? n : undefined;
            notify();
          },
          {
            class: 'form-input form-input-sm',
            type: 'number',
            placeholder: '0',
          },
        ),
      );

      const maxRow = h('div', { class: 'field-list-field-row' });
      maxRow.append(
        h('label', {
          class: 'field-label field-label-sm',
          text: t('settings.slideTypes.fields.maxItems', 'Max items'),
        }),
        createInput(
          field.maxItems != null ? String(field.maxItems) : '',
          (val) => {
            const n = parseInt(val, 10);
            field.maxItems = Number.isFinite(n) && n > 0 ? n : undefined;
            notify();
          },
          {
            class: 'form-input form-input-sm',
            type: 'number',
            placeholder: t('settings.slideTypes.fields.noLimit', 'No limit'),
          },
        ),
      );

      // Which sub-field heads an item in the document projection (A2.1/D81).
      // The choices are the walk's own `headableKeys`, so the builder cannot
      // offer a heading the projection would refuse to honour.
      const headRow = h('div', { class: 'field-list-field-row' });
      const headSelect = h('select', { class: 'form-input form-input-sm' });
      const syncHead = () =>
        syncOptions(
          headSelect,
          [
            {
              value: '',
              text: t(
                'settings.slideTypes.fields.itemLabelFieldNone',
                '(the first text sub-field)',
              ),
            },
            ...itemHeadingChoices(field).map((key) => ({
              value: key,
              text: key,
            })),
          ],
          field.itemLabelField || '',
        );
      syncHead();
      headSelect.addEventListener('change', () => {
        if (headSelect.value) field.itemLabelField = headSelect.value;
        else delete field.itemLabelField;
        notify();
      });
      refreshers.push(syncHead);
      headRow.append(
        h('label', {
          class: 'field-label field-label-sm',
          text: t(
            'settings.slideTypes.fields.itemLabelField',
            'Heading of an item',
          ),
        }),
        headSelect,
        h('div', {
          class: 'help',
          text: t(
            'settings.slideTypes.fields.itemLabelFieldHelp',
            'Used by the reader and the reflowable export to head each item.',
          ),
        }),
      );

      const nestedEditor = createFieldListEditor({
        fields: Array.isArray(field.itemFields) ? field.itemFields : [],
        onChange: (subFields) => {
          field.itemFields = subFields;
          notify();
          syncHead();
        },
      });
      if (rowProblem && rowProblem.itemIndex != null) {
        nestedEditor.showProblem({
          index: rowProblem.itemIndex,
          itemIndex: null,
          message: rowProblem.message,
        });
      }

      itemsSection.append(minRow, maxRow, headRow, nestedEditor.el);
      body.append(itemsSection);
    }

    details.append(summary, body);
    return details;
  }

  function update(newFields) {
    currentFields = structuredClone(newFields);
    problem = null;
    render();
  }

  /**
   * Point at the field a rejected save named, and return the row's element so
   * the caller can bring it into view.
   * @param {{index: number, itemIndex: number|null, message: string}} next
   * @returns {HTMLElement|null} the offending row, or null when the index does
   *   not name one.
   */
  function showProblem(next) {
    problem = next;
    render();
    return el.querySelector('.field-list-item.is-invalid');
  }

  /** Drop the located problem, if any. */
  function clearProblem() {
    if (!problem) return;
    problem = null;
    render();
  }

  render();
  return { el, update, showProblem, clearProblem };
}

/**
 * Fill a select with `options`, keeping `value` selected. Rebuilt only when the
 * choices or the selection actually changed, so a refresh triggered by an edit
 * elsewhere does not disturb a select the user is holding open.
 * @param {HTMLSelectElement} select
 * @param {Array<{value: string, text: string}>} options
 * @param {string} value
 */
function syncOptions(select, options, value) {
  const next = options.map((o) => o.value).join('\u0000');
  if (select.dataset.options === next && select.value === value) return;
  select.dataset.options = next;
  select.innerHTML = '';
  for (const option of options) {
    select.append(
      h('option', {
        value: option.value,
        text: option.text,
        selected: option.value === value,
      }),
    );
  }
  select.value = value;
}

function createInput(value, onInput, attrs = {}) {
  const input = h('input', { type: 'text', value, ...attrs });
  input.addEventListener('input', () => onInput(input.value));
  return input;
}
