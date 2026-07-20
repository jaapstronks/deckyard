/**
 * Slide List Drag & Drop Handlers
 * Handles drag & drop reordering of slides
 */

import { slidePrimaryLabel } from '../editor-utils.js';
import { t } from '../../../lib/ui-i18n.js';
import { makeDragGhost } from './drag-ghost.js';

/**
 * Attach drag & drop handlers to a slide item
 */
export function attachDragHandlers({
  item,
  slide,
  originalIdx,
  isChild,
  context,
}) {
  const {
    pres,
    SLIDE_TYPES,
    slideListEl,
    searchActive,
    getDraggingSlideId,
    setDraggingSlideId,
    getDraggingSlideIds,
    setDraggingSlideIds,
    getSelectedSlideIds,
    setDropIndicator,
    clearDropIndicators,
    clearDraggingVisuals,
    moveSlide,
    moveMultipleSlides,
  } = context;

  const s = slide;

  if (searchActive) return;

  // HTML5 drag-and-drop does not fire on touch, so `draggable` buys nothing
  // there — and it actively hurts: Chrome on Android starts a native drag on
  // long-press of a draggable element, which cancels the long-press that opens
  // the reorder menu (the only way to reorder on touch). Leave it off.
  const isTouch =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(hover: none)')?.matches;
  if (!isTouch) item.setAttribute('draggable', 'true');

  item.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', s.id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingSlideId(s.id);
    clearDraggingVisuals();
    item.classList.add('is-dragging');
    clearDropIndicators();

    // Check if this slide is part of a multi-selection
    const multiSelectedIds = getSelectedSlideIds?.() || new Set();
    let draggingIds;
    if (multiSelectedIds.has(s.id) && multiSelectedIds.size > 1) {
      // Dragging multiple slides - preserve order from pres.slides
      draggingIds = (pres.slides || [])
        .filter((slide) => multiSelectedIds.has(slide.id))
        .map((slide) => slide.id);
      // Mark all selected slides as dragging
      for (const id of draggingIds) {
        const el = slideListEl.querySelector(`.slide-item[data-slide-id="${id}"]`);
        el?.classList?.add('is-dragging');
      }
    } else {
      draggingIds = [s.id];
    }
    setDraggingSlideIds(draggingIds);

    // Use a custom drag image
    const dragCount = draggingIds.length;
    const ghost = makeDragGhost({
      num: dragCount > 1 ? dragCount : originalIdx + 1,
      title: dragCount > 1
        ? t('editor.slides.dragMultiple', '{n} slides', { n: dragCount })
        : slidePrimaryLabel(s, SLIDE_TYPES),
      typeLabel: dragCount > 1
        ? t('editor.slides.movingSlides', 'Moving')
        : t(
            SLIDE_TYPES[s.type]?.labelKey || `slideType.${s.type}.label`,
            SLIDE_TYPES[s.type]?.label || s.type
          ),
    });
    try {
      e.dataTransfer.setDragImage(ghost, 18, 18);
    } catch {
      // ignore
    }
    setTimeout(() => ghost.remove(), 0);
  });

  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const draggingSlideId = getDraggingSlideId();
    if (!draggingSlideId) return;

    // Don't show drop indicator on any of the slides being dragged
    const draggingSlideIds = getDraggingSlideIds();
    if (draggingSlideIds.includes(s.id)) {
      clearDropIndicators();
      return;
    }

    const r = item.getBoundingClientRect();
    const height = r.height;
    const relY = e.clientY - r.top;

    // Can only nest if target is not already a child (1-level limit)
    const canNest = !isChild && !s.parentId;

    let pos;
    // Vertical zones: top 25% = before, bottom 25% = after, center 50% = nest
    if (relY < height * 0.25) {
      pos = 'before';
    } else if (relY > height * 0.75) {
      pos = 'after';
    } else if (canNest) {
      pos = 'nest';
    } else {
      // Can't nest - use before/after based on which half
      pos = relY < height * 0.5 ? 'before' : 'after';
    }

    setDropIndicator(item, pos);
  });

  item.addEventListener('dragleave', (e) => {
    if (e.currentTarget?.contains?.(e.relatedTarget)) return;
    const { dropTargetId } = context;
    if (dropTargetId === item.dataset.slideId) clearDropIndicators();
  });

  item.addEventListener('drop', (e) => {
    e.preventDefault();
    const toId = s.id;
    const dropTargetPos = context.getDropTargetPos?.() || 'before';
    const pos = dropTargetPos;
    const makeChild = pos === 'nest';
    clearDropIndicators();

    // Handle multi-select or single slide move
    const draggingSlideIds = getDraggingSlideIds();
    if (draggingSlideIds.length > 1) {
      moveMultipleSlides({ slideIds: draggingSlideIds, toId, pos: makeChild ? 'after' : pos, makeChild });
    } else {
      const draggingSlideId = getDraggingSlideId();
      const fromId = e.dataTransfer.getData('text/plain') || draggingSlideId;
      moveSlide({ fromId, toId, pos: makeChild ? 'after' : pos, makeChild });
    }

    setDraggingSlideId(null);
    setDraggingSlideIds([]);
    clearDraggingVisuals();
  });

  item.addEventListener('dragend', () => {
    setDraggingSlideId(null);
    setDraggingSlideIds([]);
    clearDropIndicators();
    clearDraggingVisuals();
  });
}
