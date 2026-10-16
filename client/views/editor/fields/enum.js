import { t } from '../../../lib/ui-i18n.js';
import { h } from '../../../lib/dom/index.js';
import { optionCopy } from './option-copy.js';
import { enumControl, optionGlyph } from './enum-fit.js';
import {
  createResetToDefault,
  defaultDot,
  hasDefaultOption,
  withDefaultMark,
} from './default-mark.js';

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
  // draws that glyph in place of its label; the label stays the button's
  // title and accessible name. With `labelBeside` the glyph is a compact
  // sketch next to the label instead (the image-width splits, where the
  // percentage is the name and the sketch shows what it means).
  const enumButtonContent = (opt) => {
    const label = h('span', { text: opt.label ?? opt.value });
    const icon = optionGlyph(opt);
    if (!icon) return [label];
    const glyph = h('span', {
      class: `sb-icon sb-icon-${icon}${opt.labelBeside ? ' is-beside' : ''}`,
      'aria-hidden': 'true',
    });
    return opt.labelBeside ? [glyph, label] : [glyph];
  };

  const fieldSegmented = (
    field,
    value,
    options,
    onChange,
    sizeClass,
    defaultValue,
  ) => {
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

    const choose = (v) => {
      setActive(v);
      reset?.sync(v);
      onChange(v);
    };
    const reset =
      defaultValue == null
        ? null
        : createResetToDefault({ defaultValue, value, apply: choose });

    for (const opt of options) {
      const isDefault = defaultValue != null && opt.value === defaultValue;
      const name = opt.ariaLabel ?? opt.label ?? opt.value;
      const btn = h('button', {
        type: 'button',
        class: 'sb-segmented-btn',
        title: isDefault ? withDefaultMark(opt.title ?? name) : opt.title,
        'aria-label': isDefault ? withDefaultMark(name) : opt.ariaLabel,
        'aria-pressed': String(value ?? '') === opt.value ? 'true' : 'false',
        onclick: () => choose(opt.value),
      });
      btn.dataset.value = opt.value;
      if (String(value ?? '') === opt.value) btn.classList.add('is-active');
      if (optionGlyph(opt) && opt.labelBeside)
        btn.classList.add('has-icon-beside');
      btn.append(...enumButtonContent(opt));
      if (isDefault) {
        btn.classList.add('is-default');
        btn.append(defaultDot());
      }
      group.append(btn);
    }
    // Use `stack is-field` so label/control spacing matches other editor fields
    // (e.g. background picker) and doesn't inherit the larger default stack gap.
    return h(
      'div',
      { class: `stack is-field${sizeClass}` },
      [
        h('div', { class: 'field-label', text: enumFieldLabel(field) }),
        group,
        reset?.el,
      ].filter(Boolean),
    );
  };

  // The dropdown form of the same mark: a native <option> cannot carry a dot,
  // so the default option says so in words, and the reset sits under it.
  const fieldDropdown = (field, value, options, onChange, defaultValue) => {
    const marked =
      defaultValue == null
        ? options
        : options.map((o) =>
            o.value === defaultValue
              ? { ...o, label: withDefaultMark(o.label ?? o.value) }
              : o,
          );
    let reset = null;
    const el = fieldSelect(enumFieldLabel(field), value, marked, (v) => {
      reset?.sync(v);
      onChange(v);
    });
    if (defaultValue != null) {
      const select = el.querySelector('select');
      reset = createResetToDefault({
        defaultValue,
        value,
        apply: (v) => {
          if (select) select.value = v;
          reset.sync(v);
          onChange(v);
        },
      });
      el.append(reset.el);
    }
    return el;
  };

  // The control follows from what the options need (enum-fit.js): one
  // segmented row when it fits the narrowest inspector column, a dropdown
  // otherwise, and the size intent from the same width estimate. With a
  // `defaultValue` among the options, that option is marked and a deviating
  // value offers "Back to default" (D346, default-mark.js).
  const fieldEnum = (field, value, onChange, { defaultValue } = {}) => {
    const options = (Array.isArray(field?.options) ? field.options : []).map(
      optionCopy,
    );
    const v = value ?? '';
    const d = hasDefaultOption(options, defaultValue)
      ? String(defaultValue)
      : null;
    const { control, size } = enumControl(options);
    const sizeClass = size ? ` is-field-${size}` : '';
    if (control === 'segmented') {
      return fieldSegmented(field, v, options, onChange, sizeClass, d);
    }
    const el = fieldDropdown(field, v, options, onChange, d);
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
