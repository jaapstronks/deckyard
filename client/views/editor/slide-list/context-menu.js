/**
 * The slide-list menu: right-click (or long-press) on a row, or the ⋯ on a
 * thumbnail. Since B703 PR 3 it is the one home of the slide actions that
 * used to sit in the ⋯ above the canvas (Duplicate, Delete, Lock, Save to
 * slide library), plus Copy and Paste (B308).
 *
 * A single menu instance lives at a time (appended to <body> so it escapes the
 * slides panel's stacking/overflow). It reuses the shared slide operations
 * (slide-actions.js, the clipboard routine) and the existing visibility menu,
 * so there is one implementation of each action across the keyboard, the row
 * controls and here.
 */

import { h } from '../../../lib/dom/index.js';
import { t } from '../../../lib/ui-i18n.js';
import { promptModal } from '../../../lib/dom/modal.js';
import { toast } from '../../../lib/dom/toast.js';
import { getClipboardCount } from '../../../lib/slide-authoring/slide-clipboard.js';
import { pasteSlidesFromClipboard } from '../../../lib/slide-authoring/clone-slides.js';
import {
  allAuthorLocked,
  canSaveSlideToLibrary,
  copySlidesToClipboard,
  duplicateSlides,
  deleteSlides,
  saveSlideToLibrary,
  setAuthorLock,
} from './slide-actions.js';
import {
  createVisibilityMenu,
  showVisibilityMenuAt,
} from '../slide-visibility-menu.js';
import { takeEscape } from '../../../lib/dom/escape.js';

let activeMenu = null;
// Slide id of the thumbnail ⋯ that opened the menu, if one did.
let activeAnchorSlideId = null;
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
  activeAnchorSlideId = null;
}

/**
 * Whether the menu is open from the ⋯ on this slide's thumbnail. The row is
 * rebuilt on selection, so the button is matched by slide id, not identity.
 * @param {string} slideId
 * @returns {boolean}
 */
export function isSlideMenuOpenFrom(slideId) {
  return !!activeMenu && !!slideId && activeAnchorSlideId === slideId;
}

