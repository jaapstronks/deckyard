/**
 * Floating selection toolbar for in-place rich (markdown) edits.
 *
 * Shows bold / italic / link / bullet-list above a non-empty text selection
 * INSIDE the active rich edit — canvas-only, selection-bound actions per the
 * editing-surfaces plan (block-level controls go to the inspector, step 3).
 * Plain-text fields never get one (they cannot store formatting).
 *
 * Lifecycle: created by beginRichEdit, destroyed by endTextEdit — so the
 * document-level selectionchange listener lives exactly as long as one edit
 * (the leak concern that keeps comment-rich-input.js listener-free does not
 * apply; see the deliberate trade-off documented there).
 *
 * The toolbar renders on the unscaled overlay layer and anchors to the
 * selection's Range rect via the same thumb-relative math overlay.js uses
 * for elements — new ground: a Range has a getBoundingClientRect but no
 * isConnected, so the placement is managed here, not via overlay.place().
 *
 * Mousedown on the toolbar is preventDefault-ed so focus (and therefore the
 * blur-commit listener on the field) never fires from a toolbar click — the
 * same trick as the comment composer's link button.
 */

import { t } from '../../../lib/ui-i18n.js';
import { icon } from '../../../lib/dom/icons.js';
import {
  computeToolbarPlacement,
  emphasisDisables,
} from './selection-toolbar-logic.js';
import { h } from '../../../lib/dom.js';

/**
 * @param {Object} opts
 * @param {HTMLElement} opts.layer - the overlay layer (unscaled, on the thumb)
 * @param {HTMLElement} opts.thumb - the positioning context (overlay's host)
 * @param {HTMLElement} opts.editEl - the contenteditable field being edited
 * @param {Function} opts.onLinkRequest - () => void; the caller owns the
 *   link modal flow (selection snapshot, blur suspension, URL validation)
 * @returns {{update: Function, destroy: Function, el: HTMLElement}}
 */
export function createSelectionToolbar({
  layer,
  thumb,
  editEl,
  onLinkRequest,
}) {
  /** The selection's range, but only when it is non-empty and fully inside
   *  the edited field. */
  function editRange() {
    const sel = document.getSelection?.();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    if (
      !editEl.contains(range.startContainer) ||
      !editEl.contains(range.endContainer)
    ) {
      return null;
    }
    return range;
  }

  function commandState(name) {
    try {
      return document.queryCommandState(name);
    } catch {
      return false;
    }
  }

  const makeBtn = (name, title, onActivate) => {
    const btn = h('button', {
      class: 'ie-sel-btn',
      type: 'button',
      title,
      'aria-label': title,
      'data-ie-tb': name,
      onclick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btn.disabled) return;
        onActivate();
      },
    });
    // The button's action name is the Lucide glyph name, so no map stands
    // between the two.
    btn.append(icon(name, { size: 14 }));
    return btn;
  };

  const exec = (command) => {
    // Focus is still on the field (mousedown was prevented), so the command
    // applies to the live selection; the field's input event follows and the
    // selectionchange refreshes the button states.
    document.execCommand(command);
    update();
  };

  const btnBold = makeBtn('bold', t('editor.markdown.bold', 'Bold'), () =>
    exec('bold'),
  );
  const btnItalic = makeBtn(
    'italic',
    t('editor.markdown.italic', 'Italic'),
    () => exec('italic'),
  );
  const btnLink = makeBtn('link', t('editor.markdown.link', 'Link'), () =>
    onLinkRequest?.(),
  );
  const btnList = makeBtn(
    'list',
    t('editor.inline.toolbar.list', 'Bullet list'),
    () => exec('insertUnorderedList'),
  );

  const el = h(
    'div',
    {
      class: 'ie-sel-toolbar',
      role: 'toolbar',
      'aria-label': t('editor.inline.toolbar.label', 'Text formatting'),
    },
    [btnBold, btnItalic, btnLink, btnList],
  );
  // Keep focus (and the blur-commit listener) on the field: a mousedown on
  // the toolbar must never blur the contenteditable.
  el.addEventListener('mousedown', (e) => e.preventDefault());
  layer.appendChild(el);

  function update() {
    const range = editRange();
    if (!range) {
      el.classList.remove('is-visible');
      return;
    }
    // Ancestry for the no-nested-emphasis rule (see emphasisDisables). A
    // partially-overlapping selection can slip past this containment check;
    // the commit-rerender immediately shows what the dialect made of it.
    let node = range.commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentElement;
    const within = (sel) => {
      const hit = node?.closest?.(sel);
      return !!hit && editEl.contains(hit) && hit !== editEl;
    };
    const disables = emphasisDisables({
      insideEm: within('em,i'),
      insideStrong: within('strong,b'),
    });
    btnBold.disabled = disables.bold;
    btnItalic.disabled = disables.italic;
    btnBold.classList.toggle('is-active', commandState('bold'));
    btnItalic.classList.toggle('is-active', commandState('italic'));
    btnList.classList.toggle('is-active', commandState('insertUnorderedList'));

    // Measure while still hidden (visibility, not display — offsetWidth works),
    // then place: centered above the selection, clamped, flipped when cramped.
    const placement = computeToolbarPlacement({
      sel: range.getBoundingClientRect(),
      host: thumb.getBoundingClientRect(),
      size: { width: el.offsetWidth || 120, height: el.offsetHeight || 32 },
    });
    if (!placement) {
      el.classList.remove('is-visible');
      return;
    }
    el.style.left = `${placement.left}px`;
    el.style.top = `${placement.top}px`;
    el.classList.add('is-visible');
  }

  // Scoped to the edit's lifetime (added here, removed in destroy), with the
  // containment check above — not a leak-prone permanent document listener.
  document.addEventListener('selectionchange', update);
  // Preview zoom / panel resize moves the selection rect without a
  // selectionchange; re-anchor on thumb resize like overlay.js does.
  const ro = new ResizeObserver(update);
  ro.observe(thumb);

  function destroy() {
    document.removeEventListener('selectionchange', update);
    ro.disconnect();
    el.remove();
  }

  return { update, destroy, el };
}
