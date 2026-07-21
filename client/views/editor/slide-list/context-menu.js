/**
 * Right-click context menu for slide-list rows.
 *
 * A single menu instance lives at a time (appended to <body> so it escapes the
 * slides panel's stacking/overflow). It reuses the shared slide operations
 * (duplicate / delete) and the existing visibility menu, so there is one
 * implementation of each action across the keyboard, the row controls and here.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { promptModal } from '../../../lib/dom/modal.js';
import { duplicateSlides, deleteSlides } from './slide-actions.js';
import {
  createVisibilityMenu,
  showVisibilityMenuAt,
} from '../slide-visibility-menu.js';

let activeMenu = null;
let detachActive = null;

/** Close and clean up any open slide context menu. */
export function closeSlideContextMenu() {
  if (detachActive) {
    try {
      detachActive();
    } catch {
      // ignore
    }
  }
  detachActive = null;
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}

/** Keep the menu inside the viewport, anchored near the cursor. */
function positionAt(menu, x, y) {
  menu.style.position = 'fixed';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw - 8) {
      menu.style.left = `${Math.max(8, vw - rect.width - 8)}px`;
    }
    if (rect.bottom > vh - 8) {
      menu.style.top = `${Math.max(8, vh - rect.height - 8)}px`;
    }
  });
}

/**
 * Show the slide context menu at the given viewport coordinates.
 *
 * @param {Object} options
 * @param {number} options.x - Cursor clientX
 * @param {number} options.y - Cursor clientY
 * @param {Object} options.slide - The right-clicked slide (for visibility)
 * @param {Set<string>} options.ids - Effective selection to act on
 * @param {Object} options.ctx - Editor callbacks (pres, editorState, setters, rerenders)
 */
export function showSlideContextMenu({ x, y, slide, ids, ctx }) {
  closeSlideContextMenu();

  const menu = h('div', { class: 'slide-context-menu', role: 'menu' });

  const count = ids instanceof Set ? ids.size : (ids?.length || 0);

  const addItem = ({ label, danger = false, onClick }) =>
    h('button', {
      class: `slide-context-menu-item${danger ? ' is-danger' : ''}`,
      type: 'button',
      role: 'menuitem',
      text: label,
      onclick: (e) => {
        e.stopPropagation();
        onClick();
      },
    });

  const duplicateItem = addItem({
    label: t('editor.slide.duplicate', 'Duplicate'),
    onClick: () => {
      closeSlideContextMenu();
      duplicateSlides({ ids, ...ctx });
    },
  });

  const deleteItem = addItem({
    label: t('editor.slide.delete', 'Delete'),
    danger: true,
    onClick: async () => {
      closeSlideContextMenu();
      await deleteSlides({ ids, ...ctx });
    },
  });

  menu.append(duplicateItem, deleteItem);

  // Quick reposition (single slide, and only when there's more than one slide
  // to reorder). "Move to position…" accepts a slide number; a number past the
  // end sends it to the end. "Move to end" is the one-click shortcut.
  const slides = ctx.pres?.slides || [];
  const total = slides.length;
  if (count <= 1 && total > 1 && typeof ctx.moveSlideToPosition === 'function') {
    const curIdx = slides.findIndex((s) => s.id === slide?.id);
    const curPos = curIdx >= 0 ? curIdx + 1 : total;

    const reselect = () => {
      ctx.setSelectedSlideId?.(slide?.id);
      ctx.rerenderEditor?.();
      ctx.rerenderPreview?.();
    };

    const moveToItem = addItem({
      label: t('editor.slide.moveTo', 'Move to position…'),
      onClick: async () => {
        closeSlideContextMenu();
        const answer = await promptModal(h, document.body, {
          title: t('editor.slide.moveTo', 'Move to position…'),
          message: t(
            'editor.slide.moveToHint',
            'Enter a slide number (1–{total}). A higher number moves it to the end.'
          ).replace('{total}', String(total)),
          value: String(curPos),
          placeholder: String(total),
          validate: (v) => {
            const n = Number(String(v || '').trim());
            if (!Number.isInteger(n) || n < 1) {
              return t(
                'editor.slide.moveToInvalid',
                'Enter a whole number of 1 or more.'
              );
            }
            return null;
          },
        });
        if (answer == null) return;
        ctx.moveSlideToPosition?.({ fromId: slide?.id, position: Number(answer) });
        reselect();
      },
    });

    const moveEndItem = addItem({
      label: t('editor.slide.moveToEnd', 'Move to end'),
      onClick: () => {
        closeSlideContextMenu();
        ctx.moveSlideToPosition?.({ fromId: slide?.id, position: Infinity });
        reselect();
      },
    });
    if (curIdx === total - 1) moveEndItem.disabled = true;

    menu.append(
      h('div', { class: 'slide-context-menu-sep', role: 'separator' }),
      moveToItem,
      moveEndItem
    );
  }

  // Visibility only makes sense for a single slide (the one clicked); the
  // preset menu edits one slide at a time.
  if (count <= 1) {
    menu.append(h('div', { class: 'slide-context-menu-sep', role: 'separator' }));
    const visItem = addItem({
      label: t('editor.slideList.visibility', 'Change visibility'),
      onClick: () => {
        // Capture the anchor rect before the context menu is removed, then hand
        // the existing visibility menu a synthetic anchor so it can position.
        const rect = visItem.getBoundingClientRect();
        closeSlideContextMenu();
        const vm = createVisibilityMenu({
          h,
          slide,
          onVisibilityChange: () => {
            ctx.markDirty?.();
            ctx.rerenderSlideList?.();
            ctx.rerenderEditor?.();
            ctx.rerenderPreview?.();
          },
          onClose: () => {
            document.body.querySelector('.visibility-menu')?.remove();
          },
        });
        showVisibilityMenuAt({
          anchor: { getBoundingClientRect: () => rect, contains: () => false },
          menu: vm,
        });
      },
    });
    menu.append(visItem);
  }

  document.body.appendChild(menu);
  activeMenu = menu;
  positionAt(menu, x, y);

  // Dismiss on outside click, another context menu, Escape, scroll or resize.
  const onDocClick = (e) => {
    if (!menu.contains(e.target)) closeSlideContextMenu();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') closeSlideContextMenu();
  };
  const onScrollOrResize = () => closeSlideContextMenu();
  // Defer binding the click listener so the opening click doesn't close it.
  setTimeout(() => {
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('contextmenu', onDocClick, true);
  }, 0);
  document.addEventListener('keydown', onKey);
  window.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize);

  detachActive = () => {
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('contextmenu', onDocClick, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('scroll', onScrollOrResize, true);
    window.removeEventListener('resize', onScrollOrResize);
  };
}
