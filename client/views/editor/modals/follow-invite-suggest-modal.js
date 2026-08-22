import { createModal } from '../../../lib/dom/modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { h } from '../../../lib/dom.js';

/**
 * Modal to suggest adding a follow-invite slide when the user adds an interactive slide.
 */
export function openFollowInviteSuggestModal({
  root,
  onAddAsSecond,
  onAddBeforeCurrent,
  onSkip,
} = {}) {
  // Every exit that is not one of the two "add" buttons counts as a skip:
  // Escape, the backdrop, the header close and "Skip for now" alike.
  const modal = createModal({
    title: t('editor.followInviteSuggest.title', 'Add a QR code slide?'),
    modalClass: 'ps-modal follow-invite-suggest-modal',
    closeButton: 'icon',
    onClose: (result) => {
      if (result?.added !== true) onSkip?.();
    },
  });
  modal.header.classList.add('ps-modal-header');
  modal.content.classList.add('ps-modal-body');

  const description = h('p', {
    class: 'follow-invite-suggest-description',
    text: t(
      'editor.followInviteSuggest.description',
      'You\'re adding an interactive slide that requires audience participation. To let your audience join, you need a "Follow along" slide with a QR code. Would you like to add one?',
    ),
  });

  const buttonsRow = h('div', { class: 'follow-invite-suggest-buttons' });

  const addSecondBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: t('editor.followInviteSuggest.addAsSecond', 'Add as second slide'),
    onclick: () => {
      modal.close({ added: true });
      onAddAsSecond?.();
    },
  });

  const addBeforeBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t(
      'editor.followInviteSuggest.addBeforeCurrent',
      'Add before this slide',
    ),
    onclick: () => {
      modal.close({ added: true });
      onAddBeforeCurrent?.();
    },
  });

  const skipBtn = h('button', {
    class: 'btn btn-ghost',
    type: 'button',
    text: t('editor.followInviteSuggest.skip', 'Skip for now'),
    onclick: () => modal.close(),
  });

  buttonsRow.append(addSecondBtn, addBeforeBtn, skipBtn);

  modal.append(description, buttonsRow);
  modal.show(root);
}
