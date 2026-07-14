/**
 * Share modal for creating and managing share links and collaborators.
 * Allows users to invite workspace users and create token-based links.
 *
 * This module assembles the collaborators and share links sections into a unified modal.
 */

import { t } from '../../../../lib/ui-i18n.js';
import { createCollaboratorsSection } from './collaborators-section.js';
import { createShareLinksSection } from './share-links-section.js';

/**
 * Open the share modal.
 * @param {Object} options
 * @param {Function} options.h - Hyperscript function for creating DOM elements
 * @param {Function} options.api - API call function
 * @param {Object} options.pres - Presentation object
 * @param {string} options.id - Presentation ID
 * @param {HTMLElement} options.root - Root element to append modal to
 * @param {Set} options.openOverlayClosers - Set of overlay close functions
 * @param {Function} options.lockDocumentScroll - Function to lock document scroll
 * @param {Function} options.copyToClipboard - Function to copy text to clipboard
 * @param {Object} options.toast - Toast notification service
 * @param {string} options.currentUserEmail - Current user's email
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
} = {}) {
  if (!root) return;

  const backdrop = h('div', { class: 'modal-backdrop' });
  const modal = h('div', { class: 'modal share-modal' });

  const unlockScroll = lockDocumentScroll();
  let closed = false;
  let collaborators = null;

  const close = () => {
    if (closed) return;
    closed = true;
    unlockScroll();
    collaborators?.detach?.();
    openOverlayClosers?.delete?.(close);
    backdrop.remove();
  };
  openOverlayClosers?.add?.(close);

  // Header
  const header = h('div', { class: 'row spread' });
  header.append(
    h('h2', { text: t('share.modal.title', 'Share') }),
    h('button', {
      class: 'btn btn-secondary',
      text: t('common.close', 'Close'),
      onclick: () => close(),
    })
  );

  // Determine if current user is the owner
  const ownerEmail = pres?.ownerEmail || pres?.createdBy;
  const isOwner = currentUserEmail && ownerEmail &&
    currentUserEmail.toLowerCase() === ownerEmail.toLowerCase();

  // Create sections
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

  const shareLinks = createShareLinksSection({
    h,
    api,
    presentationId: id,
    copyToClipboard,
    toast,
    modalRoot: root,
    openOverlayClosers,
  });

  // Assemble modal
  modal.append(header, collaborators.element, shareLinks.element);
  backdrop.append(modal);

  // Event handlers
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') close();
    },
    { once: true }
  );

  root.append(backdrop);

  // Initial load
  collaborators.loadCollaborators();
  shareLinks.loadShareLinks();
}