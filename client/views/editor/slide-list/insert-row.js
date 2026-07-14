export function createInsertRow({
  h,
  afterSlideId,
  parentId = null,
  onRequestInsert,
  getDraggingSlideId,
  setDraggingSlideId,
  getDraggingSlideIds,
  setDropIndicator,
  clearDropIndicators,
  moveSlide,
  moveMultipleSlides,
} = {}) {
  const wrap = h('div', { class: 'slide-insert' });
  const btn = h('button', {
    class: 'btn btn-secondary slide-insert-btn',
    text: '+',
    title:
      afterSlideId == null
        ? 'Slide invoegen aan het begin'
        : parentId
          ? 'Nested slide invoegen'
          : 'Slide invoegen tussen slides',
    onclick: (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      onRequestInsert?.({ afterSlideId, parentId });
    },
  });

  // Keep Tab order sane (big decks would be painful to tab through);
  // we will focus this via arrow-key navigation.
  btn.tabIndex = -1;
  btn.dataset.afterSlideId = afterSlideId == null ? '' : String(afterSlideId);
  btn.addEventListener('focus', () => {
    wrap.classList.add('is-kb-active');
  });
  btn.addEventListener('blur', () => {
    wrap.classList.remove('is-kb-active');
  });
  wrap.append(btn);

  // Drag-over UX: allow drop indicators even when hovering the "+" insert button.
  // Top half => line above the "+" (after the previous slide)
  // Bottom half => line below the "+" (before the next slide)
  const getNeighborTargets = () => {
    const prevItem = wrap.previousElementSibling?.classList?.contains?.(
      'slide-item'
    )
      ? wrap.previousElementSibling
      : null;
    const nextItem = wrap.nextElementSibling?.classList?.contains?.('slide-item')
      ? wrap.nextElementSibling
      : null;
    return { prevItem, nextItem };
  };

  const setIndicatorFromPointer = (e) => {
    if (!getDraggingSlideId?.()) return;
    const { prevItem, nextItem } = getNeighborTargets();
    const r = wrap.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    const y = e?.clientY ?? mid;

    // Start gap: only "before next"
    if (!prevItem && nextItem) {
      setDropIndicator?.(nextItem, 'before');
      return;
    }
    // End gap: only "after prev"
    if (prevItem && !nextItem) {
      setDropIndicator?.(prevItem, 'after');
      return;
    }
    // Middle gap: choose based on pointer position within the insert row
    if (prevItem && nextItem) {
      if (y < mid) setDropIndicator?.(prevItem, 'after');
      else setDropIndicator?.(nextItem, 'before');
    }
  };

  const onDragOver = (e) => {
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = 'move';
    } catch {
      // ignore
    }
    setIndicatorFromPointer(e);
  };

  const onDragLeave = (e) => {
    if (e.currentTarget?.contains?.(e.relatedTarget)) return;
    // Don't aggressively clear; leaving the insert row often means entering a neighbor slide.
  };

  const onDrop = (e) => {
    e.preventDefault();
    const draggingIds = getDraggingSlideIds?.() || [];
    const fromId = e.dataTransfer?.getData?.('text/plain') || getDraggingSlideId?.();
    const { prevItem, nextItem } = getNeighborTargets();
    const r = wrap.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    const y = e?.clientY ?? mid;

    let toId = null;
    let pos = 'before';
    if (!prevItem && nextItem) {
      toId = nextItem.dataset.slideId;
      pos = 'before';
    } else if (prevItem && !nextItem) {
      toId = prevItem.dataset.slideId;
      pos = 'after';
    } else if (prevItem && nextItem) {
      if (y < mid) {
        toId = prevItem.dataset.slideId;
        pos = 'after';
      } else {
        toId = nextItem.dataset.slideId;
        pos = 'before';
      }
    }

    clearDropIndicators?.();
    setDraggingSlideId?.(null);
    if (!toId) return;

    // Handle multi-select or single slide move
    if (draggingIds.length > 1) {
      moveMultipleSlides?.({ slideIds: draggingIds, toId, pos });
    } else if (fromId) {
      moveSlide?.({ fromId, toId, pos });
    }
  };

  // Attach to both the wrapper and the button, since drag events may target the button directly.
  wrap.addEventListener('dragover', onDragOver);
  wrap.addEventListener('dragleave', onDragLeave);
  wrap.addEventListener('drop', onDrop);
  btn.addEventListener('dragover', onDragOver);
  btn.addEventListener('dragleave', onDragLeave);
  btn.addEventListener('drop', onDrop);

  return wrap;
}
