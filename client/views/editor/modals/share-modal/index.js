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
import { isOwner } from '../../../../../shared/identity-match.js';
import { createModal } from '../../../../lib/dom/modal.js';
import { createSegmented } from '../../../../lib/dom/segmented.js';
import { getFeatures } from '../../../../lib/state/features.js';
import { createCollaboratorsSection } from './collaborators-section.js';
import { createShareLinksSection } from './share-links-section.js';
import { createVisibilitySection } from './visibility-section.js';
import { createPublishSection } from './publish-section.js';
import { h } from '../../../../lib/dom.js';

/**
 * Open the unified share dialog.
 *
 * @param {Object} options
 * @param {Function} options.api - API call function
 * @param {Object} options.pres - Presentation object
 * @param {string} options.id - Presentation ID
 * @param {HTMLElement} options.root - Root element to append the modal to
 * @param {Function} options.lockDocumentScroll - Locks document scroll
 * @param {Function} options.copyToClipboard - Copies text to the clipboard
 * @param {Object} options.toast - Toast notification service
 * @param {Object} options.currentUser - Current user (carries `id`); decides ownership
 * @param {string} options.currentUserEmail - Current user's email, for invites and display
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
 * @param {'organization'|'link'|'publish'} [options.initialTab] - Tab to open on
 * @returns {{ close: Function, refresh: Function }}
 */
export function openShareModal({
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
  doPublish,
  buildPublishModalData,
  openPublishModal,
  handleNotionPublish,
  notionAvailable,
  openExport,
  initialTab = 'organization',
} = {}) {
  if (!root) return { close: () => {}, refresh: () => {} };

  const unlockScroll = lockDocumentScroll();
  let collaborators = null;

  const modal = createModal({
    title: t('share.modal.title', 'Share'),
    modalClass: 'share-modal',
    onClose: () => {
      unlockScroll();
      collaborators?.detach?.();
    },
  });
  const close = () => modal.close();

  // Drives the transfer-ownership affordance in collaborators, mirroring the
  // server's `canTransferOwnership`: decided on the stable user id, and on the
  // **owner** stamp only since D43 — a creator who has handed the deck over is
  // refused by the server, so the button would be an affordance that 401s. The
  // emails below stay: inviting a collaborator is an email mechanism, and the
  // owner's address is displayed.
  const canTransfer = isOwner(currentUser, pres);

  // --- Organization tab (labelled "Workspace" in the UI) ---
  const visibility = createVisibilitySection({
    api,
    pres,
    id,
    toast,
    isDirty,
    requestSave,
    editorState,
    syncShareUi: () => {
      syncShareUi?.();
      publish?.refresh();
    },
    isAdmin,
    modalRoot: root,
    openDescriptionModal,
  });

  collaborators = createCollaboratorsSection({
    api,
    presentationId: id,
    pres,
    currentUserEmail,
    toast,
    canTransfer,
    modalRoot: root,
  });

  const organizationPanel = h(
    'div',
    { class: 'share-tab-panel', 'data-tab': 'organization' },
    [visibility.element, collaborators.element],
  );

  // --- Link tab ---
  const shareLinks = createShareLinksSection({
    api,
    presentationId: id,
    copyToClipboard,
    toast,
    modalRoot: root,
  });
  const linkPanel = h('div', { class: 'share-tab-panel', 'data-tab': 'link' }, [
    shareLinks.element,
  ]);

  // --- Publish tab ---
  // Sandbox stance: no public published URLs, so the Publish tab is omitted
  // entirely (no dead button). Mirrors the server-side 403 on /publish.
  const publishAvailable = !getFeatures()?.sandboxMode;
  const publish = publishAvailable
    ? createPublishSection({
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
      })
    : null;
  const publishPanel = publish
    ? h('div', { class: 'share-tab-panel', 'data-tab': 'publish' }, [
        publish.element,
      ])
    : null;

  const panels = {
    organization: organizationPanel,
    link: linkPanel,
    ...(publishPanel ? { publish: publishPanel } : {}),
  };

  const showTab = (tab) => {
    for (const [key, panel] of Object.entries(panels)) {
      panel.hidden = key !== tab;
    }
  };

  const tabs = createSegmented({
    outlined: true,
    className: 'share-tabs',
    ariaLabel: t('share.modal.title', 'Share'),
    value: panels[initialTab] ? initialTab : 'organization',
    segments: [
      {
        value: 'organization',
        label: t('share.tab.organization', 'Workspace'),
      },
      { value: 'link', label: t('share.tab.link', 'Link') },
      ...(publishPanel
        ? [{ value: 'publish', label: t('share.tab.publish', 'Publish') }]
        : []),
    ],
    onSelect: (val) => showTab(val),
  });

  const body = h('div', { class: 'share-modal-body' }, [
    organizationPanel,
    linkPanel,
    ...(publishPanel ? [publishPanel] : []),
  ]);

  modal.append(tabs.el, body);
  modal.show(root);

  showTab(tabs.getValue());

  // Initial data loads
  collaborators.loadCollaborators();
  shareLinks.loadShareLinks();

  return {
    close,
    refresh: () => {
      visibility.refresh();
      publish?.refresh();
    },
  };
}
