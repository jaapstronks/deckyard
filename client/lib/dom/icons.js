/**
 * UI-chrome icons (Lucide), rendered as a CSS mask so they take `currentColor`.
 *
 * There is one name registry (`shared/icon-names.js` → the vendored SVG files
 * under `client/vendor/lucide-icons/`) and two ways to render from it. The
 * line between them is what the name *is*:
 *
 * - **`icon(name)` — UI chrome.** The name is written by us, in code, for a
 *   button/toolbar/menu glyph that must follow the text colour of whatever it
 *   sits in (hover, disabled, danger, dark mode). Rendered as a `<span
 *   class="icon">` whose `mask-image` is the vendored SVG and whose
 *   `background-color` is `currentColor`.
 * - **`iconUrl(name)` in an `<img>` — data/content.** The name came from data
 *   (an author's icon choice, a slide field, an empty-state illustration).
 *   There the glyph is content, not chrome, and text colour is irrelevant;
 *   `<img>` keeps it a real image that the export pipeline can rasterise.
 *
 * Chrome names must be listed in `UI_ICON_NAMES` (`shared/icon-names.js`) so
 * the vendoring step copies them; `tests/inline-svg-single-source.test.js`
 * fails the build if `icon()` is called with a name that is not vendored.
 *
 * Hand-copied inline SVG paths used to live here. They drifted from the
 * vendored set by definition — a copied path is a fork — so they are gone
 * (A7.16 cluster 5).
 */

import { h } from '../dom.js';
import { iconUrl } from '../../../shared/icon-names.js';

/**
 * Create a UI-chrome icon element that inherits `currentColor`.
 *
 * @param {string} name - Vendored Lucide icon name (see `UI_ICON_NAMES`)
 * @param {object} [options]
 * @param {number} [options.size=16] - Edge length in pixels
 * @param {string} [options.className] - Extra class(es) on the span
 * @returns {HTMLSpanElement}
 */
export function icon(name, { size = 16, className } = {}) {
  const el = h('span', {
    class: className ? `icon ${className}` : 'icon',
    'aria-hidden': 'true',
  });
  el.style.setProperty('--icon-size', `${size}px`);
  const url = iconUrl(name);
  if (url) el.style.setProperty('--icon-url', `url("${url}")`);
  return el;
}

/**
 * The caret for labeled dropdown triggers (Export, Share): one shared
 * chevron so every menu button announces itself the same way.
 * @returns {HTMLSpanElement}
 */
export function makeDropdownCaret() {
  return icon('chevron-down', { size: 14, className: 'dropdown-caret' });
}
