/**
 * "This text" element-tab card (editing-surfaces text phase, step 3).
 *
 * Block-level styling for the selected text field: alignment, a theme colour
 * token and a 3-step size scale (S/M/L). Writes to the generic
 * `content.textStyles[fieldKey]` map (see shared/slide-types/text-styles.js);
 * the shared render post-pass turns that into the `tf-*` classes on the field
 * element, so the preview, present mode and exports all reflect it from one
 * code path.
 *
 * Defaults are pruned on write, so a click-to-default leaves stored JSON
 * clean (no no-op overrides). Size scaling is rolled out per slide type
 * (see docs/reference/editor-inspector.md); on a type/field that doesn't yet
 * consume `--tf-size-scale`, the control still stores cleanly but has no
 * visible effect.
 */

import { t, getUiLocale } from '../../../lib/ui-i18n.js';
import {
  TEXT_ALIGN_VALUES,
  TEXT_COLOR_SWATCH_SLOTS,
  TEXT_SIZE_VALUES,
  normalizeTextStyles,
} from '../../../../shared/slide-types/text-styles.js';

const ALIGN_DEFAULT = 'left';
const COLOR_DEFAULT = 'default';
const SIZE_DEFAULT = 'md';

/** The three base colour tokens, always offered regardless of theme. */
const COLOR_BASE_IDS = ['default', 'muted', 'accent'];

/**
 * Resolve a theme swatch label that may be a plain string or a `{ nl, en }`
 * map (same shape as `theme.backgroundLabels`). Empty when none is usable.
 */
function resolveThemeSwatchLabel(raw) {
  if (typeof raw === 'string') return raw.trim();
  if (raw && typeof raw === 'object') {
    const ui = String(getUiLocale?.() || 'en').toLowerCase();
    const isNl = ui === 'nl' || ui.startsWith('nl-');
    const pick = isNl ? raw.nl : raw.en;
    if (typeof pick === 'string') return pick.trim();
  }
  return '';
}

/**
 * Render the "Text colour" control as a swatch row: the three base tokens
 * (default/muted/accent) plus the theme's declared on-brand text swatches
 * (brand-1/2/3). Swatch preview colours resolve from the loaded theme's
 * cssVars and are inlined, so they show correctly even though the inspector
 * rail doesn't inherit the slide's theme variables. Returns the field element.
 *
 * @param {Object} opts
 * @param {Function} opts.h
 * @param {Object} opts.slide
 * @param {string} opts.fieldKey
 * @param {Object|null} opts.theme - the loaded (normalized) theme
 * @param {{color?: string}} opts.current - the field's current style
 * @param {Function} opts.commit
 * @returns {HTMLElement}
 */
function renderColorControl({ h, slide, fieldKey, theme, current, commit }) {
  const themeVars =
    theme?.cssVars && typeof theme.cssVars === 'object' ? theme.cssVars : {};
  const themeSwatches = (Array.isArray(theme?.textSwatches) ? theme.textSwatches : [])
    .filter((s) => TEXT_COLOR_SWATCH_SLOTS.includes(s?.id));

  const currentColor = current.color || COLOR_DEFAULT;
  const options = [
    ...COLOR_BASE_IDS.map((id) => ({ id })),
    ...themeSwatches,
  ];
  // Defensive: a stored brand the current theme no longer offers stays visible
  // (and therefore removable) instead of being a stuck invisible override.
  if (currentColor !== COLOR_DEFAULT && !options.some((o) => o.id === currentColor)) {
    options.push({ id: currentColor });
  }

  // Preview colour for a swatch dot (null = the "auto/default" checker). These
  // are hints; the real muted is band-aware (currentColor-derived) at render.
  const swatchColor = (id) => {
    if (id === 'default') return null;
    if (id === 'muted') return themeVars['--t-color-text-muted'] || 'rgba(0,0,0,0.45)';
    if (id === 'accent') return themeVars['--t-color-accent'] || '';
    return themeVars[`--t-color-${id}`] || '';
  };
  const labelFor = (opt) =>
    resolveThemeSwatchLabel(opt.label) ||
    t(`editor.textStyle.color.${opt.id}`, opt.id);

  const group = h('div', {
    class: 'sb-segmented tf-color-swatches',
    role: 'radiogroup',
    'aria-label': t('editor.textStyle.color', 'Text colour'),
  });
  const setActive = (id) => {
    for (const c of group.children) {
      const is = c.dataset?.value === id;
      c.classList.toggle('is-active', is);
      c.setAttribute('aria-pressed', is ? 'true' : 'false');
    }
  };
  for (const opt of options) {
    const label = labelFor(opt);
    const col = swatchColor(opt.id);
    const btn = h('button', {
      type: 'button',
      class: 'sb-segmented-btn',
      title: label,
      'aria-label': label,
      'aria-pressed': opt.id === currentColor ? 'true' : 'false',
    });
    btn.dataset.value = opt.id;
    if (opt.id === currentColor) btn.classList.add('is-active');
    const sw =
      col == null
        ? h('span', { class: 'sb-swatch sb-swatch-transparent', 'aria-hidden': 'true' })
        : h('span', { class: 'sb-swatch', style: `--sb-swatch:${col}`, 'aria-hidden': 'true' });
    btn.append(sw, h('span', { class: 'sb-swatch-label', text: label }));
    btn.addEventListener('click', () => {
      setActive(opt.id);
      setTextStyle(slide, fieldKey, 'color', opt.id, COLOR_DEFAULT);
      commit();
    });
    group.append(btn);
  }
  return h('div', { class: 'stack is-field is-field-full' }, [
    h('div', { class: 'field-label', text: t('editor.textStyle.color', 'Text colour') }),
    group,
  ]);
}

