import { getClipboardCount } from '../../../lib/slide-authoring/slide-clipboard.js';
import { pasteSlidesFromClipboard } from '../../../lib/slide-authoring/clone-slides.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import {
  copySlidesToClipboard,
  duplicateSlides,
  deleteSlides,
} from './slide-actions.js';

export function attachSlideListKeyNavigation({
  slideListEl,
  pres,
  slideTypes = null,
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
  // Opens the slide-list menu for a focused row (Enter, menu key, Shift+F10).
  openRowMenu,
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

  // The rows a keyboard walks: every slide row on screen, never the "+"
  // insert rows (B726) and never the children of a collapsed parent.
  const navRows = () =>
    Array.from(
      slideListEl?.querySelectorAll?.('.slide-item:not(.is-hidden)') || [],
    );

  // Focus the row of `slideId` once the list has re-rendered under it.
  const focusRowLater = (slideId) => {
    requestAnimationFrame(() => {
      const el = slideListEl.querySelector(
        `.list-item.slide-item[data-slide-id="${slideId}"]`,
      );
      el?.focus?.();
      el?.scrollIntoView?.({ block: 'nearest' });
    });
  };

  // Keys on a focused row (B726, D349): arrows, Home and End move the
  // selection and the roving stop over the slides; Enter, the menu key and
  // Shift+F10 open the row's actions; Left and Right fold a parent.
  const rowKeyHandler = (e, row) => {
    const isMenuKey =
      e.key === 'Enter' ||
      e.key === 'ContextMenu' ||
      (e.key === 'F10' && e.shiftKey);
    if (isMenuKey) {
      if (!openRowMenu || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      openRowMenu(row);
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const toggle = row.querySelector('.slide-collapse-toggle');
      if (!toggle) return;
      const expanded = row.classList.contains('slide-item--expanded');
      if ((e.key === 'ArrowLeft') !== expanded) return;
      e.preventDefault();
      toggle.click();
      focusRowLater(row.dataset.slideId);
      return;
    }

    const nav = navRows();
    const cur = nav.indexOf(row);
    if (cur < 0) return;
    let next;
    if (e.key === 'ArrowUp') next = nav[Math.max(0, cur - 1)];
    else if (e.key === 'ArrowDown')
      next = nav[Math.min(nav.length - 1, cur + 1)];
    else if (e.key === 'Home') next = nav[0];
    else if (e.key === 'End') next = nav[nav.length - 1];
    else return;

    e.preventDefault();
    if (!next || next === row) return;
    const sid = String(next.dataset.slideId || '').trim();
    const slides =
      typeof getSlides === 'function' ? getSlides() : pres?.slides || [];
    if (!sid || !slides.some((s) => String(s?.id || '') === sid)) return;
    clearMultiSelection?.();
    lastNavSlideId = sid;
    setSelectedSlideId?.(sid);
    editorState.refreshAll();
    focusRowLater(sid);
  };

  const keyHandler = (e) => {
    const activeEl = document.activeElement;
    const row =
      activeEl && slideListEl?.contains?.(activeEl)
        ? activeEl.closest?.('.slide-item')
        : null;
    // A row's own keys; a button inside it keeps Enter and its click.
    if (row) {
      if (activeEl === row || (e.key !== 'Enter' && e.key !== ' ')) {
        rowKeyHandler(e, row);
      }
      return;
    }
    if (activeEl && slideListEl?.contains?.(activeEl)) return;

    // Outside the list: up and down still walk the slides ("select slides"
    // keyboard UX), unless a control has the key.
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (shouldIgnoreKeyEvent(e)) return;
    e.preventDefault();
    const slides =
      typeof getSlides === 'function' ? getSlides() : pres?.slides || [];
    const curIdx = slides.findIndex((s) => s.id === getSelectedSlideId?.());
    if (curIdx < 0) return;
    const isShift = e.shiftKey;
    if (e.key === 'ArrowUp')
      selectSlideByIndex(curIdx - 1, { extend: isShift });
    if (e.key === 'ArrowDown')
      selectSlideByIndex(curIdx + 1, { extend: isShift });
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
      // Same routine as the slide-list menu's Copy (slide-actions.js).
      copySlidesToClipboard({
        ids: selectedIds,
        pres,
        onMultiSelectionChange,
      });
    } else if (e.key === 'v' || e.key === 'V') {
      // Paste slides from clipboard. Same routine as the paste bar, so the two
      // entry points cannot drift (clone-slides.js).
      if (!getClipboardCount()) return; // Let browser handle normal paste
      e.preventDefault();
      pasteSlidesFromClipboard({
        pres,
        slideTypes,
        getSelectedSlideId,
        setSelectedSlideId,
        clearMultiSelection,
        onMultiSelectionChange,
        editorState,
        toast,
        t,
      });
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
      slideTypes,
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
    if (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      tag === 'BUTTON'
    )
      return;
    if (e.target?.isContentEditable) return;

    const multi = getSelectedSlideIds?.() || new Set();
    const selectedIds =
      multi.size > 0
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
