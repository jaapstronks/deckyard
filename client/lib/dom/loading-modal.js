/**
 * Loading Modal
 *
 * A slick loading modal with blur background and animated status messages.
 *
 * It is the one carrier of a long task (`docs/reference/feedback-surfaces.md`
 * § Long tasks): AI generation, file conversion, Notion import, importing a
 * PDF as slides, the AI analysis and every export that renders in Chrome. A
 * feature does not draw a progress bar of its own; it opens this modal and
 * feeds it (`tests/long-task-surface.test.js`).
 *
 * The modal owns the progress bar. Two rules keep it honest
 * (`docs/reference/import-progress.md`):
 *
 * - **It never walks backwards.** `setProgress` keeps the highest value it was
 *   given, so a later phase that reports a lower number cannot undo an earlier
 *   one.
 * - **A phase without events creeps, it does not stall.** `creepTo(ceiling)`
 *   eases the bar toward a ceiling it never reaches, so a single long model
 *   call still shows movement without claiming progress it cannot measure. The
 *   next real `setProgress` cancels the creep and takes over.
 */

import { spinner } from './spinner.js';
import { h } from './index.js';
import { t } from '../ui-i18n.js';
import { takeEscape } from './escape.js';

/**
 * Create and show a loading modal
 *
 * A task that can be stopped passes `onCancel`: the modal then carries a
 * Cancel button (and Escape presses it), closes itself and calls `onCancel`
 * once, where the caller aborts its request. Closing the request is how the
 * server learns to stop (`server/utils/client-disconnect.js`); the modal does
 * not wait for that.
 *
 * @param {Object} options
 * @param {HTMLElement} options.root - Root element to append to
 * @param {string} options.initialMessage - Initial status message
 * @param {string} options.title - Modal title (optional)
 * @param {() => void} [options.onCancel] - Makes the task cancellable
 * @returns {Object} Controller with update(), setProgress(), creepTo(),
 *   setTitle(), close() methods
 */
