/**
 * Formatting toolbar for the comment composer.
 *
 * Phase 2a of the rich-input plan: one button, for links. It lives beside the
 * Post button rather than in a bar of its own, so the composer keeps its
 * height and the control row stays a single row.
 *
 * The composer owns the editing (`applyLink`); this module only collects a
 * URL. Keeping it separate means `comment-rich-input.js` stays free of modal
 * and i18n dependencies, and a composer without a toolbar (the share viewer
 * could opt out) needs no changes.
 */

import { h } from '../dom.js';
import { t } from '../ui-i18n.js';
import { promptModal } from '../dom/modal.js';
import { safeLinkUrl } from '../../../shared/comment-mentions.js';

/**
 * Build a link button bound to a rich comment input.
 *
 * @param {Object} options
 * @param {{getSelectedText: Function, applyLink: Function, focus: Function}}
 *   options.input - A `createRichCommentInput` instance.
 * @param {HTMLElement} [options.root] - Modal mount point (defaults to body).
 * @param {string} [options.className] - Extra classes on the button.
 * @returns {HTMLElement} the button
 */
export function createCommentLinkButton({ input, root, className = '' }) {
  const btn = h('button', {
    class: `btn btn-sm comment-toolbar-btn${className ? ` ${className}` : ''}`,
    type: 'button',
    title: t('comments.link.add', 'Add link'),
    'aria-label': t('comments.link.add', 'Add link'),
    text: t('comments.link.short', 'Link'),
  });

  // Snapshot the selection on mousedown, before focus can move: by the time
  // the dialog is open the live selection is gone. preventDefault keeps the
  // composer focused too, so cancelling leaves the caret where it was.
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    input.rememberSelection?.();
  });

  btn.addEventListener('click', async () => {
    // Keyboard activation (Enter/Space) fires click without mousedown.
    if (!input.getSelectedText?.()) input.rememberSelection?.();
    const selected = input.getSelectedText?.() || '';

    const url = await promptModal(h, root || document.body, {
      title: t('comments.link.add', 'Add link'),
      message: selected
        ? t('comments.link.messageWithSelection', 'Link "{text}" to:').replace(
            '{text}',
            selected.length > 40 ? `${selected.slice(0, 40)}…` : selected
          )
        : t('comments.link.message', 'Paste a URL. It will show as a link.'),
      placeholder: 'https://',
      validate: (value) =>
        safeLinkUrl(value)
          ? null
          : t('comments.link.invalid', 'Use an http://, https:// or mailto: address'),
    });

    if (!url) {
      input.focus?.();
      return;
    }
    input.applyLink?.({ url, label: selected });
    input.focus?.();
  });

  return btn;
}
