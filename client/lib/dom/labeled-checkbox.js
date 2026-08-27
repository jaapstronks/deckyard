/**
 * Shared labeled-checkbox builder.
 *
 * The settings and modal surfaces grew the same recipe in a dozen places: an
 * `<input type="checkbox">` wrapped in a `<label>` next to its text, with an
 * optional `.help` line underneath. Each copy re-spelled the wrapper class
 * (`admin-checkbox-item`, `form-checkbox-row`, `api-key-permission-checkbox`, …)
 * and re-derived the same markup. This factory is the DOM half of that recipe,
 * so callers describe a checkbox instead of rebuilding the label/span nesting
 * and re-wiring the change listener (A7.16 cluster 9).
 *
 * Sibling of `segmented.js`, and deliberately the same shape: build the
 * scaffold, hand back the element plus the one control a caller needs — here the
 * `input`, so the caller can read `.checked`, set it later, or bind more
 * listeners.
 *
 * Scope: the *label-wrapping* family — `<label class><input><content></label>`.
 * The visual is intentionally NOT unified: the class stays a parameter, so an
 * `admin-checkbox-item` row and an `api-key-permission-checkbox` card each keep
 * their own look. The `.form-group form-group-checkbox` modal pattern, whose
 * wrapper is a `<div>` with a sibling `<label for>`, is a structurally
 * different recipe and is not built here.
 */

import { h } from '../dom.js';

/**
 * Build a labeled checkbox.
 *
 * @param {Object} opts
 * @param {string} [opts.text] - Label text, wrapped in a `<span>`. Ignored when
 *   `content` is given.
 * @param {(Node|Node[])} [opts.content] - Custom label content (e.g. a title +
 *   description block). Takes precedence over `text`.
 * @param {string} [opts.className='admin-checkbox-item'] - Wrapper `<label>`
 *   class; this is what keeps each surface's visual treatment.
 * @param {boolean} [opts.checked=false] - Initial checked state (set as the
 *   property, matching the hand-rolled `input.checked = …` the call sites used).
 * @param {(checked: boolean) => void} [opts.onChange] - Bound to the input's
 *   `change` event. Omit and read the returned `input` directly when the caller
 *   samples state at submit time instead.
 * @param {Object} [opts.inputAttrs] - Extra attributes for the `<input>`
 *   (e.g. `id`, `value`, `data-*`).
 * @param {Object} [opts.labelAttrs] - Extra attributes for the `<label>`
 *   (e.g. `for`, `style`).
 * @returns {{ element: HTMLLabelElement, input: HTMLInputElement }}
 */
export function labeledCheckbox({
  text,
  content,
  className = 'admin-checkbox-item',
  checked = false,
  onChange,
  inputAttrs = {},
  labelAttrs = {},
} = {}) {
  const input = h('input', { type: 'checkbox', ...inputAttrs });
  if (checked) input.checked = true;

  const body = content != null ? content : h('span', { text: text ?? '' });
  const children = Array.isArray(body) ? [input, ...body] : [input, body];
  const el = h('label', { class: className, ...labelAttrs }, children);

  if (onChange) {
    input.addEventListener('change', () => onChange(!!input.checked));
  }

  return { el, input };
}