export function showLoadingModal({
  root,
  initialMessage = '',
  title = '',
  onCancel = null,
} = {}) {
  // Create backdrop with blur
  const backdrop = h('div', { class: 'loading-modal-backdrop' });

  // Create modal: a dialog while it stands in front of the page, busy until
  // it closes.
  const modal = h('div', {
    class: 'loading-modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-busy': 'true',
  });

  // Spinner animation
  const spinnerWrap = h('div', { class: 'loading-modal-spinner' });
  spinnerWrap.appendChild(spinner('xxl'));

  // Title (optional)
  const titleEl = h('div', {
    class: 'loading-modal-title',
    text: title || '',
  });
  if (!title) titleEl.style.display = 'none';

  if (title) modal.setAttribute('aria-label', title);

  // Status message
  const messageEl = h('div', {
    class: 'loading-modal-message',
    'aria-live': 'polite',
    text: initialMessage || '',
  });

  // Progress bar
  const progressWrap = h('div', { class: 'loading-modal-progress-wrap' });
  const progressBar = h('div', { class: 'loading-modal-progress-bar' });
  progressBar.style.width = '0%';
  progressWrap.appendChild(progressBar);

  // Progress text
  const progressText = h('div', { class: 'loading-modal-progress-text' });

  // Assemble
  modal.append(spinnerWrap, titleEl, messageEl, progressWrap, progressText);

  let closed = false;
  let cancelButton = null;
  if (onCancel) {
    cancelButton = h('button', {
      class: 'btn btn-secondary loading-modal-cancel',
      type: 'button',
      text: t('common.cancel', 'Cancel'),
      onclick: () => cancel(),
    });
    modal.append(cancelButton);
  }
  const onKeydown = (e) => {
    if (onCancel && takeEscape(e)) cancel();
  };
  backdrop.addEventListener('keydown', onKeydown);

  backdrop.appendChild(modal);
  root.appendChild(backdrop);
  // Focus goes into the dialog, onto the one thing a user can do in it.
  cancelButton?.focus();

  // Animate in
  requestAnimationFrame(() => {
    backdrop.classList.add('is-visible');
  });

  let currentMessage = initialMessage;
  /** The newest message that arrived mid-transition, or null. */
  let pendingMessage = null;
  let isTransitioning = false;

  /**
   * Update the status message with animation.
   *
   * One transition takes 500ms, and the closing phases of an import arrive
   * faster than that. A queue would walk through them in order and leave the
   * text a second behind the bar — reading "Building presentation…" at 100%.
   * So a message that arrives mid-transition *replaces* the one waiting: the
   * line always catches up to what is happening now (B595).
   *
   * @param {string} newMessage
   * @param {Object} [opts]
   * @param {boolean} [opts.immediate] - Swap the text without the fade. The
   *   closing phases of an import arrive in step with the transition, which
   *   leaves the line one message behind the bar — reading "Building
   *   presentation…" at 100%. They snap instead.
   */
  const updateMessage = (newMessage, { immediate = false } = {}) => {
    if (!newMessage || newMessage === currentMessage) return;

    if (immediate) {
      pendingMessage = null;
      isTransitioning = false;
      currentMessage = newMessage;
      messageEl.classList.remove('is-fading', 'is-appearing');
      messageEl.textContent = newMessage;
      return;
    }

    if (isTransitioning) {
      pendingMessage = newMessage;
      return;
    }

    isTransitioning = true;
    currentMessage = newMessage;

    // Fade out
    messageEl.classList.add('is-fading');

    setTimeout(() => {
      messageEl.textContent = newMessage;
      messageEl.classList.remove('is-fading');
      messageEl.classList.add('is-appearing');

      setTimeout(() => {
        messageEl.classList.remove('is-appearing');
        isTransitioning = false;

        if (pendingMessage) {
          const next = pendingMessage;
          pendingMessage = null;
          updateMessage(next);
        }
      }, 300);
    }, 200);
  };

  let progress = 0;
  let creepTimer = null;

  const stopCreep = () => {
    if (creepTimer) {
      clearInterval(creepTimer);
      creepTimer = null;
    }
  };

  const paint = (value) => {
    progress = value;
    progressBar.style.width = `${value}%`;
    progressText.textContent = `${Math.round(value)}%`;
  };

  /**
   * Set progress (0-100). Monotonic: a lower value than the bar already shows
   * is ignored, so the bar never walks backwards. Cancels any running creep.
   */
  const setProgress = (percent) => {
    stopCreep();
    const clamped = Math.max(0, Math.min(100, percent));
    if (clamped <= progress) return;
    paint(clamped);
  };

  /**
   * Ease the bar toward `ceiling` over roughly `durationMs`, asymptotically:
   * it covers ~95% of the distance in that time and never arrives, so a phase
   * that runs long keeps moving instead of stalling and never claims to be
   * finished. Cancelled by the next `setProgress` or by `close`.
   *
   * @param {number} ceiling - Upper bound this phase may approach (0-100).
   * @param {Object} [opts]
   * @param {number} [opts.durationMs] - Expected duration of the phase.
   */
  const creepTo = (ceiling, { durationMs = 30000 } = {}) => {
    stopCreep();
    const target = Math.max(0, Math.min(100, ceiling));
    const start = progress;
    const span = target - start;
    if (span <= 0) return;
    const startedAt = Date.now();
    // tau = duration/3 puts the curve at ~95% of the span after durationMs.
    const tau = Math.max(1, durationMs / 3);
    creepTimer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      paint(start + span * (1 - Math.exp(-elapsed / tau)));
    }, 250);
  };

  /**
   * Close the modal with animation. Idempotent.
   */
  const close = () => {
    if (closed) return;
    closed = true;
    stopCreep();
    modal.setAttribute('aria-busy', 'false');
    backdrop.classList.remove('is-visible');
    backdrop.classList.add('is-closing');

    setTimeout(() => {
      backdrop.remove();
    }, 300);
  };

  /** Cancel the task: close, then let the caller abort its work. */
  function cancel() {
    if (closed) return;
    close();
    onCancel?.();
  }

  /**
   * Set the title
   */
  const setTitle = (newTitle) => {
    titleEl.textContent = newTitle || '';
    titleEl.style.display = newTitle ? '' : 'none';
  };

  return {
    update: updateMessage,
    setProgress,
    creepTo,
    setTitle,
    close,
    cancel,
    el: backdrop,
  };
}
