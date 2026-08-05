/**
 * "Forget me" button for anonymous viewers: confirms, then erases the analytics
 * data this device has recorded (see `analytics-tracker.js` `erase()`).
 *
 * Shared by the two viewer surfaces that run a tracker — the share-viewer and
 * the follow view. It owns the flow worth sharing (confirm → erase → toast +
 * self-remove) but takes localized `labels` rather than calling `t()` itself,
 * because the two surfaces sit on different i18n axes: the share-viewer on the
 * global UI locale, the follow view on the live deck language (`follow/i18n.js`).
 *
 * Returns `null` when there is no tracker (analytics disabled for this deck), so
 * a caller can `append(createEraseMyDataButton(...))`-style guard on it: no
 * tracker, no button, no surface.
 */

import { h } from '../dom.js';
import { confirmModal } from '../dom/modal.js';
import { toast } from '../dom/toast.js';

/**
 * @typedef {Object} EraseLabels
 * @property {string} button - Button text.
 * @property {string} [tooltip] - Button title attribute.
 * @property {string} confirmTitle - Confirm-modal title.
 * @property {string} confirmMessage - Confirm-modal body.
 * @property {string} confirmOk - Confirm-modal confirm button.
 * @property {string} cancel - Confirm-modal cancel button.
 * @property {string} done - Success toast.
 * @property {string} failed - Failure toast.
 */

/**
 * Build the "forget me" button, or null when there is nothing to forget.
 * @param {Object} opts
 * @param {{ erase: () => Promise<{ok: boolean}|null> }|null} opts.tracker -
 *   The live analytics tracker, or null/absent when analytics is off.
 * @param {EraseLabels} opts.labels - Localized copy.
 * @param {string} [opts.className] - Button classes (defaults to a secondary button).
 * @param {() => void} [opts.onErased] - Called after a successful erase, so the
 *   caller can drop its tracker reference and not rebuild a dead button on a
 *   later re-render.
 * @returns {HTMLButtonElement|null}
 */
export function createEraseMyDataButton({
  tracker,
  labels,
  className = 'btn btn-secondary',
  onErased,
} = {}) {
  if (!tracker || !labels) return null;

  const btn = h('button', {
    class: `${className} analytics-erase-btn`,
    type: 'button',
    text: labels.button,
    title: labels.tooltip || labels.button,
  });

  btn.addEventListener('click', async () => {
    const confirmed = await confirmModal(h, document.body, {
      title: labels.confirmTitle,
      message: labels.confirmMessage,
      confirmLabel: labels.confirmOk,
      cancelLabel: labels.cancel,
      danger: true,
    });
    if (!confirmed) return;

    btn.disabled = true;
    let result;
    try {
      result = await tracker.erase();
    } catch {
      result = null;
    }

    if (result?.ok) {
      // The data is gone; drop the affordance so it can't be clicked again,
      // and tell the caller so a later re-render doesn't resurrect it.
      btn.remove();
      onErased?.();
      toast(labels.done, { type: 'success' });
    } else {
      btn.disabled = false;
      toast(labels.failed, { type: 'error' });
    }
  });

  return btn;
}
