/**
 * Share button — opens the unified Share dialog.
 *
 * This used to render a dropdown menu ("Share links…", "Share to workspace",
 * "Move to private", Publish/Unpublish, Notion). Those overlapping entries are
 * now one dialog (`modals/share-modal`) with Team / Guests / Public tabs; the
 * button just opens it and keeps its published-state indicator in sync.
 */

import { lockDocumentScroll } from './editor-utils.js';
import { copyToClipboard } from './publish-export/clipboard.js';
import { openPreviewAddressModal } from './publish-export/preview-address-modal.js';
import { doPublish } from './publish-export/publish.js';
import { openShareModal } from './modals/share-modal.js';
import { openDescriptionModal } from './modals/description-modal.js';
import { openExportModal } from './export-modal.js';
import { t } from '../../lib/ui-i18n.js';
import { handleNotionPublish } from './share-dropdown/share-actions.js';
import { h } from '../../lib/dom.js';

export function setupShareDropdown({
  api,
  toast,
  pres,
  id,
  requestSave,
  isDirty,
  root,
  editorState,
  currentUser,
  currentUserEmail,
  isAdmin,
  slideTypes,
} = {}) {
  let notionAvailable = false;
  let dialog = null;

  const button = h('button', {
    class: 'btn btn-secondary editor-share-btn',
    type: 'button',
    text: t('editor.share.button', 'Share'),
    title: t('editor.share.title', 'Share and publish options'),
  });

  /** Update the published-state indicator on the button (and any open dialog). */
  function syncShareUi() {
    const isPublished = !!(
      typeof pres?.published?.id === 'string' && pres.published.id
    );
    button.classList.toggle('btn-published', isPublished);
    try {
      const existingDot = button.querySelector('.live-dot');
      if (isPublished && !existingDot) {
        button.insertBefore(
          h('span', { class: 'live-dot', 'aria-hidden': 'true' }),
          button.firstChild,
        );
      } else if (!isPublished && existingDot) {
        existingDot.remove();
      }
    } catch {
      // ignore
    }
    dialog?.refresh?.();
  }

  // Bound helpers passed into the dialog's Public tab.
  const openPreviewAddress = () =>
    openPreviewAddressModal({
      api,
      pres,
      id,
      root,
      lockDocumentScroll,
      onChange: syncShareUi,
    });

  const doPublishBound = () =>
    doPublish({ root, api, toast, pres, id, requestSave });

  const openExport = () =>
    openExportModal({
      pres,
      id,
      root: root || document.body,
      openPublic: () => openShare({ initialTab: 'public' }),
    });

  /**
   * Open the Share dialog, on the Team tab unless another is asked for.
   * @param {{initialTab?: 'organization'|'guests'|'public'}} [opts]
   */
  function openShare({ initialTab } = {}) {
    dialog?.close?.();
    dialog = openShareModal({
      api,
      pres,
      id,
      root,
      lockDocumentScroll,
      copyToClipboard,
      toast,
      currentUser,
      currentUserEmail,
      isAdmin,
      isDirty,
      requestSave,
      editorState,
      syncShareUi,
      openDescriptionModal,
      doPublish: doPublishBound,
      slideTypes,
      openPreviewAddress,
      handleNotionPublish: () => handleNotionPublish({ api, toast, pres }),
      notionAvailable: () => notionAvailable,
      openExport,
      initialTab,
    });
  }

  button.addEventListener('click', () => openShare());

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

  return { shareEl: button, syncShareUi, openShare, detach };
}
