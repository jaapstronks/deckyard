import {
  copySlides,
  getClipboardSlides,
} from '../../../lib/slide-authoring/slide-clipboard.js';
import { newId } from '../../../lib/util/id.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import {
  duplicateSlides,
  deleteSlides,
  expandSelectionWithChildren,
} from './slide-actions.js';

export function attachSlideListKeyNavigation({
  slideListEl,
  pres,
  getSlides,
  getSelectedSlideId,
  setSelectedSlideId,
  getSelectedSlideIds,
  setSelectedSlideIds,
  clearMultiSelection,
  onMultiSelectionChange,
  editorState,
  rerenderSlideList,
  markDirty,
  performUndo,
  performRedo,
} = {}) {
  let lastNavSlideId = null; // Anchor for shift-navigation

  const selectSlideByIndex = (idx, { scroll = true, extend = false } = {}) => {
    const slides =
      typeof getSlides === 'function' ? getSlides() : pres?.slides || [];
    if (!slides.length) return;
    const nextIdx = Math.max(0, Math.min(slides.length - 1, idx));
    const next = slides[nextIdx];
    if (!next) return;

    if (extend && lastNavSlideId) {
      // Shift+arrow: extend selection from anchor to current
      const allSlideIds = slides.map((s) => s.id);
      const anchorIdx = allSlideIds.indexOf(lastNavSlideId);
      const targetIdx = allSlideIds.indexOf(next.id);
      if (anchorIdx >= 0 && targetIdx >= 0) {
        const start = Math.min(anchorIdx, targetIdx);
        const end = Math.max(anchorIdx, targetIdx);
        const newSelection = new Set();
        for (let i = start; i <= end; i++) {
          newSelection.add(allSlideIds[i]);
        }
        setSelectedSlideIds?.(newSelection);
        onMultiSelectionChange?.();
      }
    } else {
      // Normal arrow: single selection, clear multi-selection
      clearMultiSelection?.();
      lastNavSlideId = next.id;
    }

    setSelectedSlideId?.(next.id);
    if (extend) {
      rerenderSlideList?.();
    } else {
      editorState.refreshAll();
    }
    if (scroll) {
      const active = slideListEl?.querySelector?.('.list-item.is-active');
      active?.scrollIntoView?.({ block: 'nearest' });
    }
  };

  const shouldIgnoreKeyEvent = (e) => {
    const el = e?.target;
    if (!el || typeof el !== 'object') return false;
    // Allow arrow navigation on the slide-insert "+" button (special case).
    if (el?.closest?.('.slide-insert-btn')) return false;
    const tag = String(el.tagName || '').toUpperCase();
    if (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      tag === 'BUTTON'
    )
      return true;
    if (el.isContentEditable) return true;
    return false;
  };

  const keyHandler = (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const activeEl = document.activeElement;
    const inList = activeEl && slideListEl?.contains?.(activeEl);
    const isShift = e.shiftKey;

    // Default behavior (global): keep the existing "select slides" keyboard UX.
    if (!inList) {
      if (shouldIgnoreKeyEvent(e)) return;
      e.preventDefault();
      const slides =
        typeof getSlides === 'function' ? getSlides() : pres?.slides || [];
      const curIdx = slides.findIndex(
        (s) => s.id === getSelectedSlideId?.()
      );
      if (curIdx < 0) return;
      if (e.key === 'ArrowUp') selectSlideByIndex(curIdx - 1, { extend: isShift });
      if (e.key === 'ArrowDown') selectSlideByIndex(curIdx + 1, { extend: isShift });
      return;
    }

    // When focus is inside the list: include the "+" insert rows in the navigation.
    const currentNav =
      activeEl?.closest?.('.slide-item') ||
      activeEl?.closest?.('.slide-insert-btn');
    if (!currentNav) return;
    // Only hijack when navigating list items / insert buttons.
    if (
      !currentNav.classList?.contains?.('slide-item') &&
      !currentNav.classList?.contains?.('slide-insert-btn')
    )
      return;

    e.preventDefault();
    const nav = Array.from(
      slideListEl.querySelectorAll('.slide-item, .slide-insert-btn')
    );
    const cur = nav.indexOf(currentNav);
    if (cur < 0) return;
    const delta = e.key === 'ArrowUp' ? -1 : 1;
    const nextEl = nav[Math.max(0, Math.min(nav.length - 1, cur + delta))];
    if (!nextEl || nextEl === currentNav) return;

    // Focus insert button (selection remains on the current slide).
    if (nextEl.classList.contains('slide-insert-btn')) {
      nextEl.focus?.();
      nextEl.scrollIntoView?.({ block: 'nearest' });
      return;
    }

    // Focus slide item and select it.
    if (nextEl.classList.contains('slide-item')) {
      const sid = String(nextEl.dataset.slideId || '').trim();
      if (!sid) return;
      const slides =
        typeof getSlides === 'function' ? getSlides() : pres?.slides || [];
      const exists = slides.some((s) => String(s?.id || '') === sid);
      if (!exists) return;
      setSelectedSlideId?.(sid);
      editorState.refreshAll();
      requestAnimationFrame(() => {
        const el = slideListEl.querySelector(
          `.list-item.slide-item[data-slide-id="${sid}"]`
        );
        el?.focus?.();
        el?.scrollIntoView?.({ block: 'nearest' });
      });
    }
  };

  // Copy/paste keyboard handlers
  const copyPasteHandler = (e) => {
    // Only handle Cmd/Ctrl+C and Cmd/Ctrl+V
    const isMeta = e.metaKey || e.ctrlKey;
    if (!isMeta) return;

    // Don't intercept when typing in inputs
    const tag = String(e.target?.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.target?.isContentEditable) return;

    if (e.key === 'c' || e.key === 'C') {
      // Copy selected slides (including children of selected parents)
      const selectedIds = getSelectedSlideIds?.() || new Set();
      if (selectedIds.size === 0) return; // Let browser handle normal copy
      e.preventDefault();

      // Expand selection to include children of any selected parents
      const toCopy = expandSelectionWithChildren(selectedIds, pres?.slides);

      const slidesToCopy = (pres?.slides || []).filter((s) => toCopy.has(s.id));
      if (slidesToCopy.length > 0 && copySlides(slidesToCopy)) {
        toast?.success?.(
          t('editor.slides.copiedToClipboard', '{n} slide(s) copied', { n: slidesToCopy.length })
        );
        onMultiSelectionChange?.();
      }
    } else if (e.key === 'v' || e.key === 'V') {
      // Paste slides from clipboard
      const clipboardSlides = getClipboardSlides();
      if (!clipboardSlides || clipboardSlides.length === 0) return; // Let browser handle normal paste
      e.preventDefault();

      const afterSlideId = getSelectedSlideId?.();
      const slides = pres?.slides || [];
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
          content: JSON.parse(JSON.stringify(clipSlide.content || {})),
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

      // Select the first pasted slide and clear multi-selection
      clearMultiSelection?.();
      setSelectedSlideId?.(newSlides[0]?.id || null);
      markDirty?.();
      editorState.refreshAll();

      toast?.success?.(
        t('editor.slides.pasted', '{n} slide(s) pasted', { n: newSlides.length })
      );
      onMultiSelectionChange?.();
    }
  };

  // Cmd/Ctrl+D: duplicate the selected slide(s) in place, right after the
  // selection. Faithful deep copy (keeps visibility/layout/background/etc.),
  // with fresh ids and regenerated interaction ids — mirrors the paste recipe.
  const duplicateHandler = (e) => {
    const isMeta = e.metaKey || e.ctrlKey;
    if (!isMeta) return;
    if (String(e.key || '').toLowerCase() !== 'd') return;

    // Don't intercept while typing or operating a control.
    const tag = String(e.target?.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.target?.isContentEditable) return;

    const multi = getSelectedSlideIds?.() || new Set();
    const selectedIds =
      multi.size > 0
        ? new Set(multi)
        : new Set([getSelectedSlideId?.()].filter(Boolean));
    if (selectedIds.size === 0) return;
    e.preventDefault();

    duplicateSlides({
      ids: selectedIds,
      pres,
      editorState,
      setSelectedSlideId,
      clearMultiSelection,
      markDirty,
      onMultiSelectionChange,
    });
  };

  // Delete/Backspace: delete the selected slide(s), Keynote/Slides-style. The
  // per-slide Delete now lives in the form's ⋯ menu, so the keyboard is the
  // fast path for deletion.
  const deleteHandler = async (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // Never intercept while typing or operating a control.
    const tag = String(e.target?.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
    if (e.target?.isContentEditable) return;

    const multi = getSelectedSlideIds?.() || new Set();
    const selectedIds = multi.size > 0
      ? new Set(multi)
      : new Set([getSelectedSlideId?.()].filter(Boolean));
    if (selectedIds.size === 0) return;
    e.preventDefault();

    await deleteSlides({
      ids: selectedIds,
      pres,
      editorState,
      setSelectedSlideId,
      clearMultiSelection,
      onMultiSelectionChange,
    });
  };

  // Undo/redo keyboard handler — delegates to the shared undo actions so the
  // topbar buttons and the keyboard use one implementation.
  const undoRedoHandler = (e) => {
    const isMeta = e.metaKey || e.ctrlKey;
    if (!isMeta) return;

    // Only handle z/Z key
    const key = String(e.key || '').toLowerCase();
    if (key !== 'z') return;

    // Don't intercept when typing in inputs
    const tag = String(e.target?.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.target?.isContentEditable) return;

    const isRedo = e.shiftKey;
    const did = isRedo ? performRedo?.() : performUndo?.();
    if (did) e.preventDefault();
  };

  window.addEventListener('keydown', keyHandler);
  window.addEventListener('keydown', copyPasteHandler);
  window.addEventListener('keydown', duplicateHandler);
  window.addEventListener('keydown', deleteHandler);
  window.addEventListener('keydown', undoRedoHandler);
  const detach = () => {
    window.removeEventListener('keydown', keyHandler);
    window.removeEventListener('keydown', copyPasteHandler);
    window.removeEventListener('keydown', duplicateHandler);
    window.removeEventListener('keydown', deleteHandler);
    window.removeEventListener('keydown', undoRedoHandler);
  };

  return { selectSlideByIndex, detach };
}
