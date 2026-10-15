/**
 * Column tabs: a tab strip fastened to the column it switches (D335).
 *
 * A segmented control reads as a setting ("the value is Fields"); a tab reads
 * as "this column now shows Fields" and visibly belongs to the surface under
 * it. The editor has two of these strips - Canvas | Fields above the canvas
 * column and Inspector | Comments in the head of the right-hand column - and
 * both are built here, so they share one markup, one aria wiring and one
 * stylesheet (`app/components/12-column-tabs.css`).
 *
 * The active tab takes the tone of the surface it opens: the caller sets
 * `--column-tab-surface` on the strip (or on one tab) to that surface's
 * background, and the active tab paints it over the strip's bottom rule.
 *
 * The owner may drive the selection (`selectOnClick: false`): the inspector
 * rail dismisses itself when its active tab is clicked, so there no tab is
 * selected at all. Same shape as `createSegmented()` in `segmented.js`.
 */

import { h } from './index.js';

/**
 * @typedef {Object} ColumnTabSpec
 * @property {string} value - Identifies the tab; passed to `onSelect`.
 * @property {string} [label] - Tab text. Omit when passing `content`.
 * @property {(Node|string|Array<Node|string>)} [content] - Custom content (an
 *   icon plus a label, say). Takes precedence over `label`.
 * @property {string} [title] - `title` attribute.
 * @property {string} [ariaLabel] - `aria-label`, for an icon-only tab.
 */

/**
 * Build a column tab strip.
 *
 * @param {Object} opts
 * @param {ColumnTabSpec[]} opts.tabs - The tabs, in order.
 * @param {string|null} [opts.value] - Initially selected value. Defaults to
 *   the first tab; `null` selects none.
 * @param {(value: string, ev: MouseEvent) => void} [opts.onSelect] - Called on
 *   every click, the active tab included; the owner decides what that means.
 * @param {boolean} [opts.selectOnClick=true] - Move the selection on click.
 *   Pass `false` when the owner drives it through `setValue`.
 * @param {string} opts.ariaLabel - Accessible name of the tab list.
 * @param {string} [opts.className] - Extra classes on the strip.
 * @returns {{ el: HTMLElement, tabs: Map<string, HTMLElement>,
 *   getValue: () => (string|null), setValue: (value: string|null) => void }}
 */
export function createColumnTabs({
  tabs = [],
  value,
  onSelect,
  selectOnClick = true,
  ariaLabel,
  className,
} = {}) {
  let current = value === undefined ? (tabs[0]?.value ?? null) : value;
  const buttons = new Map();

  const el = h('div', {
    class: ['column-tabs', className].filter(Boolean).join(' '),
    role: 'tablist',
    'aria-label': ariaLabel,
  });

  for (const tab of tabs) {
    const btn = h('button', {
      class: 'column-tab',
      type: 'button',
      role: 'tab',
      'data-value': String(tab.value),
      ...(tab.label != null && tab.content == null ? { text: tab.label } : {}),
      ...(tab.title ? { title: tab.title } : {}),
      ...(tab.ariaLabel ? { 'aria-label': tab.ariaLabel } : {}),
      onclick: (ev) => {
        if (selectOnClick) setValue(tab.value);
        onSelect?.(tab.value, ev);
      },
    });
    if (tab.content != null) {
      btn.append(...(Array.isArray(tab.content) ? tab.content : [tab.content]));
    }
    buttons.set(tab.value, btn);
    el.append(btn);
  }

  /** @param {string|null} next */
  function setValue(next) {
    current = next;
    for (const [val, btn] of buttons) {
      const isActive = val === next;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    }
  }

  setValue(current);

  return { el, tabs: buttons, getValue: () => current, setValue };
}
