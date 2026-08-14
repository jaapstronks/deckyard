/**
 * The one loading spinner — a rotating ring, sized by modifier class.
 *
 * Five hand-rolled variants used to exist (`.spinner` ×2, `.auth-spinner`,
 * `.lang-btn-spinner`, `.skeleton-spinner`, plus a dash-animated SVG in the
 * loading modal), each with its own CSS block and keyframes. This builder and
 * the single CSS block in `client/styles/base/01-core/06-spinner.css` replace
 * all of them. Layout (margins, centering) stays with the call site's context
 * CSS; the spinner itself only knows its size.
 *
 * Buttons don't use this: a busy button toggles `.is-loading` and gets its
 * inline pseudo-element ring from `client/styles/app/components.css`.
 */

import { h } from '../dom.js';

/** @type {Set<string>} the size modifiers defined in 06-spinner.css */
const SIZES = new Set(['sm', 'md', 'lg', 'xl', 'xxl']);

/**
 * Build a spinner element.
 *
 * @param {'sm'|'md'|'lg'|'xl'|'xxl'} [size='md'] 12/18/32/48/80 px
 * @returns {HTMLElement}
 */
export function spinner(size = 'md') {
  const s = SIZES.has(size) ? size : 'md';
  // A span, not a div: the spinner also lands inside buttons (phrasing
  // content), and `display: inline-block` makes the element name moot.
  return h('span', { class: `spinner is-${s}`, 'aria-hidden': 'true' });
}