/** The ⋯ button of the slide whose menu is open, if it is in the DOM. */
function anchorButton() {
  if (!activeAnchorSlideId) return null;
  return document.querySelector(
    `.slide-item[data-slide-id="${CSS.escape(activeAnchorSlideId)}"] .slide-item-menu-btn`,
  );
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
 * @param {Object} options.ctx - Editor callbacks (pres, editorState, setters,
 *   rerenders) plus `api`, `openSlideLibraryModal` and `isAuthor` for the
 *   library and lock items
 * @param {boolean} [options.fromButton] - Opened from the slide's thumbnail
 *   ⋯: focus moves into the menu and returns to the button on Escape
 */
export function showSlideContextMenu({ x, y, slide, ids, ctx, fromButton }) {
  closeSlideContextMenu();

  const menu = h('div', { class: 'slide-context-menu', role: 'menu' });

  const count = ids instanceof Set ? ids.size : ids?.length || 0;

  const addItem = ({ label, danger = false, disabled = false, onClick }) =>
    h('button', {
      class: `slide-context-menu-item${danger ? ' is-danger' : ''}`,
      type: 'button',
      role: 'menuitem',
      text: label,
      disabled,
      onclick: (e) => {
        e.stopPropagation();
        onClick();
      },
    });
  const separator = () =>
    h('div', { class: 'slide-context-menu-sep', role: 'separator' });

  // Copy and Paste (B308): the same clipboard routine as ⌘C/⌘V and the paste
  // bar, so the buffer also reaches another deck. Paste lands after the
  // right-clicked slide, which the opener selected.
  const copyItem = addItem({
    label: t('editor.slide.copy', 'Copy'),
    onClick: () => {
      closeSlideContextMenu();
      copySlidesToClipboard({ ids, ...ctx });
    },
  });
  const pasteCount = getClipboardCount();
  const pasteItem = addItem({
    label:
      pasteCount > 0
        ? t(
            'editor.slide.pasteN',
            { one: 'Paste 1 slide', many: 'Paste {count} slides' },
            { count: pasteCount },
          )
        : t('editor.slides.paste', 'Paste'),
    disabled: pasteCount === 0,
    onClick: () => {
      closeSlideContextMenu();
      pasteSlidesFromClipboard({
        pres: ctx.pres,
        slideTypes: ctx.slideTypes,
        getSelectedSlideId: ctx.getSelectedSlideId,
        setSelectedSlideId: ctx.setSelectedSlideId,
        clearMultiSelection: ctx.clearMultiSelection,
        onMultiSelectionChange: ctx.onMultiSelectionChange,
        editorState: ctx.editorState,
        toast,
        t,
      });
    },
  });

  const duplicateItem = addItem({
    label: t('editor.slide.duplicate', 'Duplicate'),
    onClick: () => {
      closeSlideContextMenu();
      duplicateSlides({ ids, ...ctx });
    },
  });

  menu.append(copyItem, pasteItem, duplicateItem);

  // Quick reposition (single slide, and only when there's more than one slide
  // to reorder). "Move to position…" accepts a slide number; a number past the
  // end sends it to the end. "Move to end" is the one-click shortcut.
  const slides = ctx.pres?.slides || [];
  const total = slides.length;
  if (
    count <= 1 &&
    total > 1 &&
    typeof ctx.moveSlideToPosition === 'function'
  ) {
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
        const answer = await promptModal(document.body, {
          title: t('editor.slide.moveTo', 'Move to position…'),
          message: t(
            'editor.slide.moveToHint',
            'Enter a slide number (1–{total}). A higher number moves it to the end.',
          ).replace('{total}', String(total)),
          value: String(curPos),
          placeholder: String(total),
          validate: (v) => {
            const n = Number(String(v || '').trim());
            if (!Number.isInteger(n) || n < 1) {
              return t(
                'editor.slide.moveToInvalid',
                'Enter a whole number of 1 or more.',
              );
            }
            return null;
          },
        });
        if (answer == null) return;
        ctx.moveSlideToPosition?.({
          fromId: slide?.id,
          position: Number(answer),
        });
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

    menu.append(separator(), moveToItem, moveEndItem);
  }

  // The slide's own state: lock, library, visibility.
  const stateItems = [];

  // Author lock: on the whole selection; "Unlock" once every slide in it is
  // locked. The badge on the thumbnail shows the state.
  if (ctx.isAuthor?.()) {
    const locked = allAuthorLocked({ ids, pres: ctx.pres });
    stateItems.push(
      addItem({
        label: locked
          ? t('editor.slide.unlock', 'Unlock slide')
          : t('editor.slide.lock', 'Lock slide'),
        onClick: () => {
          closeSlideContextMenu();
          setAuthorLock({ ids, locked: !locked, ...ctx });
        },
      }),
    );
  }

  // Save to slide library: one slide at a time (the dialog names one item).
  if (count <= 1 && ctx.api) {
    const canSave = canSaveSlideToLibrary({
      slide,
      SLIDE_TYPES: ctx.slideTypes,
      api: ctx.api,
    });
    const saveItem = addItem({
      label: t('editor.slideLibrary.save', 'Save to slide library…'),
      disabled: !canSave,
      onClick: () => {
        closeSlideContextMenu();
        saveSlideToLibrary({
          slide,
          pres: ctx.pres,
          api: ctx.api,
          SLIDE_TYPES: ctx.slideTypes,
          openSlideLibraryModal: ctx.openSlideLibraryModal,
        });
      },
    });
    saveItem.title = canSave
      ? t(
          'editor.slideLibrary.save.title',
          'Save this slide so you can reuse it later.',
        )
      : t(
          'editor.slideLibrary.save.disabled',
          'This slide has no content of its own, so there is nothing to save.',
        );
    stateItems.push(saveItem);
  }

  // Visibility only makes sense for a single slide (the one clicked); the
  // preset menu edits one slide at a time.
  if (count <= 1) {
    const visItem = addItem({
      label: t('editor.slideList.visibility', 'Change visibility'),
      onClick: () => {
        // Capture the anchor rect before the context menu is removed, then hand
        // the existing visibility menu a synthetic anchor so it can position.
        const rect = visItem.getBoundingClientRect();
        closeSlideContextMenu();
        const vm = createVisibilityMenu({
          slide,
          onVisibilityChange: () => {
            ctx.markDirty?.();
            ctx.rerenderSlideList?.();
            ctx.rerenderEditor?.();
            ctx.rerenderPreview?.();
          },
        });
        showVisibilityMenuAt({
          anchor: { getBoundingClientRect: () => rect, contains: () => false },
          menu: vm,
        });
      },
    });
    stateItems.push(visItem);
  }
  if (stateItems.length) menu.append(separator(), ...stateItems);

  // Destructive action last, visually separated.
  menu.append(
    separator(),
    addItem({
      label: t('editor.slide.delete', 'Delete'),
      danger: true,
      onClick: async () => {
        closeSlideContextMenu();
        await deleteSlides({ ids, ...ctx });
      },
    }),
  );

  document.body.appendChild(menu);
  activeMenu = menu;
  activeAnchorSlideId = fromButton ? slide?.id || null : null;
  positionAt(menu, x, y);
  // Opened from the thumbnail's ⋯ button (keyboard reachable): put focus in
  // the menu so arrow-free Tab/Enter works without a pointer.
  if (fromButton) {
    requestAnimationFrame(() => {
      menu.querySelector('.slide-context-menu-item:not(:disabled)')?.focus();
    });
  }

  // Dismiss on outside click, another context menu, Escape, scroll or resize.
  const onDocClick = (e) => {
    if (menu.contains(e.target)) return;
    // The opening ⋯ toggles its own menu (its click handler closes it).
    if (anchorButton()?.contains(e.target)) return;
    closeSlideContextMenu();
  };
  // Capture phase: the menu is a layer over the slides panel, and in the
  // narrow drawer the drawer's own Escape (bubble, registered at mount) would
  // otherwise hear the key first and close both.
  const onKey = (e) => {
    if (!takeEscape(e)) return;
    const button = anchorButton();
    closeSlideContextMenu();
    button?.focus();
  };
  const onScrollOrResize = () => closeSlideContextMenu();
  // Defer binding the click listener so the opening click doesn't close it.
  setTimeout(() => {
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('contextmenu', onDocClick, true);
  }, 0);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize);

  detachActive = () => {
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('contextmenu', onDocClick, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScrollOrResize, true);
    window.removeEventListener('resize', onScrollOrResize);
  };
}
