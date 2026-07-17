/**
 * Share dropdown - sharing and publishing options.
 * Contains: Share links, Share to workspace, Publish/Unpublish, Add to Notion
 */

import { lockDocumentScroll } from './editor-utils.js';
import { copyToClipboard } from './publish-export/clipboard.js';
import { openPublishModal } from './publish-export/publish-modal.js';
import { doPublish, buildPublishModalData } from './publish-export/publish.js';
import { openShareModal } from './modals/share-modal.js';
import { openDescriptionModal } from './modals/description-modal.js';
import { makeDropdownCaret } from '../../lib/icons.js';
import { createDropdown } from '../../lib/dropdown.js';
import { confirmModal } from '../../lib/modal.js';
import { t } from '../../lib/ui-i18n.js';
import { handleShareToWorkspace, handleMoveToPrivate, handleNotionPublish } from './share-dropdown/share-actions.js';
import { createSyncShareUi } from './share-dropdown/ui-sync.js';

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
  let syncShareUi = () => {};
  let notionAvailable = false;

  const doPublishWithModal = async () =>
    doPublish({
      h,
      root,
      api,
      toast,
      pres,
      id,
      requestSave,
      openPublishModal: (data) =>
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
        }),
      openOverlayClosers,
    });

  const summaryLabel = h('span', { text: t('editor.share.button', 'Share') });
  const { details: shareDetails, summary: shareSummary, menu, close, detach } = createDropdown({
    h,
    triggerClass: 'btn btn-secondary',
    triggerContent: [summaryLabel, makeDropdownCaret()],
    title: t('editor.share.title', 'Share and publish options'),
  });

  // Share links (token-based external sharing)
  const shareLinksItem = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('editor.share.links', 'Share links...'),
    title: t('editor.share.links.title', 'Create shareable links for external users (no account required).'),
    onclick: () => {
      close();
      openShareModal({
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
      });
    },
  });

  // Share to workspace
  const shareToWorkspaceItem = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('editor.share.workspace', 'Share to workspace'),
    title: t('editor.share.workspace.title', 'Make this presentation available to everyone in the workspace.'),
    onclick: async () => {
      close();
      await handleShareToWorkspace({
        h,
        api,
        toast,
        pres,
        id,
        root,
        isDirty,
        requestSave,
        openDescriptionModal,
        openOverlayClosers,
        syncShareUi,
        editorState,
      });
    },
  });

  // Move to private (admin only)
  const moveToPrivateItem = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('editor.share.private', 'Move to private'),
    title: t('editor.share.private.title', 'Move this presentation from workspace to your private collection.'),
    onclick: async () => {
      close();
      await handleMoveToPrivate({
        api,
        toast,
        pres,
        id,
        isDirty,
        requestSave,
        syncShareUi,
        editorState,
      });
    },
  });

  // Publish
  const publishItem = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('editor.publish.publish', 'Publish'),
    onclick: async () => {
      close();
      try {
        // If already published, just open the modal with existing data (fast path)
        if (pres?.published?.id) {
          const modalData = buildPublishModalData({ pres });
          openPublishModal({
            ...modalData,
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
          return;
        }
        // Not published yet - go through full publish flow
        const pub = await doPublishWithModal();
        if (!pub) return;
        syncShareUi();
      } catch (e) {
        onError?.(e);
      }
    },
  });

  // Unpublish
  const unpublishItem = h('button', {
    class: 'dropdown-item is-danger',
    type: 'button',
    text: t('editor.publish.unpublish', 'Unpublish'),
    onclick: async () => {
      close();
      const publishId = typeof pres?.published?.id === 'string' ? pres.published.id : '';
      if (!publishId) return;
      const ok = await confirmModal(h, root || document.body, {
        title: t('editor.publish.unpublish', 'Unpublish'),
        message: t(
          'editor.publish.unpublish.confirm',
          'Unpublish?\n\nThis will invalidate the public link and embed links.'
        ),
        confirmLabel: t('editor.publish.unpublish', 'Unpublish'),
        danger: true,
      });
      if (!ok) return;
      try {
        await api(`/api/presentations/${id}/publish`, { method: 'DELETE' });
        delete pres.published;
        syncShareUi();
      } catch (e) {
        onError?.(e);
      }
    },
  });

  // Add to Notion page
  const notionPublishItem = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('editor.publish.notion', 'Add to Notion page'),
    onclick: async () => {
      close();
      await handleNotionPublish({ api, toast, pres });
    },
  });
  notionPublishItem.style.display = 'none';

  // Check if Notion is available
  api('/api/notion/status')
    .then((resp) => {
      notionAvailable = !!resp?.enabled;
      syncShareUi();
    })
    .catch(() => {
      notionAvailable = false;
    });

  // Assemble menu
  menu.append(
    shareLinksItem,
    shareToWorkspaceItem,
    moveToPrivateItem,
    h('div', { class: 'dropdown-sep' }),
    publishItem,
    unpublishItem,
    notionPublishItem
  );

  // Initially hide moveToPrivateItem (will be shown via syncShareUi if appropriate)
  moveToPrivateItem.style.display = 'none';

  // Create syncShareUi function
  syncShareUi = createSyncShareUi({
    h,
    pres,
    isAdmin,
    notionAvailable: () => notionAvailable,
    summaryLabel,
    shareSummary,
    publishItem,
    unpublishItem,
    moveToPrivateItem,
    notionPublishItem,
  });
  syncShareUi();

  return { shareEl: shareDetails, syncShareUi, detach };
}
