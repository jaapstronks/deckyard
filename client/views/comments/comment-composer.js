/**
 * The one comment composer (D355): a rich input with mentions and a Link
 * button, the inline refusal under it, and the submit (plus Cancel where the
 * composer is a transient card). The comments pane posts a slide comment
 * with it; the card that opens on a spot of the slide posts an anchored
 * comment with the same pieces, so both write the same way.
 */

import { t } from '../../lib/ui-i18n.js';
import { h } from '../../lib/dom/index.js';
import { createInlineError } from '../../lib/dom/inline-error.js';
import { takeEscape } from '../../lib/dom/escape.js';
import { createAnchorCardFrame } from './comment-anchor-card.js';
import { createRichCommentInput } from './comment-rich-input.js';
import { createCommentLinkButton } from './comment-toolbar.js';

/**
 * Build a composer. `onSubmit(body)` posts; when it throws, the error's
 * `message` shows inline under the input and the body stays.
 *
 * @param {Object} opts
 * @param {HTMLElement} [opts.host] - Element to build into (a new div when
 *   omitted); it also hosts the mention popover.
 * @param {string} [opts.inputClass] - Extra class on the rich input.
 * @param {string} [opts.controlsClass] - Class of the controls row.
 * @param {(body: string) => Promise<void>} opts.onSubmit
 * @param {() => void} [opts.onCancel] - Adds a Cancel button and lets Escape
 *   in the composer cancel.
 * @param {Function} [opts.attachMentions] - `(input, host) => autocomplete`,
 *   from the comments pane; omitted where mentions do not exist (guests).
 * @returns {{ el: HTMLElement, input: Object, focus: Function, clear: Function, detach: Function }}
 */
export function createCommentComposer({
  host,
  inputClass = '',
  controlsClass = 'comments-input-controls is-between',
  onSubmit,
  onCancel,
  attachMentions,
}) {
  const el = host || h('div', { class: 'comment-composer' });
  let mentions = null;
  let busy = false;

  const input = createRichCommentInput({
    className: inputClass,
    placeholder: t('comments.addPlaceholder', 'Add a comment…'),
    onSubmit: () => submit(),
    // With the mention popover open, Enter picks a user instead.
    isSubmitBlocked: () => !!mentions?.isOpen(),
  });
  const error = createInlineError({ callout: true });
  const submitBtn = h('button', {
    class: 'btn btn-primary btn-sm',
    type: 'button',
    text: t('comments.post', 'Post'),
    onclick: () => submit(),
  });
  const controls = h('div', { class: controlsClass });
  controls.append(createCommentLinkButton({ input }));
  if (onCancel) {
    controls.append(
      h('button', {
        class: 'btn btn-secondary btn-sm',
        type: 'button',
        text: t('common.cancel', 'Cancel'),
        onclick: () => onCancel(),
      }),
    );
  }
  controls.append(submitBtn);
  el.append(input.el, error.el, controls);
  mentions = attachMentions?.(input, el) || null;

  // The composer is the innermost layer: an open mention popover takes the
  // press first (it listens on the input), then the composer cancels.
  const onKeydown = (e) => {
    if (onCancel && takeEscape(e)) onCancel();
  };
  el.addEventListener('keydown', onKeydown);

  async function submit() {
    const body = input.getValue().trim();
    error.clear();
    if (!body || busy) return;
    busy = true;
    submitBtn.disabled = true;
    try {
      await onSubmit(body);
      input.clear();
    } catch (err) {
      // `onSubmit` throws the sentence to show (see the JSDoc above).
      error.show(err.message, { control: input.el });
    } finally {
      busy = false;
      submitBtn.disabled = false;
    }
  }

  return {
    el,
    input,
    focus: () => input.focus(),
    clear: () => {
      input.clear();
      error.clear();
    },
    detach: () => {
      el.removeEventListener('keydown', onKeydown);
      mentions?.detach?.();
    },
  };
}

/**
 * The card that opens on a spot of the slide: the composer at the click
 * point, positioned inside `stageEl` relative to the rendered `thumbEl`.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.stageEl - Positioning context (not clipped).
 * @param {HTMLElement} opts.thumbEl - The slide box the percentages refer to.
 * @param {number} opts.x - Percent of the slide width.
 * @param {number} opts.y - Percent of the slide height.
 * @param {(body: string) => Promise<void>} opts.onSubmit
 * @param {() => void} opts.onCancel
 * @param {Function} [opts.attachMentions]
 * @returns {{ el: HTMLElement, detach: Function }}
 */
export function createAnchoredComposer({
  stageEl,
  thumbEl,
  x,
  y,
  onSubmit,
  onCancel,
  attachMentions,
}) {
  const el = createAnchorCardFrame({ stageEl, thumbEl, x, y });

  const composer = createCommentComposer({
    host: el,
    controlsClass: 'positioned-comment-popup-actions',
    onSubmit,
    onCancel,
    attachMentions,
  });

  composer.focus();

  return {
    el,
    detach: () => {
      composer.detach();
      el.remove();
    },
  };
}
