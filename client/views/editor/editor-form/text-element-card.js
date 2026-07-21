/**
 * "This text" element-tab card (editing-surfaces text phase, step 3).
 *
 * Block-level styling for the selected text field: alignment and a theme
 * colour token. Writes to the generic `content.textStyles[fieldKey]` map
 * (see shared/slide-types/text-styles.js); the shared render post-pass turns
 * that into the `tf-*` classes on the field element, so the preview, present
 * mode and exports all reflect it from one code path.
 *
 * Defaults are pruned on write, so a click-to-default leaves stored JSON
 * clean (no no-op overrides). Text SIZE (S/M/L) is a follow-up (needs a
 * per-type `--tf-size-scale` hook) and is intentionally not here yet.
 */

import { t } from '../../../lib/ui-i18n.js';
import {
  TEXT_ALIGN_VALUES,
  TEXT_COLOR_VALUES,
  normalizeTextStyles,
} from '../../../../shared/slide-types/text-styles.js';

const ALIGN_DEFAULT = 'left';
const COLOR_DEFAULT = 'default';

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

  const alignField = {
    key: 'textAlign',
    label: t('editor.textStyle.align', 'Alignment'),
    options: TEXT_ALIGN_VALUES.map((v) => ({
      value: v,
      label: t(`editor.textStyle.align.${v}`, v[0].toUpperCase() + v.slice(1)),
    })),
  };
  const alignEl = fieldEnum(alignField, current.align || ALIGN_DEFAULT, (v) => {
    setTextStyle(slide, fieldKey, 'align', v, ALIGN_DEFAULT);
    commit();
  });

  const colorField = {
    key: 'textColor',
    label: t('editor.textStyle.color', 'Text colour'),
    options: TEXT_COLOR_VALUES.map((v) => ({
      value: v,
      label: t(`editor.textStyle.color.${v}`, v[0].toUpperCase() + v.slice(1)),
    })),
  };
  const colorEl = fieldEnum(colorField, current.color || COLOR_DEFAULT, (v) => {
    setTextStyle(slide, fieldKey, 'color', v, COLOR_DEFAULT);
    commit();
  });

  container.append(
    h('div', {
      class: 'help',
      text: t(
        'editor.textStyle.hint',
        'Styling for this text block. Size options are coming soon.'
      ),
    }),
    alignEl,
    colorEl
  );
  return true;
}
