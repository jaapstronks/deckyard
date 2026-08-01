/**
 * Pointer-based vertical list reordering (no HTML5 drag-and-drop).
 *
 * The dragged item follows the cursor; the other items make room by sliding
 * out of the way (FLIP-style transform animation). Pointer events cover
 * mouse, touch and pen with one code path — the handle carries
 * `touch-action: none` in CSS so the browser hands us vertical drags instead
 * of scrolling. Vanilla, no dependency; shared by every collection editor.
 *
 * Attach once per rendered list. The instance delegates from the container,
 * so re-rendering the container's children does not require re-attaching —
 * but a full re-render mid-drag is not supported (the editors commit and
 * re-render only on drop, which is exactly that contract).
 *
 * Nested lists: a handle belongs to the *innermost* container. Delegation
 * ignores events whose closest matching container is not this instance's,
 * so a row-level sortable never reacts to a block-level handle inside it.
 *
 * Keyboard: the handle is a real <button>; ArrowUp/ArrowDown move the item
 * one slot, which the HTML5 implementation this replaces never offered.
 *
 * @param {Object} o
 * @param {HTMLElement} o.container - the list element holding the items
 * @param {string} o.itemSelector - selector for the reorderable items
 *   (direct children of the container)
 * @param {string} o.handleSelector - selector for the drag handle inside an item
 * @param {(fromIndex: number, toIndex: number) => void} o.onReorder - commit
 *   callback with 0-based indices; called once per completed gesture with the
 *   final resting slot. `toIndex` is the index the item ends up at after the
 *   move (splice semantics: remove at from, insert at to).
 * @returns {{ detach: () => void }}
 */
