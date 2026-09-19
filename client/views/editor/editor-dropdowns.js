/**
 * Editor Dropdowns Setup
 * Sets up share and export dropdowns for the editor topbar
 */

import { setupShareDropdown } from './share-dropdown.js';
import { setupExportDropdown } from './export-dropdown.js';
import { isOrganizationAdmin } from '../../../shared/organization-role.js';

/**
 * Create and configure editor dropdowns (share + export)
 * @param {object} options
 * @param {Function} options.api - API client
 * @param {object} options.toast - Toast notifications
 * @param {Element} options.root - Root element
 * @param {object} options.pres - Presentation data
 * @param {string} options.id - Presentation ID
 * @param {object} options.saveManager - Save manager instance
 * @param {object} options.editorState - Editor state updater
 * @param {object} options.user - Current user
 * @param {Record<string, object>} options.slideTypes - The editor's slide-type
 *   registry (names a refused publish's field by its label)
 * @returns {object} Dropdown elements and cleanup
 */
export function createEditorDropdowns({
  api,
  toast,
  root,
  pres,
  id,
  saveManager,
  editorState,
  user,
  slideTypes,
}) {
  // Share dropdown (sharing + publishing)
  const {
    shareEl: topbarShare,
    syncShareUi,
    openShare,
    detach: detachShareDropdown,
  } = setupShareDropdown({
    api,
    toast,
    pres,
    id,
    requestSave: saveManager.requestSave,
    isDirty: saveManager.isDirty,
    onError: (e) => saveManager.setLastError(e),
    root,
    editorState,
    currentUser: user,
    currentUserEmail: user?.email,
    isAdmin: isOrganizationAdmin(user),
    slideTypes,
  });

  // Export dropdown (file downloads)
  const {
    exportEl: topbarExport,
    openExport,
    detach: detachExportDropdown,
  } = setupExportDropdown({
    pres,
    id,
    root,
    openPublic: () => openShare({ initialTab: 'public' }),
  });

  const detach = () => {
    detachExportDropdown?.();
    detachShareDropdown?.();
  };

  return {
    topbarExport,
    topbarShare,
    // The openers behind those two buttons. The topbar's more-menu offers the
    // same actions at widths where the bar folds the buttons away (B354), and
    // calls these rather than keeping a second copy of the wiring.
    openExport,
    openShare,
    syncShareUi,
    detach,
  };
}
