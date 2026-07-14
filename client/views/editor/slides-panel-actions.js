import { t } from '../../lib/ui-i18n.js';
import { confirmModal } from '../../lib/modal.js';
import { newId } from '../../lib/id.js';
import { deepClone } from './editor-utils.js';
import { getChildIds } from './slide-list/nested-helpers.js';
import {
  copySlides,
  getClipboardSlides,
  getClipboardCount,
} from '../../lib/slide-clipboard.js';
import {
  copyIcon,
  trashIcon,
  closeIcon,
  lockIcon,
  unlockIcon,
} from '../../lib/icons.js';

/**
 * Expand selection to include children of any selected parents
 */
function expandSelectionWithChildren(selectedIds, slides) {
  const expanded = new Set(selectedIds);
  for (const id of selectedIds) {
    const childIds = getChildIds(id, slides);
    for (const childId of childIds) {
      expanded.add(childId);
    }
  }
  return expanded;
}

/**
 * Creates bulk action bar and clipboard paste functionality for the slides panel.
 * @param {Object} options
 * @param {Function} options.h - DOM element factory
 * @param {Object} options.pres - Presentation object
 * @param {Object} options.toast - Toast notification API
 * @param {Function} options.getSelectedSlideId - Get currently selected slide ID
 * @param {Function} options.setSelectedSlideId - Set selected slide ID
 * @param {Function} options.getSelectedSlideIds - Get multi-selected slide IDs
 * @param {Function} options.clearMultiSelection - Clear multi-selection
 * @param {Function} options.rerenderSlideList - Re-render the slide list
 * @param {Object} options.editorState - Editor state updater
 * @param {Function} options.isAuthor - Check if current user is author
 * @returns {Object} Bulk action bar API
 */
