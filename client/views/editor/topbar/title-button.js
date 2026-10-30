/**
 * The deck title in the editor topbar: a button holding the title text and
 * a pencil icon. Every writer of the title (a rename, a remote change, a
 * language switch) goes through {@link setTopbarTitleText}, so a new title
 * replaces the text span alone and the pencil stays (B893).
 *
 * @module client/views/editor/topbar/title-button
 */

import { icon } from '../../../lib/dom/icons.js';
import { h } from '../../../lib/dom/index.js';

/**
 * Build the title button.
 * @param {Object} opts
 * @param {string} opts.title - Deck title to show
 * @param {Function} [opts.onclick] - Opens the title modal
 * @returns {HTMLButtonElement}
 */
export function createTopbarTitleButton({ title, onclick }) {
  const el = h('button', {
    class: 'topbar-pres-title',
    type: 'button',
    title,
    onclick,
  });
  el.append(
    h('span', { class: 'topbar-pres-title-text', text: title }),
    icon('pencil', { size: 12, className: 'topbar-title-pencil' }),
  );
  return el;
}

/**
 * Show another title in the button, keeping its pencil icon.
 * @param {HTMLElement|null} el - The button from {@link createTopbarTitleButton}
 * @param {string} title
 */
export function setTopbarTitleText(el, title) {
  if (!el) return;
  el.querySelector('.topbar-pres-title-text').textContent = title;
  el.title = title;
}
