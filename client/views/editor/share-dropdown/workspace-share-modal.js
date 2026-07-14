/**
 * Workspace share modal - lets user choose sharing options.
 */

import { t } from '../../../lib/ui-i18n.js';
import { createPromiseModal } from '../../../lib/modal.js';

/**
 * Open a modal to choose workspace sharing options.
 * @param {Object} options
 * @param {Function} options.h - DOM helper
 * @param {Object} options.pres - Presentation object
 * @param {HTMLElement} options.root - Root element for modal
 * @returns {Promise<{ isStarterKit: boolean, isViewOnly: boolean } | null>}
 */
export function openWorkspaceShareModal({ h, pres, root }) {
  const modalApi = createPromiseModal(h, {
    title: t('editor.share.workspace.title', 'Share to workspace'),
    hint: t(
      'editor.share.workspace.description',
      'Choose how you want to share "{title}" with the workspace.',
      { title: pres?.title || t('editor.share.thisPresentation', 'this presentation') }
    ),
    modalClass: 'modal-workspace-share',
  });

  // Regular share option (full edit access)
  const regularOption = h('label', { class: 'share-option' });
  const regularRadio = h('input', {
    type: 'radio',
    name: 'share-type',
    value: 'regular',
    checked: true,
  });
  const regularContent = h('div', { class: 'share-option-content' });
  regularContent.append(
    h('span', { class: 'share-option-title', text: t('editor.share.workspace.regular', 'Full access') }),
    h('span', {
      class: 'share-option-desc',
      text: t('editor.share.workspace.regularDesc', 'Everyone can view and edit this presentation.'),
    })
  );
  regularOption.append(regularRadio, regularContent);

  // View only option
  const viewOnlyOption = h('label', { class: 'share-option' });
  const viewOnlyRadio = h('input', {
    type: 'radio',
    name: 'share-type',
    value: 'view-only',
  });
  const viewOnlyContent = h('div', { class: 'share-option-content' });
  viewOnlyContent.append(
    h('span', { class: 'share-option-title', text: t('editor.share.workspace.viewOnly', 'View & comment') }),
    h('span', {
      class: 'share-option-desc',
      text: t('editor.share.workspace.viewOnlyDesc', 'Others can view and comment, but not edit. Use this to share finished presentations.'),
    })
  );
  viewOnlyOption.append(viewOnlyRadio, viewOnlyContent);

  // Starter kit option (view + duplicate)
  const starterKitOption = h('label', { class: 'share-option' });
  const starterKitRadio = h('input', {
    type: 'radio',
    name: 'share-type',
    value: 'starter-kit',
  });
  const starterKitContent = h('div', { class: 'share-option-content' });
  starterKitContent.append(
    h('span', { class: 'share-option-title', text: t('editor.share.workspace.starterKit', 'Starter kit') }),
    h('span', {
      class: 'share-option-desc',
      text: t('editor.share.workspace.starterKitDesc', 'Others can view and duplicate, but not edit. Ideal for templates.'),
    })
  );
  starterKitOption.append(starterKitRadio, starterKitContent);

  const optionsWrap = h('div', { class: 'share-options' });
  optionsWrap.append(regularOption, viewOnlyOption, starterKitOption);

  const actions = h('div', { class: 'row is-end modal-actions' });
  const cancelBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('common.cancel', 'Cancel'),
    onclick: () => modalApi.close(null),
  });
  const shareBtn = h('button', {
    class: 'btn btn-primary',
    text: t('editor.share.workspace.share', 'Share'),
    onclick: () => {
      const isStarterKit = starterKitRadio.checked;
      const isViewOnly = viewOnlyRadio.checked;
      modalApi.close({ isStarterKit, isViewOnly });
    },
  });
  actions.append(cancelBtn, shareBtn);

  modalApi.append(optionsWrap, actions);
  modalApi.show(root);

  return modalApi.promise;
}
