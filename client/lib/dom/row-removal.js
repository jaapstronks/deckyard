/**
 * Where focus and a screen reader go when a row disappears (B647).
 *
 * A confirmed removal is the first kind in
 * `docs/reference/feedback-surfaces.md`: the result is on screen, so there is
 * no toast. For the eye that is complete — the row is gone. For a keyboard or
 * screen-reader user it is not, and for one reason: the control that was
 * clicked lived *in* the row. `createOverlay` hands focus back to it when the
 * confirm dialog closes (`modal.js`), the list then re-renders without it, and
 * focus falls to `<body>` — the list is left, the position is lost, and
 * nothing is said. Until B643 the success toast said it; removing the toast
 * made that silence visible rather than causing it.
 *
 * So the list itself carries both halves:
 *
 * - **Focus lands on whatever took the place of the removed row** (the next
 *   one, or the last one when the removed row was last), so a screen reader
 *   names the neighbour and the position in the list survives. A list that
 *   puts its own empty note where the rows were lands on that note, which
 *   says what the list is for; only a list left with nothing at all falls back
 *   to the control the caller names — its "new" button or its heading.
 * - **The removal is announced once, politely**, in one shared live region.
 *   One sentence with the label, not a per-site key: B643 deleted 29 of those
 *   on purpose.
 *
 * @module client/lib/dom/row-removal
 */

import { h } from './index.js';

/** The one polite region the lists announce their removals in. */
let region = null;

/** Tags that take focus without a `tabindex`. */
const FOCUSABLE_TAGS = new Set([
  'A',
  'BUTTON',
  'INPUT',
  'SELECT',
  'TEXTAREA',
  'SUMMARY',
]);

/**
 * Say one sentence in the shared polite region. Announcing the same text twice
 * needs the region to change, so it is cleared before it is filled.
 *
 * @param {string} message - The sentence to announce.
 */
export function announcePolitely(message) {
  if (!message) return;
  if (!region) {
    region = h('div', {
      class: 'sr-only',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    });
    document.body.append(region);
  }
  region.textContent = '';
  // A separate task, so a screen reader sees the region change even when the
  // new sentence equals the old one.
  setTimeout(() => {
    if (region) region.textContent = message;
  }, 0);
}

/**
 * Focus an element that was not built to be focused, without giving it a place
 * in the tab order.
 *
 * @param {Element|null} el - The element to focus.
 */
function focusByScript(el) {
  if (!el) return;
  if (!FOCUSABLE_TAGS.has(el.tagName) && !el.hasAttribute('tabindex')) {
    el.setAttribute('tabindex', '-1');
  }
  /** @type {HTMLElement} */ (el).focus?.();
}

/**
 * @param {Element|(() => Element|null)|null} ref
 * @returns {Element|null}
 */
function resolve(ref) {
  return (typeof ref === 'function' ? ref() : ref) || null;
}

/**
 * Note where a row sits, before the list is re-rendered without it. Call the
 * returned function once the list has re-rendered (or the row is removed).
 *
 * @param {Element|(() => Element|null)|null} list - The element whose children
 *   are the rows. A list that is rebuilt on every render is passed as a
 *   getter, so the function reads the element that exists afterwards.
 * @param {Object} [options]
 * @param {number} [options.index] - The removed row's position among the rows.
 *   Defaults to 0, which lands focus on the new first row.
 * @param {Element|(() => Element|null)|null} [options.fallback] - What to focus
 *   when no row is left: the list's "new" button or its heading.
 * @returns {(message?: string) => void} Call after the re-render, with the
 *   sentence to announce.
 */
export function planRowRemoval(list, { index = 0, fallback = null } = {}) {
  const at = Number.isInteger(index) && index > 0 ? index : 0;

  return function landAfterRemoval(message) {
    const listEl = resolve(list);
    const rows = listEl ? Array.from(listEl.children) : [];
    const row = rows.length ? rows[Math.min(at, rows.length - 1)] : null;
    focusByScript(row || resolve(fallback));
    announcePolitely(message);
  };
}

/**
 * Forget the shared region. Tests only; the app keeps one for its lifetime.
 */
export function __resetRowRemovalForTests() {
  region?.remove();
  region = null;
}
