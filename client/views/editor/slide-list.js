import { oneLine, slideLabel, slidePrimaryLabel } from './editor-utils.js';
import { attachSlideListKeyNavigation } from './slide-list/keyboard-nav.js';
import { createInsertRow } from './slide-list/insert-row.js';
import { t } from '../../lib/ui-i18n.js';
import {
  findFirstMatchInSlide,
  normalizeQuery,
} from './slide-list/search.js';
import {
  buildChildrenMap,
  getDescendantIds,
  isChildSlide,
  isParentSlide,
  getCollapsedState,
  saveCollapsedState,
} from './slide-list/nested-helpers.js';
import { createSlideItem } from './slide-list/render-item.js';
import { attachDragHandlers } from './slide-list/drag-handlers.js';
import { attachClickHandler } from './slide-list/click-handlers.js';
import {
  showSlideContextMenu,
  closeSlideContextMenu,
} from './slide-list/context-menu.js';

export function setupSlideList({
  h,
  slideListEl,
  pres,
  getSelectedSlideId,
  setSelectedSlideId,
  getSelectedSlideIds,
  setSelectedSlideIds,
  clearMultiSelection,
  onMultiSelectionChange,
  SLIDE_TYPES,
  renderSlideElement,
  editorState,
  markDirty,
  rerenderEditor,
  rerenderPreview,
  onRequestInsert,
  getSearchQuery,
  onAfterSelectSlide,
  getSlideCommentCount,
  getSlideLockInfo,
  isSlideLockedByOther,
  isSlideAuthorLocked,
  isAuthor,
  performUndo,
  performRedo,
} = {}) {
  let draggingSlideId = null;
  let draggingSlideIds = []; // For multi-select drag
  let dropTargetId = null;
  let dropTargetPos = null;
  let lastClickedSlideId = null; // For shift-click range selection

  const clearDraggingVisuals = () => {
    try {
      for (const el of slideListEl.querySelectorAll('.slide-item.is-dragging')) {
        el.classList.remove('is-dragging');
      }
    } catch {
      // ignore
    }
  };

  const flashReorder = (slideId) => {
    const sid = String(slideId || '').trim();
    if (!sid) return;
    requestAnimationFrame(() => {
      const el = slideListEl.querySelector(
        `.list-item.slide-item[data-slide-id="${sid}"]`
      );
      if (!el) return;
      el.classList.remove('is-reorder-flash');
      // Force reflow so re-adding the class retriggers the animation.
      // eslint-disable-next-line no-unused-expressions
      el.offsetWidth;
      el.classList.add('is-reorder-flash');
      setTimeout(() => {
        try {
          el.classList.remove('is-reorder-flash');
        } catch {
          // ignore
        }
      }, 650);
    });
  };

  const moveSlide = ({ fromId, toId, pos, makeChild = false, makeTopLevel = false }) => {
    if (!fromId || !toId || fromId === toId) return;
    const fromIdx = pres.slides.findIndex((x) => x.id === fromId);
    const toIdxRaw = pres.slides.findIndex((x) => x.id === toId);
    if (fromIdx < 0 || toIdxRaw < 0) return;

    const fromSlide = pres.slides[fromIdx];
    const toSlide = pres.slides[toIdxRaw];

    // Prevent nesting more than 1 level deep
    if (makeChild && toSlide?.parentId) {
      return;
    }

    // Prevent making a parent a child of its own child
    if (makeChild) {
      const childrenOfFrom = getDescendantIds(fromId, pres.slides);
      if (childrenOfFrom.includes(toId)) {
        return;
      }
    }

    // If moving a parent, collect its children to move with it
    const childrenMap = buildChildrenMap(pres.slides);
    const isParent = isParentSlide(fromId, childrenMap);
    const childIds = isParent ? getDescendantIds(fromId, pres.slides) : [];

    // Remove the slide (and its children if parent)
    const idsToRemove = new Set([fromId, ...childIds]);
    const removedSlides = pres.slides.filter((s) => idsToRemove.has(s.id));
    pres.slides = pres.slides.filter((s) => !idsToRemove.has(s.id));

    // Find new target index (after removal)
    const toIdxNew = pres.slides.findIndex((x) => x.id === toId);
    if (toIdxNew < 0) {
      pres.slides.push(...removedSlides);
    } else {
      let insertIdx = pos === 'after' ? toIdxNew + 1 : toIdxNew;

      // Update parentId if making child or top-level
      if (makeChild) {
        fromSlide.parentId = toId;
        const targetChildren = pres.slides.filter((s) => s.parentId === toId);
        if (targetChildren.length > 0) {
          const lastChildIdx = pres.slides.findIndex(
            (s) => s.id === targetChildren[targetChildren.length - 1].id
          );
          insertIdx = lastChildIdx + 1;
        } else {
          insertIdx = toIdxNew + 1;
        }
      } else if (fromSlide.parentId) {
        if (!toSlide?.parentId) {
          fromSlide.parentId = null;
        }
      }

      pres.slides.splice(insertIdx, 0, ...removedSlides);
    }

    markDirty?.();
    rerenderSlideList();
    flashReorder(fromId);
  };

  // Move a slide to an explicit 1-based position (as shown in the list). A
  // position <= 1 moves it to the start; a position past the end (or Infinity)
  // moves it to the end. If the slide is a parent, its children travel with it
  // as a contiguous block; the slide itself becomes top-level.
  const moveSlideToPosition = ({ fromId, position }) => {
    if (!fromId) return;
    const slides = pres.slides || [];
    if (!slides.some((s) => s.id === fromId)) return;

    const childrenMap = buildChildrenMap(slides);
    const isParent = isParentSlide(fromId, childrenMap);
    const childIds = isParent ? getDescendantIds(fromId, slides) : [];
    const idsToMove = new Set([fromId, ...childIds]);

    const block = slides.filter((s) => idsToMove.has(s.id));
    const rest = slides.filter((s) => !idsToMove.has(s.id));
    if (!block.length) return;

    // Repositioning by number is a top-level move; drop any old parent link.
    const moved = block.find((s) => s.id === fromId);
    if (moved?.parentId) moved.parentId = null;

    const n = Math.floor(Number(position));
    const insertIdx = Number.isFinite(n)
      ? Math.max(0, Math.min(rest.length, n - 1))
      : rest.length;
    rest.splice(insertIdx, 0, ...block);
    pres.slides = rest;

    markDirty?.();
    rerenderSlideList();
    flashReorder(fromId);
  };

  const moveMultipleSlides = ({ slideIds, toId, pos, makeChild = false }) => {
    if (!slideIds || slideIds.length === 0 || !toId) return;
    if (slideIds.includes(toId)) return;

    const toSlide = pres.slides.find((s) => s.id === toId);

    // Prevent nesting more than 1 level deep
    if (makeChild && toSlide?.parentId) {
      return;
    }

    // Include children of any parent slides being moved
    const childrenMap = buildChildrenMap(pres.slides);
    const allIdsToMove = new Set(slideIds);
    for (const id of slideIds) {
      if (isParentSlide(id, childrenMap)) {
        for (const childId of getDescendantIds(id, pres.slides)) {
          allIdsToMove.add(childId);
        }
      }
    }

    const slidesToMove = (pres.slides || []).filter((s) => allIdsToMove.has(s.id));
    if (slidesToMove.length === 0) return;

    pres.slides = pres.slides.filter((s) => !allIdsToMove.has(s.id));

    const toIdxRaw = pres.slides.findIndex((x) => x.id === toId);
    if (toIdxRaw < 0) {
      pres.slides.push(...slidesToMove);
    } else {
      let insertIdx = pos === 'after' ? toIdxRaw + 1 : toIdxRaw;

      if (makeChild) {
        for (const s of slidesToMove) {
          if (!s.parentId) {
            s.parentId = toId;
          }
        }
        const targetChildren = pres.slides.filter((s) => s.parentId === toId);
        if (targetChildren.length > 0) {
          const lastChildIdx = pres.slides.findIndex(
            (s) => s.id === targetChildren[targetChildren.length - 1].id
          );
          insertIdx = lastChildIdx + 1;
        } else {
          insertIdx = toIdxRaw + 1;
        }
      } else if (!toSlide?.parentId) {
        for (const s of slidesToMove) {
          if (s.parentId) {
            s.parentId = null;
          }
        }
      }

      pres.slides.splice(insertIdx, 0, ...slidesToMove);
    }

    markDirty?.();
    rerenderSlideList();
    for (const s of slidesToMove) {
      flashReorder(s.id);
    }
  };

  const clearDropIndicators = () => {
    for (const el of slideListEl.querySelectorAll('.list-item.is-drop-before, .list-item.is-drop-after, .list-item.is-drop-nest')) {
      el.classList.remove('is-drop-before');
      el.classList.remove('is-drop-after');
      el.classList.remove('is-drop-nest');
    }
    for (const hint of slideListEl.querySelectorAll('.slide-nest-hint')) {
      hint.remove();
    }
    dropTargetId = null;
    dropTargetPos = null;
  };

  const setDropIndicator = (itemEl, pos) => {
    if (!itemEl) return;
    if (dropTargetId === itemEl.dataset.slideId && dropTargetPos === pos) return;
    clearDropIndicators();
    dropTargetId = itemEl.dataset.slideId;
    dropTargetPos = pos;
    itemEl.classList.toggle('is-drop-before', pos === 'before');
    itemEl.classList.toggle('is-drop-after', pos === 'after');
    itemEl.classList.toggle('is-drop-nest', pos === 'nest');
    // Spell out the otherwise-hidden nest affordance: the centre zone reads as
    // "nest inside this slide" only once you land on it, so label it explicitly.
    if (pos === 'nest') {
      itemEl.appendChild(
        h('div', {
          class: 'slide-nest-hint',
          text: t('editor.slideList.nestHint', 'Drop to nest'),
        })
      );
    }
  };

  // Track collapsed state for nested slides
  let collapsedParents = getCollapsedState(pres?.id);

  const toggleCollapsed = (slideId) => {
    if (collapsedParents.has(slideId)) {
      collapsedParents.delete(slideId);
    } else {
      collapsedParents.add(slideId);
    }
    saveCollapsedState(pres?.id, collapsedParents);
    rerenderSlideList();
  };

  const rerenderSlideList = () => {
    slideListEl.innerHTML = '';
    const allSlides = pres.slides || [];
    const selectedSlideId = getSelectedSlideId?.();
    const multiSelectedIds = getSelectedSlideIds?.() || new Set();
    const q = normalizeQuery(getSearchQuery?.());
    const searchActive = !!q;

    // Build nested structure maps
    const childrenMap = buildChildrenMap(allSlides);
    collapsedParents = getCollapsedState(pres?.id);

    const indexById = new Map();
    for (let i = 0; i < allSlides.length; i += 1) {
      const sid = allSlides[i]?.id;
      if (sid != null) indexById.set(sid, i);
    }

    const matches = [];
    for (let i = 0; i < allSlides.length; i += 1) {
      const s = allSlides[i];
      if (!s) continue;
      if (!searchActive) {
        matches.push({ slide: s, match: null });
        continue;
      }
      const m = findFirstMatchInSlide(s, q);
      if (m) matches.push({ slide: s, match: m });
    }

    const slides = matches.map((x) => x.slide);
    const matchedIds = slides.map((s) => s.id);

    const insertRow = (afterSlideId, { isChild = false, parentId = null } = {}) => {
      const row = createInsertRow({
        h,
        afterSlideId,
        parentId,
        onRequestInsert,
        getDraggingSlideId: () => draggingSlideId,
        setDraggingSlideId: (id) => {
          draggingSlideId = id;
        },
        getDraggingSlideIds: () => draggingSlideIds,
        setDropIndicator,
        clearDropIndicators,
        moveSlide,
        moveMultipleSlides,
      });
      if (isChild) {
        row.classList.add('slide-insert--child');
      }
      return row;
    };

    if (searchActive) {
      slideListEl.append(
        h('div', {
          class: 'help slides-search-hint',
          text: t(
            'editor.slideList.searchHint',
            'Search results — clear the search box to reorder or add slides.'
          ),
        })
      );
    } else {
      slideListEl.append(insertRow(null));
    }

    if (searchActive && !slides.length) {
      slideListEl.append(
        h('div', {
          class: 'help slides-search-empty',
          text: t('editor.slideList.empty', 'No slides found.'),
        })
      );
      return {
        total: allSlides.length,
        shown: 0,
        query: q,
        matchedIds: [],
      };
    }

    // Shared context for render modules
    const renderContext = {
      h,
      pres,
      slideListEl,
      selectedSlideId,
      multiSelectedIds,
      searchActive,
      indexById,
      childrenMap,
      collapsedParents,
      SLIDE_TYPES,
      renderSlideElement,
      getSlideCommentCount,
      getSlideLockInfo,
      isSlideLockedByOther,
      isSlideAuthorLocked,
      isAuthor,
      markDirty,
      rerenderSlideList,
      rerenderEditor,
      rerenderPreview,
      toggleCollapsed,
      getSearchQuery,
      // Drag state
      getDraggingSlideId: () => draggingSlideId,
      setDraggingSlideId: (id) => { draggingSlideId = id; },
      getDraggingSlideIds: () => draggingSlideIds,
      setDraggingSlideIds: (ids) => { draggingSlideIds = ids; },
      getDropTargetPos: () => dropTargetPos,
      dropTargetId,
      setDropIndicator,
      clearDropIndicators,
      clearDraggingVisuals,
      moveSlide,
      moveMultipleSlides,
      // Selection state
      getSelectedSlideId,
      setSelectedSlideId,
      getSelectedSlideIds,
      setSelectedSlideIds,
      clearMultiSelection,
      onMultiSelectionChange,
      editorState,
      onAfterSelectSlide,
      getLastClickedSlideId: () => lastClickedSlideId,
      setLastClickedSlideId: (id) => { lastClickedSlideId = id; },
    };

    // Main rendering loop - handle nested structure
    for (let idx = 0; idx < slides.length; idx += 1) {
      const s = slides[idx];
      const match = matches[idx]?.match || null;

      // Skip child slides in main loop - they're rendered after their parent
      if (isChildSlide(s) && !searchActive) {
        continue;
      }

      // Render the slide item
      const { item, originalIdx, isChild } = createSlideItem({
        h,
        slide: s,
        match,
        options: { isChild: false, isHidden: false },
        context: renderContext,
      });

      // Attach event handlers
      attachClickHandler({ item, slide: s, context: renderContext });
      attachDragHandlers({
        item,
        slide: s,
        originalIdx,
        isChild: false,
        context: renderContext,
      });

      slideListEl.append(item);

      // In search mode, show flat list
      if (searchActive) {
        continue;
      }

      // Insert row after this top-level slide
      slideListEl.append(insertRow(s.id));

      // If this is a parent slide, render its children
      const hasChildren = isParentSlide(s.id, childrenMap);
      if (hasChildren) {
        const isCollapsed = collapsedParents.has(s.id);
        const children = childrenMap.get(s.id) || [];

        for (const child of children) {
          const childMatch = matches.find((m) => m.slide.id === child.id)?.match || null;
          const childOriginalIdx = indexById.has(child.id) ? indexById.get(child.id) : 0;

          const { item: childItem } = createSlideItem({
            h,
            slide: child,
            match: childMatch,
            options: { isChild: true, isHidden: isCollapsed },
            context: renderContext,
          });

          // Attach event handlers to child
          attachClickHandler({ item: childItem, slide: child, context: renderContext });
          attachDragHandlers({
            item: childItem,
            slide: child,
            originalIdx: childOriginalIdx,
            isChild: true,
            context: renderContext,
          });

          slideListEl.append(childItem);

          // Insert row after each child (also hidden when collapsed)
          const childInsertRow = insertRow(child.id, { isChild: true, parentId: s.id });
          if (isCollapsed) childInsertRow.classList.add('is-hidden');
          slideListEl.append(childInsertRow);
        }
      }
    }

    return {
      total: allSlides.length,
      shown: slides.length,
      query: q,
      matchedIds,
    };
  };

  const updateSelectedSlideListItem = () => {
    const selectedSlideId = getSelectedSlideId?.();
    const slide = pres.slides.find((s) => s.id === selectedSlideId);
    if (!slide) return;
    const item = slideListEl.querySelector(`.list-item[data-slide-id="${selectedSlideId}"]`);
    if (!item) return;
    const fullTitle = slideLabel(slide, SLIDE_TYPES);

    // Update title text
    const titleEl = item.querySelector('.slide-title-line');
    if (titleEl) {
      titleEl.textContent = slidePrimaryLabel(slide, SLIDE_TYPES);
      titleEl.title = oneLine(fullTitle);
    }

    // Update the thumbnail preview
    const thumbEl = item.querySelector('.thumb.thumb-mini');
    if (thumbEl) {
      const oldSlideEl = thumbEl.querySelector('.slide');
      if (oldSlideEl) {
        try {
          const newSlideEl = renderSlideElement(slide, { mode: 'thumb', presentationId: pres?.id });
          oldSlideEl.replaceWith(newSlideEl);
        } catch {
          // ignore render errors
        }
      }
    }

    // Update the collapsed number tooltip
    const numCollapsed = item.querySelector('.slide-num-collapsed');
    if (numCollapsed) {
      numCollapsed.title = oneLine(fullTitle);
    }
  };

  const getSlidesForNav = () => {
    const q = normalizeQuery(getSearchQuery?.());
    const allSlides = pres?.slides || [];

    // In search mode, show all matching slides (flat list)
    if (q) {
      return allSlides.filter((s) => !!findFirstMatchInSlide(s, q));
    }

    // In normal mode, filter out hidden children (children of collapsed parents)
    const collapsed = getCollapsedState(pres?.id);
    return allSlides.filter((s) => {
      if (!s.parentId) return true;
      return !collapsed.has(s.parentId);
    });
  };

  const { selectSlideByIndex, detach: detachKeyNav } = attachSlideListKeyNavigation({
    slideListEl,
    pres,
    getSlides: () => getSlidesForNav(),
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
  });

  // Right-click a slide row for a quick actions menu (duplicate / delete /
  // visibility). Delegated on the list container so a single listener covers
  // every row, including ones added on re-render.
  const onContextMenu = (e) => {
    const itemEl = e.target?.closest?.('.slide-item');
    if (!itemEl || !slideListEl.contains(itemEl)) return;
    const slideId = itemEl.dataset.slideId;
    if (!slideId) return;
    const slide = (pres.slides || []).find((s) => s.id === slideId);
    if (!slide) return;
    e.preventDefault();

    // Act on the current multi-selection if the clicked row is part of it;
    // otherwise select just this row first, so the menu matches what's shown.
    const multi = getSelectedSlideIds?.() || new Set();
    let ids;
    if (multi.size > 0 && multi.has(slideId)) {
      ids = new Set(multi);
    } else {
      clearMultiSelection?.();
      setSelectedSlideId?.(slideId);
      onMultiSelectionChange?.();
      rerenderSlideList();
      ids = new Set([slideId]);
    }

    showSlideContextMenu({
      x: e.clientX,
      y: e.clientY,
      slide,
      ids,
      ctx: {
        pres,
        editorState,
        setSelectedSlideId,
        clearMultiSelection,
        markDirty,
        onMultiSelectionChange,
        rerenderSlideList,
        rerenderEditor,
        rerenderPreview,
        moveSlideToPosition,
      },
    });
  };
  slideListEl.addEventListener('contextmenu', onContextMenu);

  const detach = () => {
    detachKeyNav?.();
    slideListEl.removeEventListener('contextmenu', onContextMenu);
    closeSlideContextMenu();
  };

  return {
    rerenderSlideList,
    updateSelectedSlideListItem,
    selectSlideByIndex,
    detach,
    getSelectedSlideIds,
    clearMultiSelection,
  };
}
