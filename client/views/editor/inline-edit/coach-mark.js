import { t } from '../../../lib/ui-i18n.js';
import { storage } from '../../../lib/storage.js';

/**
 * One-time coach mark for the inline WYSIWYG editor.
 *
 * The first time a user lands on an inline-editable slide in the editor, a
 * subtle "click any text on the slide to edit it" hint appears at the bottom of
 * the slide canvas. It shows exactly once ever (persisted in localStorage),
 * auto-dismisses when the user starts editing (they've discovered it) or after
 * a short timeout, and can be closed with its × button.
 *
 * The flagship inline-editing feature has no discoverability affordance beyond
 * a hover outline; this lowers the "is this even editable?" barrier without
 * nagging returning users.
 *
 * @module inline-edit/coach-mark
 */

const SEEN_KEY = 'editor.inline.coachSeen';
const AUTO_DISMISS_MS = 12000;

/**
 * @param {object} opts
 * @param {Function} opts.h - DOM helper
 * @param {HTMLElement} opts.stage - The `.preview-stage` (positioning context)
 * @returns {{ maybeShow: Function, dismiss: Function, destroy: Function }}
 */
export function createInlineCoachMark({ h, stage } = {}) {
  let el = null;
  /** @type {number} */
  let timer = 0;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
  }

  function remove() {
    clearTimer();
    if (el) {
      el.remove();
      el = null;
    }
  }

  /**
   * Show the hint if it's never been seen. Safe to call on every rerender:
   * it no-ops once shown or once the persisted flag is set.
   */
  function maybeShow() {
    if (el || !stage) return;
    if (storage.getBool(SEEN_KEY, false)) return;
    // Persist immediately so the hint is genuinely one-time, even if the user
    // navigates away before dismissing it.
    storage.setBool(SEEN_KEY, true);

    // The stage is the positioning context (it's also made relative when a
    // positioned comment popup opens); ensure it here too.
    stage.style.position = 'relative';

    el = h('div', { class: 'ie-coach', role: 'status' }, [
      h('span', {
        class: 'ie-coach-text',
        text: t('editor.inline.coach', 'Click any text on the slide to edit it'),
      }),
      h('button', {
        class: 'ie-coach-dismiss',
        type: 'button',
        'aria-label': t('editor.inline.coachDismiss', 'Dismiss'),
        text: '×',
        onclick: () => remove(),
      }),
    ]);
    stage.appendChild(el);

    timer = setTimeout(remove, AUTO_DISMISS_MS);
  }

  /** Remove the hint (e.g. once the user starts editing). */
  function dismiss() {
    remove();
  }

  function destroy() {
    remove();
  }

  return { maybeShow, dismiss, destroy };
}