export function attachPointerSortable({
  container,
  itemSelector,
  handleSelector,
  onReorder,
} = {}) {
  if (!container) return { detach: () => {} };

  /** Pixels of movement before a press becomes a drag (vs. a click). */
  const DRAG_THRESHOLD = 4;
  /** Edge zone (px) of the scroll parent that triggers auto-scroll. */
  const SCROLL_ZONE = 48;
  /** Max auto-scroll speed in px per frame. */
  const SCROLL_SPEED = 14;

  let drag = null; // active gesture state

  // Items are the container's DIRECT children matching the selector. A nested
  // sortable's items are children of the inner container, so the two levels
  // can share one item class without stealing each other's elements.
  const items = () =>
    Array.from(container.children).filter((el) => el.matches?.(itemSelector));

  const ownsItem = (el) => el.parentElement === container;

  /** Nearest scrollable ancestor, for auto-scroll near the edges. */
  const scrollParentOf = (el) => {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const s = getComputedStyle(node);
      if (/(auto|scroll)/.test(s.overflowY) && node.scrollHeight > node.clientHeight) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  };

  const onPointerDown = (e) => {
    if (drag) return;
    if (e.button != null && e.button !== 0) return;
    const handle = e.target?.closest?.(handleSelector);
    if (!handle || !container.contains(handle)) return;
    const item = handle.closest(itemSelector);
    if (!item || !ownsItem(item)) return;
    // A handle inside a nested sortable belongs to the inner container.
    const innerContainer = handle.closest('[data-pointer-sortable]');
    if (innerContainer && innerContainer !== container) return;

    const list = items();
    const fromIndex = list.indexOf(item);
    if (fromIndex < 0) return;

    e.preventDefault();
    drag = {
      handle,
      item,
      list,
      fromIndex,
      toIndex: fromIndex,
      startY: e.clientY,
      lastY: e.clientY,
      active: false,
      pointerId: e.pointerId,
      scrollParent: scrollParentOf(container),
      startScrollTop: 0,
      rafId: 0,
      // Item geometry, captured before any transforms are applied.
      itemHeight: item.getBoundingClientRect().height,
      slots: list.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, mid: r.top + r.height / 2, height: r.height };
      }),
      gap: 0,
    };
    if (drag.list.length > 1) {
      // Row gap = distance between consecutive item tops minus item height.
      drag.gap = Math.max(
        0,
        drag.slots[1].top - drag.slots[0].top - drag.slots[0].height
      );
    }
    if (drag.scrollParent) drag.startScrollTop = drag.scrollParent.scrollTop;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }
    window.addEventListener('keydown', onKeyCancel, true);
  };

  const beginDrag = () => {
    drag.active = true;
    container.classList.add('is-sorting');
    drag.item.classList.add('is-sort-dragging');
  };

  /**
   * Where the dragged item would land, from the pointer's travel: walk the
   * captured slot midpoints and count how many the dragged item's center has
   * crossed. Uses the *original* geometry (slots never move), which keeps the
   * math stable while neighbours animate.
   */
  const targetIndexFor = (dy) => {
    const { slots, fromIndex } = drag;
    const center = slots[fromIndex].mid + dy;
    let to = fromIndex;
    if (dy < 0) {
      while (to > 0 && center < slots[to - 1].mid) to -= 1;
    } else {
      while (to < slots.length - 1 && center > slots[to + 1].mid) to += 1;
    }
    return to;
  };

  /** Apply transforms: dragged item follows the pointer, neighbours make room. */
  const layout = () => {
    drag.rafId = 0;
    const scrollDelta = drag.scrollParent
      ? drag.scrollParent.scrollTop - drag.startScrollTop
      : 0;
    const dy = drag.lastY - drag.startY + scrollDelta;
    const to = targetIndexFor(dy);
    drag.toIndex = to;
    const shift = drag.itemHeight + drag.gap;
    for (let i = 0; i < drag.list.length; i += 1) {
      const el = drag.list[i];
      if (i === drag.fromIndex) {
        el.style.transform = `translate3d(0, ${dy}px, 0)`;
        continue;
      }
      let offset = 0;
      if (drag.fromIndex < i && i <= to) offset = -shift;
      else if (to <= i && i < drag.fromIndex) offset = shift;
      el.style.transform = offset ? `translate3d(0, ${offset}px, 0)` : '';
    }
  };

  const scheduleLayout = () => {
    if (!drag || drag.rafId) return;
    drag.rafId = requestAnimationFrame(layout);
  };

  const autoScroll = () => {
    const sp = drag.scrollParent;
    if (!sp) return;
    const rect = sp.getBoundingClientRect();
    let speed = 0;
    if (drag.lastY < rect.top + SCROLL_ZONE) {
      speed = -Math.ceil(((rect.top + SCROLL_ZONE - drag.lastY) / SCROLL_ZONE) * SCROLL_SPEED);
    } else if (drag.lastY > rect.bottom - SCROLL_ZONE) {
      speed = Math.ceil(((drag.lastY - (rect.bottom - SCROLL_ZONE)) / SCROLL_ZONE) * SCROLL_SPEED);
    }
    if (speed) {
      sp.scrollTop += speed;
      scheduleLayout();
    }
  };

  const onPointerMove = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.lastY = e.clientY;
    if (!drag.active) {
      if (Math.abs(e.clientY - drag.startY) < DRAG_THRESHOLD) return;
      beginDrag();
    }
    e.preventDefault();
    autoScroll();
    scheduleLayout();
  };

  const finishDrag = (commit) => {
    if (!drag) return;
    const { item, list, fromIndex, toIndex, active, rafId } = drag;
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', onKeyCancel, true);
    container.classList.remove('is-sorting');
    item.classList.remove('is-sort-dragging');
    for (const el of list) el.style.transform = '';
    const moved = commit && active && toIndex !== fromIndex;
    drag = null;
    if (moved) onReorder?.(fromIndex, toIndex);
  };

  const onPointerUp = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    finishDrag(true);
  };

  const onPointerCancel = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    finishDrag(false);
  };

  /** Escape aborts the gesture and puts everything back. */
  const onKeyCancel = (e) => {
    if (e.key === 'Escape' && drag) {
      e.stopPropagation();
      finishDrag(false);
    }
  };

  /** ArrowUp/ArrowDown on the handle move the item one slot (a11y path). */
  const onKeyDown = (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const handle = e.target?.closest?.(handleSelector);
    if (!handle || !container.contains(handle)) return;
    const item = handle.closest(itemSelector);
    if (!item || !ownsItem(item)) return;
    const innerContainer = handle.closest('[data-pointer-sortable]');
    if (innerContainer && innerContainer !== container) return;
    const list = items();
    const from = list.indexOf(item);
    const to = e.key === 'ArrowUp' ? from - 1 : from + 1;
    if (from < 0 || to < 0 || to >= list.length) return;
    e.preventDefault();
    onReorder?.(from, to);
  };

  // Mark the container so nested instances can tell whose handle is whose.
  container.setAttribute('data-pointer-sortable', '');
  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerCancel);
  container.addEventListener('keydown', onKeyDown);

  return {
    detach: () => {
      finishDrag(false);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerCancel);
      container.removeEventListener('keydown', onKeyDown);
      container.removeAttribute('data-pointer-sortable');
    },
  };
}
