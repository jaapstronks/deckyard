/**
 * Required-field feedback for the editor form.
 *
 * The field builders have always set `input.required = true` for a field
 * declared `required` in a slide type's schema, but the inspector's fields do
 * not live in a `<form>` and nothing ever called `checkValidity()`, so the
 * attribute was inert: nothing marked the field as required, and an empty one
 * only failed on save, server-side, as a toast with no idea which field.
 *
 * This is the client half. It matters most for custom slide types, whose
 * fields are author-defined and flow through the generic renderer, but it
 * applies to every type's schema for free.
 *
 * Deliberately quiet: a field is only flagged once it has been visited and
 * left empty, so a freshly added slide is not a wall of red before anyone has
 * typed anything. The flag is the shared inline error (`dom/inline-error.js`)
 * in its polite form — a hint while typing, not a refusal of an attempt — and
 * it never moves focus.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';

/** Fields whose "emptiness" is not just an empty string. */
function isEmptyValue(control) {
  const v = control?.value;
  return String(v ?? '').trim() === '';
}

/**
 * Mark a field as required and wire its inline validation.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.wrap - The field wrapper (`.is-field`), as
 *   returned by the field builder. Its `.field-label` gets the indicator and
 *   the error message is appended to it.
 * @param {HTMLElement} opts.control - The input/textarea to watch.
 * @returns {HTMLElement} `wrap`, for chaining off a builder's return.
 */
export function markFieldRequired({ wrap, control } = {}) {
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

  const error = createInlineError({ live: 'polite' });
  wrap.append(error.el);

  let visited = false;

  const refresh = () => {
    const invalid = visited && isEmptyValue(control);
    if (invalid) {
      // Shown once per lapse, not per keystroke: re-showing would re-announce.
      if (!error.shown) {
        error.show(t('editor.fields.required', 'This field is required.'), {
          control,
          focus: false,
        });
      }
    } else if (error.shown) {
      error.clear();
    }
  };

  // Blur is what marks the field visited: flagging while someone is still
  // clearing and retyping a value would be noise.
  control.addEventListener('blur', () => {
    visited = true;
    refresh();
  });
  // Once flagged, clear the moment it is satisfied rather than waiting for
  // another blur.
  control.addEventListener('input', () => {
    if (visited) refresh();
  });

  return wrap;
}

/**
 * Every required field in a subtree that is currently empty.
 *
 * Used to decide whether to warn before an action that treats the slide as
 * finished; returns the wrappers so a caller can focus the first one.
 *
 * @param {HTMLElement} root
 * @returns {HTMLElement[]}
 */
export function emptyRequiredFields(root) {
  if (!root) return [];
  return [...root.querySelectorAll('.is-field.is-required')].filter((wrap) => {
    const control = wrap.querySelector('input, textarea, select');
    return control && isEmptyValue(control);
  });
}
