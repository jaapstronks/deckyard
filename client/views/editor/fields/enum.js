import { t } from '../../../lib/ui-i18n.js';

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

export function createEnumFields({ h, fieldSelect } = {}) {
  const iconEl = (cls) =>
    h('span', {
      class: `sb-icon ${cls}`,
      'aria-hidden': 'true',
    });

  const swatchEl = (cssVar) =>
    h('span', {
      class: 'sb-swatch',
      style: `--sb-swatch:${cssVar}`,
      'aria-hidden': 'true',
    });

  const swatchTransparentEl = () =>
    h('span', {
      class: 'sb-swatch sb-swatch-transparent',
      'aria-hidden': 'true',
    });

  const normalizeOption = (o) => {
    if (typeof o === 'string') {
      return {
        value: o,
        label: o,
        title: o,
        ariaLabel: o,
      };
    }
    if (o && typeof o === 'object') {
      const value = String(o.value ?? '');
      const label = String(o.label ?? o.title ?? value);
      const title = String(o.title ?? o.label ?? value);
      const ariaLabel = String(o.ariaLabel ?? o.label ?? title ?? value);
      return { ...o, value, label, title, ariaLabel };
    }
    return { value: '', label: '', title: '', ariaLabel: '' };
  };

  const enumButtonContent = (field, optionValue, optionLabel) => {
    const key = String(field?.key || '');
    if (key === 'background') {
      if (optionValue === 'lime') return swatchEl('var(--slide-bg-lime)');
      if (optionValue === 'mist') return swatchEl('var(--slide-bg-mist)');
      if (optionValue === 'transparent') return swatchTransparentEl();
      return h('span', { text: optionLabel ?? optionValue });
    }
    if (key === 'imageSide') {
      if (optionValue === 'left') return iconEl('sb-icon-side-left');
      if (optionValue === 'right') return iconEl('sb-icon-side-right');
      return h('span', { text: optionLabel ?? optionValue });
    }
    if (key === 'imageFit') {
      if (optionValue === 'cover') return iconEl('sb-icon-fit-cover');
      if (optionValue === 'contain') return iconEl('sb-icon-fit-contain');
      return h('span', { text: optionLabel ?? optionValue });
    }
    if (key === 'layout') {
      if (optionValue === 'two-column') return iconEl('sb-icon-cols-2');
      if (optionValue === 'one-column') return iconEl('sb-icon-cols-1');
      return h('span', { text: optionLabel ?? optionValue });
    }
    if (key === 'autoplay') {
      if (optionValue === 'on')
        return h('span', { class: 'sb-toggle-text', text: t('common.on', 'On') });
      if (optionValue === 'off')
        return h('span', { class: 'sb-toggle-text', text: t('common.off', 'Off') });
      return h('span', { class: 'sb-toggle-text', text: String(optionValue) });
    }
    if (key === 'lang') {
      return h('span', {
        class: 'sb-chip-text',
        text: String(optionValue).toUpperCase(),
      });
    }
    return h('span', { text: optionLabel ?? optionValue });
  };

  const fieldSegmented = (field, value, options, onChange) => {
    const key = String(field?.key || '');
    const isToggle = key === 'autoplay' && options.length === 2;
    const isHalf = key === 'background' && options.length === 2;
    const group = h('div', {
      class: `sb-segmented${isToggle ? ' is-toggle' : ''}${
        isHalf ? ' is-half' : ''
      }`,
      role: 'radiogroup',
      'aria-label': field?.label || field?.key || 'Options',
    });

    const setActive = (opt) => {
      for (const child of group.children) {
        const is =
          child?.dataset?.value != null && child.dataset.value === String(opt);
        child.classList.toggle('is-active', !!is);
        child.setAttribute('aria-pressed', is ? 'true' : 'false');
      }
    };

    for (const raw of options) {
      const opt = normalizeOption(raw);
      const btn = h('button', {
        type: 'button',
        class: 'sb-segmented-btn',
        title:
          key === 'autoplay'
            ? opt.value === 'on'
              ? 'On'
              : opt.value === 'off'
              ? 'Off'
              : String(opt.title ?? opt.label ?? opt.value)
            : String(opt.title ?? opt.label ?? opt.value),
        'aria-label':
          key === 'autoplay'
            ? opt.value === 'on'
              ? 'On'
              : opt.value === 'off'
              ? 'Off'
              : String(opt.ariaLabel ?? opt.title ?? opt.label ?? opt.value)
            : String(opt.ariaLabel ?? opt.title ?? opt.label ?? opt.value),
        'aria-pressed': String(value ?? '') === opt.value ? 'true' : 'false',
        onclick: () => {
          setActive(opt.value);
          onChange(opt.value);
        },
      });
      btn.dataset.value = opt.value;
      if (String(value ?? '') === opt.value) btn.classList.add('is-active');
      btn.append(enumButtonContent(field, opt.value, opt.label));
      group.append(btn);
    }
    // Use `stack is-field` so label/control spacing matches other editor fields
    // (e.g. background picker) and doesn't inherit the larger default stack gap.
    // Size intent for the responsive row, scaled to the button count:
    //   2 options  → default: a plain toggle pairs happily beside a neighbour.
    //   3-4 options → `is-field-wide`: takes its own line on a narrow column,
    //     pairs up again on a wide one - always enough room for one button row.
    //   5+ options  → `is-field-full`: always its own full-width line, because
    //     even a paired "wide" cell is too tight for that many buttons and they
    //     would wrap onto a second row.
    const optionCount = options.length;
    const sizeClass =
      optionCount >= 5
        ? ' is-field-full'
        : optionCount >= 3
        ? ' is-field-wide'
        : '';
    return h('div', { class: `stack is-field${sizeClass}` }, [
      h('div', { class: 'field-label', text: enumFieldLabel(field) }),
      group,
    ]);
  };

  const fieldEnum = (field, value, onChange) => {
    const options = Array.isArray(field?.options) ? field.options : [];
    const v = value ?? '';
    if (options.length > 0 && options.length <= 6) {
      return fieldSegmented(field, v, options, onChange);
    }
    return fieldSelect(enumFieldLabel(field), v, options, onChange);
  };

  // A responsive row of fields. Columns are no longer fixed: `.field-grid` is a
  // flex-wrap container (see 03-controls-and-forms.css) that lays fields out
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
