/**
 * Export button - opens the unified export modal (PDF, PNG, PPTX, HTML, ...).
 *
 * This used to render a flat dropdown menu. It now opens the grouped export
 * modal (`export-modal.js`); the menu's three overlapping PDF entries and the
 * duplicated other-language section live there as one coherent dialog.
 */

import { t } from '../../lib/ui-i18n.js';
import { openExportModal } from './export-modal.js';
import { h } from '../../lib/dom.js';

/**
 * @param {Object} opts
 * @param {Object} opts.pres - the deck
 * @param {string} opts.id - the deck id
 * @param {HTMLElement} [opts.root] - element to append the modal to
 * @param {Function} [opts.openPublic] - opens the Share dialog on its Public
 *   tab; the HTML row's hint links there
 */
export function setupExportDropdown({ pres, id, root, openPublic } = {}) {
  let modal = null;

  /**
   * Open the export dialog. Exported so the topbar's more-menu can offer the
   * same action at widths where the bar folds this button away, without a
   * second copy of the wiring (B354).
   */
  const openExport = () => {
    modal = openExportModal({
      pres,
      id,
      root: root || document.body,
      openPublic,
    });
  };

  const button = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('editor.export.button', 'Export'),
    title: t('editor.export.title', 'Export to file'),
    onclick: () => openExport(),
  });

  const detach = () => {
    try {
      modal?.close?.();
    } catch {
      // ignore
    }
    modal = null;
  };

  return { exportEl: button, openExport, detach };
}
