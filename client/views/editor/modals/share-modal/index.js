/**
 * Unified Share dialog.
 *
 * One place to answer "how do I get this deck in front of someone", organised
 * by audience rather than by mechanism:
 *   - Workspace: visibility + invite colleagues (hosted, you keep control)
 *   - Link: external token links for people without an account
 *   - Publish: put it on the open web + embed
 *
 * This replaces the old two-item split ("Share links…" + "Share to workspace")
 * and the separate publish/unpublish/notion dropdown entries.
 */

import { t } from '../../../../lib/ui-i18n.js';
import { createFocusTrap } from '../../../../lib/dom.js';
import { createSegmented } from '../../../../lib/dom/segmented.js';
import { createCollaboratorsSection } from './collaborators-section.js';
import { createShareLinksSection } from './share-links-section.js';
import { createWorkspaceVisibilitySection } from './workspace-visibility-section.js';
import { createPublishSection } from './publish-section.js';

/**
 * Open the unified share dialog.
 *
 * @param {Object} options
 * @param {Function} options.h - Hyperscript function
 * @param {Function} options.api - API call function
 * @param {Object} options.pres - Presentation object
 * @param {string} options.id - Presentation ID
 * @param {HTMLElement} options.root - Root element to append the modal to
 * @param {Set} options.openOverlayClosers - Set of overlay close functions
 * @param {Function} options.lockDocumentScroll - Locks document scroll
 * @param {Function} options.copyToClipboard - Copies text to the clipboard
 * @param {Object} options.toast - Toast notification service
 * @param {string} options.currentUserEmail - Current user's email
 * @param {boolean} options.isAdmin - Whether the current user is an admin
 * @param {Function} options.isDirty - Returns true if there are unsaved edits
 * @param {Function} options.requestSave - Persists pending edits
 * @param {Object} options.editorState - Editor state (refreshAll)
 * @param {Function} options.syncShareUi - Refresh topbar share button
 * @param {Function} options.openDescriptionModal - Opens the description modal
 * @param {Function} options.doPublish - Runs the publish flow
 * @param {Function} options.buildPublishModalData - Builds publish URLs
 * @param {Function} options.openPublishModal - Opens the publish management modal
 * @param {Function} options.handleNotionPublish - Adds the embed to Notion
 * @param {Function} options.notionAvailable - Returns true if Notion is enabled
 * @param {Function} options.openExport - Opens the Export modal
 * @param {'workspace'|'link'|'publish'} [options.initialTab] - Tab to open on
 * @returns {{ close: Function, refresh: Function }}
 */
export function openShareModal({
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
  doPublish,
  buildPublishModalData,
  openPublishModal,
  handleNotionPublish,
  notionAvailable,
  openExport,
  initialTab = 'workspace',
} = {}) {
  if (!root) return { close: () => {}, refresh: () => {} };

  const modalId = `share-modal-${Date.now()}`;
  const backdrop = h('div', { class: 'modal-backdrop' });
  const modal = h('div', {
    class: 'modal share-modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': `${modalId}-title`,
  });

  const unlockScroll = lockDocumentScroll();
  let closed = false;
  let detachFocusTrap = null;
  let collaborators = null;

  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };

  const close = () => {
    if (closed) return;
    closed = true;
    unlockScroll();
    collaborators?.detach?.();
    detachFocusTrap?.();
    document.removeEventListener('keydown', onKey);
    openOverlayClosers?.delete?.(close);
    backdrop.remove();
  };
  openOverlayClosers?.add?.(close);

  // Header
  const header = h('div', { class: 'row spread' });
  header.append(
    h('h2', {
      id: `${modalId}-title`,
      text: t('share.modal.title', 'Share'),
    }),
    h('button', {
      class: 'btn btn-secondary',
      text: t('common.close', 'Close'),
      onclick: () => close(),
    })
  );

  // Owner check drives the transfer-ownership affordance in collaborators.
  const ownerEmail = pres?.ownerEmail || pres?.createdBy;
  const isOwner = currentUserEmail && ownerEmail &&
    currentUserEmail.toLowerCase() === ownerEmail.toLowerCase();

  // --- Workspace tab ---
  const visibility = createWorkspaceVisibilitySection({
    h,
    api,
    pres,
    id,
    toast,
    isDirty,
    requestSave,
    editorState,
    syncShareUi: () => {
      syncShareUi?.();
      publish.refresh();
    },
    isAdmin,
    modalRoot: root,
    openDescriptionModal,
    openOverlayClosers,
  });

  collaborators = createCollaboratorsSection({
    h,
    api,
    presentationId: id,
    pres,
    currentUserEmail,
    toast,
    isOwner,
    modalRoot: root,
    openOverlayClosers,
  });

  const workspacePanel = h('div', { class: 'share-tab-panel', 'data-tab': 'workspace' }, [
    visibility.element,
    collaborators.element,
  ]);

  // --- Link tab ---
  const shareLinks = createShareLinksSection({
    h,
    api,
    presentationId: id,
    copyToClipboard,
    toast,
    modalRoot: root,
    openOverlayClosers,
  });
  const linkPanel = h('div', { class: 'share-tab-panel', 'data-tab': 'link' }, [
    shareLinks.element,
  ]);

  // --- Publish tab ---
  const publish = createPublishSection({
    h,
    api,
    pres,
    id,
    modalRoot: root,
    copyToClipboard,
    toast,
    doPublish,
    buildPublishModalData,
    openPublishModal,
    handleNotionPublish,
    notionAvailable,
    syncShareUi,
    openExport,
    requestClose: close,
  });
  const publishPanel = h('div', { class: 'share-tab-panel', 'data-tab': 'publish' }, [
    publish.element,
  ]);

  const panels = {
    workspace: workspacePanel,
    link: linkPanel,
    publish: publishPanel,
  };

  const showTab = (tab) => {
    for (const [key, panel] of Object.entries(panels)) {
      panel.hidden = key !== tab;
    }
  };

  const tabs = createSegmented({
    h,
    outlined: true,
    className: 'share-tabs',
    ariaLabel: t('share.modal.title', 'Share'),
    value: panels[initialTab] ? initialTab : 'workspace',
    segments: [
      { value: 'workspace', label: t('share.tab.workspace', 'Workspace') },
      { value: 'link', label: t('share.tab.link', 'Link') },
      { value: 'publish', label: t('share.tab.publish', 'Publish') },
    ],
    onSelect: (val) => showTab(val),
  });

  const body = h('div', { class: 'share-modal-body' }, [
    workspacePanel,
    linkPanel,
    publishPanel,
  ]);

  modal.append(header, tabs.el, body);
  backdrop.append(modal);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);

  root.append(backdrop);
  detachFocusTrap = createFocusTrap(modal);

  showTab(tabs.getValue());

  // Initial data loads
  collaborators.loadCollaborators();
  shareLinks.loadShareLinks();

  return {
    close,
    refresh: () => {
      visibility.refresh();
      publish.refresh();
    },
  };
}
