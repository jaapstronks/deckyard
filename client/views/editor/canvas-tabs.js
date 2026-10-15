/**
 * Canvas | Fields: the tab strip above the canvas column (D335).
 *
 * Content has two working postures on the same fields: shaping it on the
 * canvas, and writing and checking it as a form. The tabs name what the
 * column shows. Until the Fields form lands in the canvas column (B703 PR 2)
 * the Fields tab opens the existing all-fields dialog; it stays selected while
 * that dialog is open and hands back to Canvas when it closes, so the strip
 * never claims a view that is not showing.
 */

import { t } from '../../lib/ui-i18n.js';
import { createColumnTabs } from '../../lib/dom/column-tabs.js';

/**
 * @param {Object} options
 * @param {() => void} options.onOpenFields - Open the Fields view.
 * @returns {{ el: HTMLElement, showCanvas: () => void }}
 */
export function createCanvasTabs({ onOpenFields }) {
  const strip = createColumnTabs({
    className: 'canvas-tabs',
    ariaLabel: t('editor.canvasTabs.label', 'Slide view'),
    value: 'canvas',
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
    onSelect: (view) => {
      if (view === 'fields') onOpenFields();
    },
  });

  return { el: strip.el, showCanvas: () => strip.setValue('canvas') };
}
