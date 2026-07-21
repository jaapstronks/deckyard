/**
 * Shared segmented-control builder.
 *
 * The editor chrome grew three copies of the same segmented-control recipe:
 * the canonical `.sb-segmented` (settings, presenter language, UI mode, …) and
 * two hand-rolled look-alikes with their own class names and their own CSS —
 * `.pane-tabs` (inspector/comments/notes) and `.comments-scope`. The CSS is now
 * one source (`.sb-segmented`, plus the `is-outlined` variant in
 * `base/03-controls-and-forms.css`); this factory is the DOM half of that, so
 * callers describe segments instead of rebuilding the markup and the
 * is-active/aria-pressed bookkeeping.
 *
 * Sibling of `lib/dropdown.js`, and deliberately the same shape: build the
 * scaffold, hand back the element plus the handful of controls a caller needs.
 */

import { h as defaultH } from './dom.js';

/**
 * @typedef {Object} SegmentSpec
 * @property {string} value - Identifies the segment; passed to `onSelect`.
 * @property {string} [label] - Button text. Omit when passing `content`.
 * @property {(Node|string|Array<Node|string>)} [content] - Custom button
 *   content (an icon plus a label, say). Takes precedence over `label`.
 * @property {string} [title] - `title` attribute.
 * @property {string} [ariaLabel] - `aria-label`, for icon-only segments.
 * @property {string} [className] - Extra classes on this button.
 * @property {Object} [attrs] - Extra attributes passed straight to `h()`.
 */

/**
 * Build a segmented control.
 *
 * Selection is expressed two ways because the two existing controls disagreed:
 * `.is-active` for styling and `aria-pressed` for assistive tech. Both are kept
 * in sync by `setValue`, which is also what the buttons call on click.
 *
 * @param {Object} opts
 * @param {Function} [opts.h] - DOM helper (defaults to the shared `h()`).
 * @param {SegmentSpec[]} opts.segments - The segments, in order.
 * @param {string} [opts.value] - Initially selected value. Defaults to the
 *   first segment. Pass `null` for no initial selection.
 * @param {(value: string, ev: MouseEvent) => void} [opts.onSelect] - Called on
 *   click. Fires for a click on the already-selected segment too; the caller
 *   decides whether that is a no-op.
 * @param {boolean} [opts.selectOnClick=true] - Move the selection on click.
 *   Pass `false` when the owner drives selection (e.g. a toggle that may be
 *   refused, or one whose state is derived from elsewhere).
 * @param {string} [opts.className] - Extra classes on the container.
 * @param {boolean} [opts.outlined=false] - Use the bordered `is-outlined`
 *   variant instead of the default sunken well.
 * @param {string} [opts.ariaLabel] - `aria-label` for the group.
 * @param {string} [opts.buttonClass] - Extra classes on every button.
 * @returns {{ el: HTMLElement, buttons: Map<string, HTMLElement>,
 *   getValue: () => (string|null), setValue: (value: string|null) => void }}
 */
export function createSegmented({
  h = defaultH,
  segments = [],
  value,
  onSelect,
  selectOnClick = true,
  className,
  outlined = false,
  ariaLabel,
  buttonClass,
} = {}) {
  let current = value === undefined ? segments[0]?.value ?? null : value;

  const buttons = new Map();

  const el = h('div', {
    class: ['sb-segmented', outlined ? 'is-outlined' : '', className]
      .filter(Boolean)
      .join(' '),
    role: 'group',
    ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
  });

  for (const seg of segments) {
    const btn = h('button', {
      class: ['sb-segmented-btn', buttonClass, seg.className].filter(Boolean).join(' '),
      type: 'button',
      ...(seg.label != null && seg.content == null ? { text: seg.label } : {}),
      ...(seg.title ? { title: seg.title } : {}),
      ...(seg.ariaLabel ? { 'aria-label': seg.ariaLabel } : {}),
      ...(seg.attrs || {}),
      onclick: (ev) => {
        if (selectOnClick) setValue(seg.value);
        onSelect?.(seg.value, ev);
      },
    });
    if (seg.content != null) {
      btn.append(...(Array.isArray(seg.content) ? seg.content : [seg.content]));
    }
    buttons.set(seg.value, btn);
    el.append(btn);
  }

  /** @param {string|null} next */
  function setValue(next) {
    current = next;
    for (const [val, btn] of buttons) {
      const isActive = val === next;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    }
  }

  setValue(current);

  return { el, buttons, getValue: () => current, setValue };
}
