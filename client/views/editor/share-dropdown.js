/**
 * Share button — opens the unified Share dialog.
 *
 * This used to render a dropdown menu ("Share links…", "Share to workspace",
 * "Move to private", Publish/Unpublish, Notion). Those overlapping entries are
 * now one dialog (`modals/share-modal`) with Workspace / Link / Publish tabs;
 * the button just opens it and keeps its published-state indicator in sync.
 */

import { lockDocumentScroll } from './editor-utils.js';
import { copyToClipboard } from './publish-export/clipboard.js';
import { openPublishModal } from './publish-export/publish-modal.js';
import { doPublish, buildPublishModalData } from './publish-export/publish.js';
import { openShareModal } from './modals/share-modal.js';
import { openDescriptionModal } from './modals/description-modal.js';
import { openExportModal } from './export-modal.js';
import { t } from '../../lib/ui-i18n.js';
import { handleNotionPublish } from './share-dropdown/share-actions.js';

export function setupShareDropdown({
  h,
  api,
  toast,
  pres,
  id,
  requestSave,
  isDirty,
  onError,
  root,
  openOverlayClosers,
  editorState,
  currentUserEmail,
  isAdmin,
} = {}) {
  let notionAvailable = false;
  let dialog = null;

  const button = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('editor.share.button', 'Share'),
    title: t('editor.share.title', 'Share and publish options'),
  });

  /** Update the published-state indicator on the button (and any open dialog). */
  function syncShareUi() {
    const isPublished = !!(typeof pres?.published?.id === 'string' && pres.published.id);
    button.classList.toggle('btn-published', isPublished);
    try {
      const existingDot = button.querySelector('.live-dot');
      if (isPublished && !existingDot) {
        button.insertBefore(
          h('span', { class: 'live-dot', 'aria-hidden': 'true', text: '●' }),
          button.firstChild
        );
      } else if (!isPublished && existingDot) {
        existingDot.remove();
      }
    } catch {
      // ignore
    }
    dialog?.refresh?.();
  }

  // Bound helpers passed into the dialog's Publish tab.
  const openPublishModalBound = (data) =>
    openPublishModal({
      ...data,
      h,
      api,
      pres,
      id,
      root,
      openOverlayClosers,
      lockDocumentScroll,
      copyToClipboard,
      syncPublishUi: syncShareUi,
    });

  const doPublishBound = ({ openPublishModal: opm } = {}) =>
    doPublish({
      h,
      root,
      api,
      toast,
      pres,
      id,
      requestSave,
      openPublishModal: opm || openPublishModalBound,
      openOverlayClosers,
    });

  const openExport = () =>
    openExportModal({ pres, id, root: root || document.body, overlayClosers: openOverlayClosers });

  button.addEventListener('click', () => {
    dialog = openShareModal({
      h,
      api,
      pres,
      id,
      root,
      openOverlayClosers,
      lockDocumentScroll,
      copyToClipboard,
      toast,
      currentUserEmail,
      isAdmin,
      isDirty,
      requestSave,
      editorState,
      syncShareUi,
      openDescriptionModal,
      doPublish: doPublishBound,
      buildPublishModalData,
      openPublishModal: openPublishModalBound,
      handleNotionPublish: () => handleNotionPublish({ api, toast, pres }),
      notionAvailable: () => notionAvailable,
      openExport,
    });
  });

  // Check whether Notion publishing is available (drives the Notion action).
  api('/api/notion/status')
    .then((resp) => {
      notionAvailable = !!resp?.enabled;
    })
    .catch(() => {
      notionAvailable = false;
    });

  syncShareUi();

  const detach = () => {
    try {
      dialog?.close?.();
    } catch {
      // ignore
    }
    dialog = null;
  };

  return { shareEl: button, syncShareUi, detach };
}
