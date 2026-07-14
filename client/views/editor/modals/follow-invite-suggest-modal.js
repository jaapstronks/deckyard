import { t } from '../../../lib/ui-i18n.js';

/**
 * Modal to suggest adding a follow-invite slide when the user adds an interactive slide.
 */
export function openFollowInviteSuggestModal({
  h,
  root,
  openOverlayClosers,
  onAddAsSecond,
  onAddBeforeCurrent,
  onSkip,
} = {}) {
  const backdrop = h('div', { class: 'modal-backdrop ps-modal-overlay' });
  const modal = h('div', { class: 'modal ps-modal follow-invite-suggest-modal' });
  const header = h('div', { class: 'ps-modal-header' });
  const title = h('h2', {
    text: t('editor.followInviteSuggest.title', 'Add a QR code slide?'),
  });
  const closeBtn = h(
    'button',
    {
      class: 'btn btn-secondary btn-icon ps-modal-close',
      type: 'button',
      'aria-label': t('common.close', 'Close'),
      onclick: () => close(true),
    },
    [
      h(
        'svg',
        {
          width: '16',
          height: '16',
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': '2',
        },
        [h('path', { d: 'M18 6L6 18M6 6l12 12' })]
      ),
    ]
  );
  header.append(title, closeBtn);

  const body = h('div', { class: 'ps-modal-body' });

  const description = h('p', {
    class: 'follow-invite-suggest-description',
    text: t(
      'editor.followInviteSuggest.description',
      'You\'re adding an interactive slide that requires audience participation. To let your audience join, you need a "Follow along" slide with a QR code. Would you like to add one?'
    ),
  });

  const buttonsRow = h('div', { class: 'follow-invite-suggest-buttons' });

  const addSecondBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: t('editor.followInviteSuggest.addAsSecond', 'Add as second slide'),
    onclick: () => {
      close(false);
      onAddAsSecond?.();
    },
  });

  const addBeforeBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('editor.followInviteSuggest.addBeforeCurrent', 'Add before this slide'),
    onclick: () => {
      close(false);
      onAddBeforeCurrent?.();
    },
  });

  const skipBtn = h('button', {
    class: 'btn btn-ghost',
    type: 'button',
    text: t('editor.followInviteSuggest.skip', 'Skip for now'),
    onclick: () => close(true),
  });

  buttonsRow.append(addSecondBtn, addBeforeBtn, skipBtn);

  const onKey = (e) => {
    if (e.key === 'Escape') close(true);
  };

  const close = (skipped) => {
    try {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
    } finally {
      openOverlayClosers?.delete(close);
    }
    if (skipped) onSkip?.();
  };

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close(true);
  });

  body.append(description, buttonsRow);
  modal.append(header, body);
  backdrop.append(modal);
  root.append(backdrop);
  openOverlayClosers?.add(close);
  document.addEventListener('keydown', onKey);
}