/**
 * Write one style property for a field, pruning defaults so the stored map
 * never carries no-op overrides. Mutates `slide.content.textStyles`.
 */
function setTextStyle(slide, fieldKey, prop, value, defaultValue) {
  const content = slide.content || (slide.content = {});
  const map = { ...(content.textStyles || {}) };
  const style = { ...(map[fieldKey] || {}) };
  if (value === defaultValue || value == null || value === '') delete style[prop];
  else style[prop] = value;
  if (Object.keys(style).length) map[fieldKey] = style;
  else delete map[fieldKey];
  const cleaned = normalizeTextStyles(map);
  if (Object.keys(cleaned).length) content.textStyles = cleaned;
  else delete content.textStyles;
}

/**
 * Render the alignment + colour controls into `container`.
 *
 * @param {Object} opts
 * @param {Function} opts.h
 * @param {HTMLElement} opts.container - the element tab (elementForm)
 * @param {Object} opts.slide
 * @param {string} opts.fieldKey - the selected field's data-inline-field value
 * @param {{fieldEnum: Function}} opts.fieldRenderers
 * @param {Function} opts.markDirty
 * @param {Function} [opts.rerenderPreview]
 * @param {Function} [opts.scheduleUiRefresh]
 * @returns {boolean} whether anything was rendered
 */
export function renderTextElementCard({
  h,
  container,
  slide,
  fieldKey,
  theme = null,
  fieldRenderers,
  markDirty,
  rerenderPreview,
  scheduleUiRefresh,
}) {
  const fieldEnum = fieldRenderers?.fieldEnum;
  if (!fieldEnum || !fieldKey) return false;
  const current = normalizeTextStyles(slide?.content?.textStyles)[fieldKey] || {};

  const commit = () => {
    markDirty?.();
    scheduleUiRefresh?.();
    rerenderPreview?.();
  };

  // Some slide types don't offer right-align: the quote slide's block layout
  // only supports left (hero) and centre. A value already stored as 'right'
  // stays selectable so it's never a stuck, invisible override.
  const alignValues = TEXT_ALIGN_VALUES.filter(
    (v) => v !== 'right' || slide?.type !== 'quote-slide' || current.align === 'right'
  );
  const alignField = {
    key: 'textAlign',
    label: t('editor.textStyle.align', 'Alignment'),
    options: alignValues.map((v) => ({
      value: v,
      label: t(`editor.textStyle.align.${v}`, v[0].toUpperCase() + v.slice(1)),
    })),
  };
  const alignEl = fieldEnum(alignField, current.align || ALIGN_DEFAULT, (v) => {
    setTextStyle(slide, fieldKey, 'align', v, ALIGN_DEFAULT);
    commit();
  });

  const colorEl = renderColorControl({ h, slide, fieldKey, theme, current, commit });

  const sizeField = {
    key: 'textSize',
    label: t('editor.textStyle.size', 'Text size'),
    options: TEXT_SIZE_VALUES.map((v) => ({
      value: v,
      label: t(`editor.textStyle.size.${v}`, v.toUpperCase()),
    })),
  };
  const sizeEl = fieldEnum(sizeField, current.size || SIZE_DEFAULT, (v) => {
    setTextStyle(slide, fieldKey, 'size', v, SIZE_DEFAULT);
    commit();
  });

  container.append(
    h('div', {
      class: 'help',
      text: t('editor.textStyle.hint', 'Styling for this text block.'),
    }),
    alignEl,
    colorEl,
    sizeEl
  );
  return true;
}
