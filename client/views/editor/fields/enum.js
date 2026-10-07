import { t } from '../../../lib/ui-i18n.js';
import { h } from '../../../lib/dom/index.js';
import { optionCopy } from './option-copy.js';
import { enumControl } from './enum-fit.js';

/**
 * The translated visible label for an enum field. Enum fields resolve their
 * label the same way every other field type does (see render-field.js):
 * `labelKey` wins, then the field key as an implicit key, with the raw
 * `label` as fallback. Keeps the inspector's enum labels translatable instead
 * of hardcoded English.
 * @param {Object} field
 * @returns {string}
 */
function enumFieldLabel(field) {
  return t(field?.labelKey || field?.key || '', field?.label || '');
}

export function createEnumFields({ fieldSelect } = {}) {
  // An option that declares an `icon` (`sb-icon-<icon>`, 40-option-icons.css)
  // draws that glyph; its label stays the button's title and accessible name.
  const enumButtonContent = (opt) =>
    opt.icon
      ? h('span', {
          class: `sb-icon sb-icon-${opt.icon}`,
          'aria-hidden': 'true',
        })
      : h('span', { text: opt.label ?? opt.value });

  const fieldSegmented = (field, value, options, onChange, sizeClass) => {
    const group = h('div', {
      class: 'sb-segmented',
      role: 'radiogroup',
      'aria-label': enumFieldLabel(field) || field?.key || 'Options',
    });

    const setActive = (opt) => {
      for (const child of group.children) {
        const is =
          child?.dataset?.value != null && child.dataset.value === String(opt);
        child.classList.toggle('is-active', !!is);
        child.setAttribute('aria-pressed', is ? 'true' : 'false');
      }
    };

    for (const opt of options) {
      const btn = h('button', {
        type: 'button',
        class: 'sb-segmented-btn',
        title: opt.title,
        'aria-label': opt.ariaLabel,
        'aria-pressed': String(value ?? '') === opt.value ? 'true' : 'false',
        onclick: () => {
          setActive(opt.value);
          onChange(opt.value);
        },
      });
      btn.dataset.value = opt.value;
      if (String(value ?? '') === opt.value) btn.classList.add('is-active');
      btn.append(enumButtonContent(opt));
      group.append(btn);
    }
    // Use `stack is-field` so label/control spacing matches other editor fields
    // (e.g. background picker) and doesn't inherit the larger default stack gap.
    return h('div', { class: `stack is-field${sizeClass}` }, [
      h('div', { class: 'field-label', text: enumFieldLabel(field) }),
      group,
    ]);
  };

  // The control follows from what the options need (enum-fit.js): one
  // segmented row when it fits the narrowest inspector column, a dropdown
  // otherwise, and the size intent from the same width estimate.
  const fieldEnum = (field, value, onChange) => {
    const options = (Array.isArray(field?.options) ? field.options : []).map(
      optionCopy,
    );
    const v = value ?? '';
    const { control, size } = enumControl(options);
    const sizeClass = size ? ` is-field-${size}` : '';
    if (control === 'segmented') {
      return fieldSegmented(field, v, options, onChange, sizeClass);
    }
    const el = fieldSelect(enumFieldLabel(field), v, options, onChange);
    if (size) el.classList.add(`is-field-${size}`);
    return el;
  };

  // A responsive row of fields. Columns are no longer fixed: `.field-grid` is a
  // flex-wrap container (see app/editor/inspector/10-field-grid.css) that lays fields out
  // side by side when the editor column is wide enough and stacks them when it
  // isn't, driven by each field's own size intent (`is-field-*`). The legacy
  // `cols` argument is accepted for backward compatibility but no longer drives
  // layout - grouping is now purely semantic ("these fields belong together").
  const fieldGrid = (children, _cols) => {
    const nodes = (Array.isArray(children) ? children : []).filter(Boolean);
    if (!nodes.length) return null;
    return h('div', { class: 'field-grid' }, nodes);
  };

  return { fieldEnum, fieldGrid };
}
