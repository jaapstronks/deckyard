/**
 * Export button - opens the unified export modal (PDF, PNG, PPTX, HTML, ...).
 *
 * This used to render a flat dropdown menu. It now opens the grouped export
 * modal (`export-modal.js`); the menu's three overlapping PDF entries and the
 * duplicated other-language section live there as one coherent dialog.
 */

import { t } from '../../lib/ui-i18n.js';
import { openExportModal } from './export-modal.js';

export function setupExportDropdown({
  h,
  pres,
  id,
  root,
  overlayClosers,
} = {}) {
  let modal = null;

  const button = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('editor.export.button', 'Export'),
    title: t('editor.export.title', 'Export to file'),
    onclick: () => {
      modal = openExportModal({
        pres,
        id,
        root: root || document.body,
        overlayClosers,
      });
    },
  });

  const detach = () => {
    try {
      modal?.close?.();
    } catch {
      // ignore
    }
    modal = null;
  };

  return { exportEl: button, detach };
}
