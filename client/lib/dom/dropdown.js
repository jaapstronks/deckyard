/**
 * Shared `<details class="dropdown">` disclosure builder.
 *
 * The editor chrome had ~9 handrolled copies of the same details/summary/menu
 * scaffold (export, share, publish, comments filter, present-more, the ⋯
 * menus and their submenus). This factory builds that scaffold and wires the
 * standard dismiss-on-outside behaviour, so callers only describe the trigger
 * and the menu contents. Classes and DOM shape match the CSS in
 * `01-core/10-shell-topbar-dropdown.css` (`.dropdown`, `.dropdown-trigger`,
 * `.dropdown-menu`), so there is no visual change versus the hand-built form.
 */

import { h as defaultH, installDismissOnOutside } from '../dom.js';
import { makeDropdownCaret } from './icons.js';

/**
 * Build a details-based dropdown (trigger `<summary>` + `.dropdown-menu`).
 *
 * @param {Object} opts
 * @param {Function} [opts.h] - DOM helper (defaults to the shared `h()`).
 * @param {string} [opts.triggerClass='btn btn-secondary'] - classes on the
 *   `<summary>` trigger; `dropdown-trigger` is always appended.
 * @param {(Node|string|Array<Node|string>)} [opts.triggerContent] - content
 *   for the trigger. When omitted, `label` is used instead.
 * @param {string} [opts.label] - convenience: label text wrapped in a `<span>`,
 *   optionally followed by a caret (see `caret`). Ignored when
 *   `triggerContent` is given.
 * @param {(Node|boolean)} [opts.caret=true] - only used with `label`: `true`
 *   appends the shared chevron, `false` omits it, a Node appends that node.
 * @param {string} [opts.title] - trigger `title` attribute.
 * @param {string} [opts.ariaLabel] - trigger `aria-label` (icon-only triggers).
 * @param {string} [opts.detailsClass] - extra classes on the `<details>`.
 * @param {string} [opts.menuClass] - extra classes on the menu (e.g.
 *   `dropdown-menu-right`).
 * @param {Array<Node>} [opts.items] - initial menu children.
 * @param {boolean} [opts.dismissOnOutside=true] - install outside-click +
 *   Escape dismissal. Submenus pass `false` (the parent menu owns dismissal).
 * @returns {{ el: HTMLElement, details: HTMLElement, summary: HTMLElement,
 *   menu: HTMLElement, close: Function, detach: Function }}
 */
export function createDropdown({
  h = defaultH,
  triggerClass = 'btn btn-secondary',
  triggerContent,
  label,
  caret = true,
  title,
  ariaLabel,
  detailsClass,
  menuClass,
  items,
  dismissOnOutside = true,
} = {}) {
  let content = triggerContent;
  if (content == null && label != null) {
    content = [h('span', { text: label })];
    if (caret === true) content.push(makeDropdownCaret());
    else if (caret) content.push(caret);
  }
  const contentArr = content == null ? [] : Array.isArray(content) ? content : [content];

  const summaryAttrs = { class: `${triggerClass} dropdown-trigger` };
  if (title) summaryAttrs.title = title;
  if (ariaLabel) summaryAttrs['aria-label'] = ariaLabel;
  const summary = h('summary', summaryAttrs, contentArr);

  const menu = h('div', { class: `dropdown-menu${menuClass ? ` ${menuClass}` : ''}` });
  if (items && items.length) menu.append(...items);

  const details = h(
    'details',
    { class: `dropdown${detailsClass ? ` ${detailsClass}` : ''}` },
    [summary, menu]
  );

  const close = () => {
    details.open = false;
  };

  let detach = () => {};
  if (dismissOnOutside) {
    detach = installDismissOnOutside({
      rootEl: details,
      isOpen: () => !!details.open,
      close,
    });
  }

  return { el: details, details, summary, menu, close, detach };
}
