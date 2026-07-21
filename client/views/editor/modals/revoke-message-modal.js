/**
 * Modal for confirming revocation with optional message.
 * Used for revoking share links, removing collaborators, and trashing presentations.
 */

import { createPromiseModal, createBusyManager } from '../../../lib/dom/modal.js';
import { t } from '../../../lib/ui-i18n.js';

/**
 * Context types for the modal.
 */
export const REVOKE_CONTEXT = {
  SHARE_LINK: 'share_link',
  COLLABORATOR: 'collaborator',
  TRASH: 'trash',
};

/**
 * Open the revoke message modal.
 * @param {Object} options
 * @param {Function} options.h - Hyperscript function
 * @param {HTMLElement} options.root - Root element for modal
 * @param {string} options.context - Context type (share_link, collaborator, trash)
 * @param {string} [options.targetName] - Name/email of what's being revoked
 * @param {Array} [options.openOverlayClosers] - Overlay closers array
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
export function openRevokeMessageModal({
  h,
  root,
  context,
  targetName,
  openOverlayClosers,
}) {
  const titles = {
    [REVOKE_CONTEXT.SHARE_LINK]: t('share.revoke.modalTitle.shareLink', 'Revoke Share Link'),
    [REVOKE_CONTEXT.COLLABORATOR]: t('share.revoke.modalTitle.collaborator', 'Remove Collaborator'),
    [REVOKE_CONTEXT.TRASH]: t('share.revoke.modalTitle.trash', 'Move to Trash'),
  };

  const descriptions = {
    [REVOKE_CONTEXT.SHARE_LINK]: t(
      'share.revoke.description.shareLink',
      'This will revoke the share link. Anyone who has this link will no longer be able to access the presentation.'
    ),
    [REVOKE_CONTEXT.COLLABORATOR]: t(
      'share.revoke.description.collaborator',
      'This will remove {name} as a collaborator. They will no longer have access to this presentation.',
      { name: targetName || 'this user' }
    ),
    [REVOKE_CONTEXT.TRASH]: t(
      'share.revoke.description.trash',
      'This will move the presentation to trash. Collaborators will no longer have access.'
    ),
  };

  const confirmLabels = {
    [REVOKE_CONTEXT.SHARE_LINK]: t('share.revoke.confirm.shareLink', 'Revoke'),
    [REVOKE_CONTEXT.COLLABORATOR]: t('share.revoke.confirm.collaborator', 'Remove'),
    [REVOKE_CONTEXT.TRASH]: t('share.revoke.confirm.trash', 'Move to Trash'),
  };

  const modal = createPromiseModal(h, {
    title: titles[context] || titles[REVOKE_CONTEXT.SHARE_LINK],
    closeOnBackdrop: true,
    onClose: (result) => result,
  });

  // Description
  const description = h('p', {
    class: 'revoke-modal-description',
    text: descriptions[context] || descriptions[REVOKE_CONTEXT.SHARE_LINK],
  });

  // Message section - collapsed by default
  const messageSection = h('div', { class: 'revoke-modal-message-section' });
  const messageToggle = h('a', {
    href: '#',
    class: 'revoke-modal-message-toggle',
    text: t('share.revoke.addMessage', 'Add a message'),
    onclick: (e) => {
      e.preventDefault();
      messageToggle.style.display = 'none';
      messageExpanded.style.display = '';
      textarea.focus();
    },
  });

  const messageExpanded = h('div', { class: 'revoke-modal-message-expanded' });
  messageExpanded.style.display = 'none';

  const messageLabel = h('label', {
    class: 'form-label',
    text: t('share.revoke.messageLabel', 'Message (optional)'),
  });

  const textarea = h('textarea', {
    class: 'form-input revoke-modal-textarea',
    placeholder: t('share.revoke.messagePlaceholder', 'Let them know why...'),
    maxLength: 1000,
    rows: 3,
    onkeydown: (e) => {
      // Ctrl/Cmd + Enter to confirm from textarea
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        btnConfirm.click();
      }
    },
  });

  const charCount = h('div', { class: 'help revoke-modal-char-count', text: '0/1000' });
  textarea.addEventListener('input', () => {
    const len = textarea.value.length;
    charCount.textContent = `${len}/1000`;
    if (len > 900) {
      charCount.classList.add('is-warning');
    } else {
      charCount.classList.remove('is-warning');
    }
  });

  const messageHelp = h('div', {
    class: 'help',
    text: t('share.revoke.messageHelp', 'This message will be shown to anyone who tries to access.'),
  });

  messageExpanded.append(messageLabel, textarea, charCount, messageHelp);
  messageSection.append(messageToggle, messageExpanded);

  // Buttons
  const btnRow = h('div', { class: 'row is-end is-mt-8 revoke-modal-buttons' });

  const btnCancel = h('button', {
    class: 'btn btn-secondary',
    text: t('common.cancel', 'Cancel'),
    onclick: () => modal.close({ ok: false }),
  });

  const btnConfirm = h('button', {
    class: 'btn btn-danger',
    text: confirmLabels[context] || confirmLabels[REVOKE_CONTEXT.SHARE_LINK],
    onclick: () => {
      const message = textarea.value.trim() || null;
      modal.close({ ok: true, message });
    },
  });

  // Busy manager for disabling during async operations (if needed later)
  createBusyManager([btnCancel, btnConfirm, textarea]);

  btnRow.append(btnCancel, btnConfirm);

  modal.content.append(description, messageSection, btnRow);

  // Keyboard handler: Enter to confirm when not typing in textarea
  const handleKeydown = (e) => {
    if (e.key === 'Enter' && document.activeElement !== textarea) {
      e.preventDefault();
      btnConfirm.click();
    }
  };
  modal.content.addEventListener('keydown', handleKeydown);

  modal.show(root, openOverlayClosers);

  return modal.promise;
}
