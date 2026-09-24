/**
 * The one producer of "this field is required" markup.
 *
 * A required field carries three things: `is-required` on its wrapper,
 * `aria-required="true"` on its control, and the `.field-required-mark`
 * asterisk in its `.field-label`. The editor's schema fields and the
 * new-presentation title field both need them; before this helper the second
 * one hand-rolled the same markup, and the next change to the mark would have
 * landed in only one of them.
 *
 * Marking only. Validation is the caller's: the editor adds a polite on-blur
 * flag (`views/editor/fields/required.js`), a dialog refuses the attempt
 * inline (`dom/inline-error.js`).
 */

import { h } from '../dom.js';

/**
 * Mark a field as required.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.wrap - The field wrapper (`.is-field`); its
 *   `.field-label` gets the asterisk.
 * @param {HTMLElement} opts.control - The input/textarea/select.
 * @returns {HTMLElement} `wrap`, for chaining.
 */
export function markRequired({ wrap, control } = {}) {
  if (!wrap || !control) return wrap;

  wrap.classList.add('is-required');
  control.setAttribute('aria-required', 'true');

  const labelEl = wrap.querySelector('.field-label');
  if (labelEl && !labelEl.querySelector('.field-required-mark')) {
    labelEl.append(
      h('span', {
        class: 'field-required-mark',
        text: '*',
        // The label already reads "required" to screen readers via
        // aria-required on the control; the asterisk is decoration.
        'aria-hidden': 'true',
      }),
    );
  }
  return wrap;
}
