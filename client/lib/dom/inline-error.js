/**
 * The inline refusal: the one message element for "what you are doing right
 * now was refused".
 *
 * A toast is a passing message for something that has no form on screen. A
 * refusal of the form the user is filling in is a *state* of that form: it
 * sits beside the control (or the button) that has to change, stays until the
 * next attempt, names the field, and is announced once. Before this helper the
 * client had 26 hand-rolled spellings of that element and one that carried the
 * ARIA (`aria-invalid` + `aria-describedby`) — every refusal fix added a 27th.
 * The doctrine is docs/reference/feedback-surfaces.md; the guard that keeps a
 * new spelling from appearing is tests/feedback-surfaces-guard.test.js.
 *
 * Two placements, one element:
 *
 *   - under a field (plain text): `createInlineError()` appended to the
 *     field's wrapper, `show(message, { control })`.
 *   - beside the button (a callout): `createInlineError({ callout: true })`
 *     placed next to Save, `show(message, { control })` when a field is
 *     known, `show(message)` when the refusal is about the whole form.
 *
 * The contract with the caller: `clear()` at the start of every attempt, then
 * `show()` for the first problem found. Showing from hidden is what makes the
 * live region announce it again on the next attempt.
 */

import { h } from '../dom.js';
import { reportMisuse } from '../util/dev-runtime.js';

let seq = 0;

/**
 * Add an id to a control's `aria-describedby` without disturbing the ones a
 * help text already put there.
 * @param {Element} control
 * @param {string} id
 */
function addDescribedBy(control, id) {
  const ids = (control.getAttribute('aria-describedby') || '')
    .split(/\s+/)
    .filter(Boolean);
  if (!ids.includes(id)) {
    control.setAttribute('aria-describedby', [...ids, id].join(' '));
  }
}

/**
 * The inverse of addDescribedBy: drop our id, leave the rest.
 * @param {Element} control
 * @param {string} id
 */
function removeDescribedBy(control, id) {
  const ids = (control.getAttribute('aria-describedby') || '')
    .split(/\s+/)
    .filter((x) => x && x !== id);
  if (ids.length) control.setAttribute('aria-describedby', ids.join(' '));
  else control.removeAttribute('aria-describedby');
}

/**
 * Create an inline error surface.
 *
 * @param {Object} [opts]
 * @param {'assertive'|'polite'} [opts.live='assertive'] - How it is announced.
 *   A refusal of an attempt (Save pressed, the form said no) is `assertive`:
 *   `role="alert"`. A hint that appears while the user is still typing, like
 *   the required-field flag on blur, is `polite`: `role="status"`, so it does
 *   not talk over the label of the field they just moved to. So is a list or
 *   panel that did not load, shown in its place with `focus: false` — a state
 *   of the list, not a refusal (docs/reference/feedback-surfaces.md).
 * @param {boolean} [opts.callout=false] - The form-level box beside the
 *   button, rather than the plain line under a field.
 * @param {string} [opts.id] - Element id; generated when absent. The id is what
 *   `aria-describedby` on the control points at.
 * @returns {{
 *   el: HTMLElement,
 *   show: (message: string, opts?: {
 *     control?: Element|null,
 *     focus?: Element|false
 *   }) => void,
 *   clear: () => void,
 *   readonly shown: boolean
 * }}
 */
export function createInlineError({
  live = 'assertive',
  callout = false,
  id,
} = {}) {
  const el = h('div', {
    class: callout ? 'inline-error is-callout' : 'inline-error',
    id: id || `inline-error-${++seq}`,
    role: live === 'polite' ? 'status' : 'alert',
    // Focusable by script only: when no control is named, focus lands on the
    // message itself so a keyboard user is brought to the refusal.
    tabindex: '-1',
    hidden: true,
  });

  /** @type {Element|null} The control currently marked invalid. */
  let control = null;

  function release() {
    if (!control) return;
    control.removeAttribute('aria-invalid');
    removeDescribedBy(control, el.id);
    control = null;
  }

  /**
   * Show the refusal.
   *
   * @param {string} message - What was refused and why. The server's sentence
   *   when the refusal came from the API, translated copy (looked up on
   *   `details.reason`) when the client has it — never a generic replacement.
   * @param {Object} [opts]
   * @param {Element|null} [opts.control] - The input the refusal names. Gets
   *   `aria-invalid="true"` and `aria-describedby` → this message. A group
   *   (a row of a list) is not a control: leave this out, put the message
   *   inside the group, and pass the group's own focusable as `focus`.
   * @param {Element|false} [opts.focus] - Where focus lands: the control by
   *   default, else the message itself. An element to override; `false` to
   *   leave focus where it is (a hint while typing must not move it).
   */
  function show(message, { control: next = null, focus } = {}) {
    if (typeof message !== 'string' || !message.trim()) {
      reportMisuse(
        'An inline error needs the sentence to show — pass the refusal ' +
          '(err.message, or a t() call). Got ' +
          `${Object.prototype.toString.call(message)}.`,
      );
    }
    release();
    el.textContent = String(message ?? '');
    el.hidden = false;
    if (next) {
      next.setAttribute('aria-invalid', 'true');
      addDescribedBy(next, el.id);
      control = next;
    }
    const target = focus === false ? null : (focus ?? next ?? el);
    if (target && typeof (/** @type {any} */ (target).focus) === 'function') {
      /** @type {any} */ (target).focus();
    }
    // Focus scrolls on its own; a refusal that leaves focus alone still has to
    // be on screen. jsdom has no layout, hence the optional call.
    (target ?? el).scrollIntoView?.({ block: 'nearest' });
  }

  /** Take the refusal away and release the control it named. */
  function clear() {
    release();
    el.textContent = '';
    el.hidden = true;
  }

  return {
    el,
    show,
    clear,
    get shown() {
      return !el.hidden;
    },
  };
}
