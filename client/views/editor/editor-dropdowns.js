/**
 * Editor Dropdowns Setup
 * Sets up share and export dropdowns for the editor topbar
 */

import { setupShareDropdown } from './share-dropdown.js';
import { setupExportDropdown } from './export-dropdown.js';

/**
 * Create and configure editor dropdowns (share + export)
 * @param {object} options
 * @param {Function} options.h - DOM helper
 * @param {Function} options.api - API client
 * @param {object} options.toast - Toast notifications
 * @param {Element} options.root - Root element
 * @param {object} options.pres - Presentation data
 * @param {string} options.id - Presentation ID
 * @param {object} options.saveManager - Save manager instance
 * @param {object} options.openOverlayClosers - Overlay closers set
 * @param {object} options.editorState - Editor state updater
 * @param {object} options.user - Current user
 * @returns {object} Dropdown elements and cleanup
 */
export function createEditorDropdowns({
  h,
  api,
  toast,
  root,
  pres,
  id,
  saveManager,
  openOverlayClosers,
  editorState,
  user,
}) {
  // Export dropdown (file downloads)
  const {
    exportEl: topbarExport,
    detach: detachExportDropdown,
  } = setupExportDropdown({
    h,
    pres,
    id,
    root,
    overlayClosers: openOverlayClosers,
  });

  // Share dropdown (sharing + publishing)
  const {
    shareEl: topbarShare,
    syncShareUi,
    detach: detachShareDropdown,
  } = setupShareDropdown({
    h,
    api,
    toast,
    pres,
    id,
    requestSave: saveManager.requestSave,
    isDirty: saveManager.isDirty,
    onError: (e) => saveManager.setLastError(e),
    root,
    openOverlayClosers,
    editorState,
    currentUserEmail: user?.email,
    isAdmin: user?.isAdmin,
  });

  const detach = () => {
    detachExportDropdown?.();
    detachShareDropdown?.();
  };

  return {
    topbarExport,
    topbarShare,
    syncShareUi,
    detach,
  };
}