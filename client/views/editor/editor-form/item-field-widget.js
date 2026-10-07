/**
 * The widget for ONE item field of a collection item — the per-item half of
 * the field vocabulary, shared by the two surfaces that edit an item's fields:
 * the generic collection editor (every item, on the bulk surfaces) and the
 * "This card" element tab (the selected item, in the inspector;
 * item-element-card.js). One dispatch, so an item field reads the same on both
 * and a widget added to the vocabulary reaches both at once.
 *
 * Covers the scalar item-field types and the item-sized widgets of the closed
 * field-editor vocabulary (shared/slide-types/field-editors.js): `icon-picker`,
 * `card-link`, `image-fit`. A nested `items` field is the caller's business
 * (only the collection editor renders one level of inner collection), and an
 * unknown type degrades to nothing rather than breaking.
 */
import { t } from '../../../lib/ui-i18n.js';
import { h } from '../../../lib/dom/index.js';
import { fieldCardLink } from '../fields/card-link-field.js';
import { markLinkField } from '../fields/link-field.js';
import { renderImageFitField } from '../fields/image-fit.js';
import { optionCopy } from '../fields/option-copy.js';
import { fieldEditor } from '../../../../shared/slide-types/field-editors.js';

/** The item-field types that render as a text/number input. */
const INPUT_TYPES = new Set(['string', 'markdown', 'number', 'url', 'email']);

/**
 * A labelled text input, textarea or number field for one item value.
 *
 * @param {Function|undefined} fieldNumber - the editor's number renderer
 * @param {string} label
 * @param {unknown} value
 * @param {Object} opts
 * @param {Function} onChange - (value) => void
 * @returns {HTMLElement}
 */
function itemInput(
  fieldNumber,
  label,
  value,
  { maxLength, multiline, number, placeholder, fieldType } = {},
  onChange,
) {
  if (number && fieldNumber) {
    return fieldNumber(label, value ?? '', onChange, {});
  }
  const input = multiline
    ? h('textarea', { class: 'form-input form-textarea-sm', rows: '2' })
    : h('input', { class: 'form-input' });
  input.value = value ?? '';
  if (Number(maxLength) > 0) input.maxLength = Number(maxLength);
  if (typeof placeholder === 'string' && placeholder)
    input.placeholder = placeholder;
  input.addEventListener('input', () => onChange(input.value));
  const wrap = h('div', { class: 'stack is-field' }, [
    h('div', { class: 'field-label', text: label }),
    input,
  ]);
  return multiline ? wrap : markLinkField({ wrap, control: input, fieldType });
}

/**
 * Render the widget for one item field.
 *
 * @param {Object} o
 * @param {Object} o.field - the item-field schema (one `itemFields` entry)
 * @param {Object} o.item - the item being edited (read only; writes go
 *   through `setItemKey`)
 * @param {(key: string, value: unknown) => void} o.setItemKey - write one key
 * @param {Object} o.slide - the slide, for the image picker's proxy
 * @param {Object} o.def - the slide-type definition (`imageDefaults.fit`)
 * @param {Object} o.fieldRenderers - { fieldImage, fieldIconPicker,
 *   fieldEnum, fieldNumber }
 * @param {Array<Object>} [o.deckSlides] - options for a card-link field
 * @param {Function} [o.onImageChange] - after an image pick (the caller
 *   rebuilds, since the picker's preview is part of the widget)
 * @returns {HTMLElement|null}
 */
export function renderItemFieldWidget({
  field: f,
  item,
  setItemKey,
  slide,
  def,
  fieldRenderers,
  deckSlides = [],
  onImageChange,
}) {
  const { fieldImage, fieldIconPicker, fieldEnum, fieldNumber } =
    fieldRenderers || {};
  const k = String(f?.key || '');
  const label = t(f.labelKey || k, f.label || k);

  const editor = fieldEditor(f);
  if (editor === 'icon-picker' && typeof fieldIconPicker === 'function') {
    return fieldIconPicker(label, item?.[k] || '', (v) => setItemKey(k, v), {});
  }
  if (editor === 'card-link') {
    return fieldCardLink({
      value: item?.[k] || '',
      slides: deckSlides,
      onChange: (v) => setItemKey(k, v),
      help: t(
        'editor.cards.linkHelp2',
        'Makes the card clickable. Pick a slide to jump to, or type an https:// / mailto: link (opens in a new tab).',
      ),
    });
  }
  if (editor === 'image-fit') {
    const fitEl = renderImageFitField({
      fieldEnum,
      field: { ...f, key: k },
      target: item,
      typeDefault: def?.imageDefaults?.fit,
      onChange: (v) => setItemKey(k, v),
    });
    if (fitEl) return fitEl;
  }

  if (f.type === 'image' && fieldImage) {
    // fieldImage edits `slide.content[key]`; a proxy slide maps that contract
    // onto this item object.
    const proxySlide = { type: slide?.type, id: slide?.id, content: item };
    return fieldImage(proxySlide, { ...f, key: k, hideHelp: true }, (url) => {
      setItemKey(k, url);
      onImageChange?.();
    });
  }

  if (f.type === 'enum' && typeof fieldEnum === 'function') {
    const options = (Array.isArray(f.options) ? f.options : []).map(optionCopy);
    return fieldEnum({ ...f, options }, item?.[k] ?? '', (v) =>
      setItemKey(k, v),
    );
  }

  if (INPUT_TYPES.has(f.type)) {
    return itemInput(
      fieldNumber,
      label,
      item?.[k] ?? '',
      {
        maxLength: f.maxLength,
        multiline: f.type === 'markdown' || !!f.multiline,
        number: f.type === 'number',
        fieldType: f.type,
        placeholder:
          typeof f.placeholder === 'string' && f.placeholderKey
            ? t(f.placeholderKey, f.placeholder)
            : f.placeholder,
      },
      (v) => setItemKey(k, v),
    );
  }
  // Unknown item-field type: degrade to nothing rather than break.
  return null;
}