export function createSlidesPanelActions({
  h,
  pres,
  toast,
  getSelectedSlideId,
  setSelectedSlideId,
  getSelectedSlideIds,
  clearMultiSelection,
  rerenderSlideList,
  editorState,
  isAuthor,
}) {
  // Bulk action bar for multi-selection
  const bulkActionBar = h('div', { class: 'slides-bulk-action-bar', hidden: true });
  const bulkCountEl = h('span', { class: 'slides-bulk-count', text: '' });

  const updateBulkActionBar = () => {
    const selected = getSelectedSlideIds?.() || new Set();
    const count = selected.size;
    if (count > 0) {
      bulkCountEl.textContent = t(
        'editor.slides.bulkSelected',
        '{n} selected',
        { n: count }
      );
      bulkActionBar.hidden = false;
    } else {
      bulkActionBar.hidden = true;
    }
    // Always update paste bar visibility
    updatePasteBar();
  };

  const bulkCopyBtn = h('button', {
    class: 'btn btn-secondary is-compact is-icon-only',
    type: 'button',
    title: t('editor.slides.bulkCopyTitle', 'Copy selected slides (⌘C)'),
    onclick: () => {
      const selected = getSelectedSlideIds?.() || new Set();
      if (selected.size === 0) return;

      // Expand selection to include children of any selected parents
      const toCopy = expandSelectionWithChildren(selected, pres.slides);

      const slidesToCopy = (pres.slides || []).filter((s) => toCopy.has(s.id));
      if (copySlides(slidesToCopy)) {
        toast?.success?.(
          t('editor.slides.copiedToClipboard', '{n} slide(s) copied', { n: slidesToCopy.length })
        );
        updateBulkActionBar();
      }
    },
  });

  const bulkDeleteBtn = h('button', {
    class: 'btn btn-danger is-compact is-icon-only',
    type: 'button',
    title: t('editor.slides.bulkDeleteTitle', 'Delete selected slides'),
    onclick: async () => {
      const selected = getSelectedSlideIds?.() || new Set();
      if (selected.size === 0) return;

      // Expand selection to include children of any selected parents
      const toDelete = expandSelectionWithChildren(selected, pres.slides);

      // Build confirmation message
      const childCount = toDelete.size - selected.size;
      let confirmMsg;
      if (childCount > 0) {
        confirmMsg = t(
          'editor.slides.bulkDeleteConfirmWithChildren',
          'Delete {n} selected slides and {c} nested slides?',
          { n: selected.size, c: childCount }
        );
      } else {
        confirmMsg = t(
          'editor.slides.bulkDeleteConfirm',
          'Delete {n} selected slides?',
          { n: selected.size }
        );
      }

      if (!(await confirmModal(h, document.body, {
        title: t('editor.slides.bulkDeleteTitle', 'Delete selected slides'),
        message: confirmMsg,
        confirmLabel: t('common.delete', 'Delete'),
        danger: true,
      }))) return;
      pres.slides = (pres.slides || []).filter((s) => !toDelete.has(s.id));
      clearMultiSelection?.();
      setSelectedSlideId?.(pres.slides?.[0]?.id || null);
      editorState.dirtyRefreshAll();
      updateBulkActionBar();
    },
  });

  const bulkCancelBtn = h('button', {
    class: 'btn btn-secondary is-compact is-icon-only',
    type: 'button',
    title: t('editor.slides.bulkCancelTitle', 'Cancel selection'),
    onclick: () => {
      clearMultiSelection?.();
      rerenderSlideList?.();
      updateBulkActionBar();
    },
  });

  // Bulk lock button (author only)
  const bulkLockBtn = h('button', {
    class: 'btn btn-secondary is-compact is-icon-only',
    type: 'button',
    title: t('editor.slides.lockSelectedTitle', 'Lock selected slides'),
    onclick: () => {
      const selected = getSelectedSlideIds?.() || new Set();
      if (selected.size === 0) return;
      for (const slide of (pres.slides || [])) {
        if (selected.has(slide.id)) {
          slide.lockedByAuthor = true;
        }
      }
      editorState.dirtyRefreshAll();
      updateBulkActionBar();
    },
  });

  // Bulk unlock button (author only)
  const bulkUnlockBtn = h('button', {
    class: 'btn btn-secondary is-compact is-icon-only',
    type: 'button',
    title: t('editor.slides.unlockSelectedTitle', 'Unlock selected slides'),
    onclick: () => {
      const selected = getSelectedSlideIds?.() || new Set();
      if (selected.size === 0) return;
      for (const slide of (pres.slides || [])) {
        if (selected.has(slide.id)) {
          slide.lockedByAuthor = false;
        }
      }
      editorState.dirtyRefreshAll();
      updateBulkActionBar();
    },
  });

  // Add icons to buttons
  bulkCopyBtn.append(copyIcon());
  bulkDeleteBtn.append(trashIcon());
  bulkCancelBtn.append(closeIcon());
  bulkLockBtn.append(lockIcon());
  bulkUnlockBtn.append(unlockIcon());

  bulkActionBar.append(bulkCountEl, bulkCopyBtn);
  // Add lock/unlock buttons for authors
  if (isAuthor?.()) {
    bulkActionBar.append(bulkLockBtn, bulkUnlockBtn);
  }
  bulkActionBar.append(bulkDeleteBtn, bulkCancelBtn);

  // Paste bar for clipboard slides
  const pasteBar = h('div', { class: 'slides-paste-bar', hidden: true });
  const pasteCountEl = h('span', { class: 'slides-paste-count', text: '' });

  const pasteFromClipboard = () => {
    const clipboardSlides = getClipboardSlides();
    if (!clipboardSlides || clipboardSlides.length === 0) return;

    const afterSlideId = getSelectedSlideId?.();
    const slides = pres.slides || [];
    let insertIdx = slides.length;
    if (afterSlideId) {
      const afterIdx = slides.findIndex((x) => x.id === afterSlideId);
      insertIdx = afterIdx >= 0 ? afterIdx + 1 : slides.length;
    }

    // Create a map of old IDs to new IDs for preserving parent-child relationships
    const idMap = new Map();
    for (const clipSlide of clipboardSlides) {
      idMap.set(clipSlide.id, newId());
    }

    // Create new slides from clipboard data with new IDs
    const newSlides = clipboardSlides.map((clipSlide) => {
      const newSlideId = idMap.get(clipSlide.id);
      const s = {
        id: newSlideId,
        type: clipSlide.type,
        content: deepClone(clipSlide.content || {}),
        notes: clipSlide.notes || '',
        // Map parentId to new ID if it exists in the clipboard, otherwise null
        parentId: clipSlide.parentId && idMap.has(clipSlide.parentId)
          ? idMap.get(clipSlide.parentId)
          : null,
      };
      // Ensure interaction IDs don't collide for special slide types
      if (s.type === 'poll-slide' && s.content) {
        s.content.pollId = newId();
      }
      if (s.type === 'follow-invite-slide' && s.content) {
        s.content.presentationId = pres?.id || '';
      }
      return s;
    });

    // Insert slides at the calculated position
    pres.slides.splice(insertIdx, 0, ...newSlides);

    // Select the first pasted slide
    setSelectedSlideId?.(newSlides[0]?.id || null);
    editorState.dirtyRefreshAll();

    toast?.success?.(
      t('editor.slides.pasted', '{n} slide(s) pasted', { n: newSlides.length })
    );
  };

  const pasteBtn = h('button', {
    class: 'btn btn-primary is-compact',
    type: 'button',
    text: t('editor.slides.paste', 'Paste'),
    title: t('editor.slides.pasteTitle', 'Paste slides after selected slide (⌘V)'),
    onclick: () => pasteFromClipboard(),
  });

  pasteBar.append(pasteCountEl, pasteBtn);

  const updatePasteBar = () => {
    const count = getClipboardCount();
    if (count > 0) {
      pasteCountEl.textContent = t(
        'editor.slides.clipboardCount',
        '{n} in clipboard',
        { n: count }
      );
      pasteBar.hidden = false;
    } else {
      pasteBar.hidden = true;
    }
  };

  const copySelectedSlides = () => {
    const selected = getSelectedSlideIds?.() || new Set();
    if (selected.size === 0) return false;

    // Expand selection to include children of any selected parents
    const toCopy = expandSelectionWithChildren(selected, pres.slides);

    const slidesToCopy = (pres.slides || []).filter((s) => toCopy.has(s.id));
    return copySlides(slidesToCopy);
  };

  // Initialize paste bar visibility
  updatePasteBar();

  return {
    bulkActionBar,
    pasteBar,
    updateBulkActionBar,
    pasteFromClipboard,
    copySelectedSlides,
  };
}