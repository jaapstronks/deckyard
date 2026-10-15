/**
 * Canvas | Fields: the tab strip above the canvas column (D335).
 *
 * Content has two working postures on the same fields: shaping it on the
 * canvas, and writing and checking it as a form. The tabs name what the
 * column shows; the controller swaps the column's view (fields-view.js) and
 * remembers the choice.
 */

import { t } from '../../lib/ui-i18n.js';
import { createColumnTabs } from '../../lib/dom/column-tabs.js';

/** @typedef {'canvas'|'fields'} CanvasView */

/**
 * @param {Object} options
 * @param {CanvasView} [options.value] - The view shown at mount.
 * @param {(view: CanvasView) => void} options.onSelect - Show this view.
 * @returns {{ el: HTMLElement, setValue: (view: CanvasView) => void }}
 */
export function createCanvasTabs({ value = 'canvas', onSelect }) {
  const strip = createColumnTabs({
    className: 'canvas-tabs',
    ariaLabel: t('editor.canvasTabs.label', 'Slide view'),
    value,
    tabs: [
      { value: 'canvas', label: t('editor.canvasTabs.canvas', 'Canvas') },
      {
        value: 'fields',
        label: t('editor.canvasTabs.fields', 'Fields'),
        title: t(
          'editor.canvasTabs.fieldsTitle',
          'Edit all content fields of this slide as a form',
        ),
      },
    ],
    onSelect,
  });

  return { el: strip.el, setValue: strip.setValue };
}
