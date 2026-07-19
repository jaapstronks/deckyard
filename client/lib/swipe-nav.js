/**
 * Horizontal swipe navigation for the slide-viewing surfaces.
 *
 * Deliberately conservative: a swipe only counts when it is clearly sideways,
 * so vertical scrolling (notes, comment lists) never steals a slide change.
 * Listeners are passive — we never call preventDefault, so native scrolling
 * and pinch-zoom keep working.
 *
 * @param {Element} el - element to listen on
 * @param {object} [opts]
 * @param {() => void} [opts.onPrev] - swipe right (towards the previous slide)
 * @param {() => void} [opts.onNext] - swipe left (towards the next slide)
 * @param {() => boolean} [opts.enabled] - checked at gesture end; return false
 *   to ignore the swipe (e.g. while the presenter is drawing on the slide).
 * @returns {() => void} detach function
 */
export function attachSwipeNavigation(el, { onPrev, onNext, enabled } = {}) {
  if (!el) return () => {};

  const MIN_DX = 60; // horizontal travel before a swipe registers
  const MAX_DY = 80; // beyond this it's a scroll, not a swipe

  /**
   * True when the gesture started inside something that scrolls sideways —
   * a wide table or a chart on the slide itself. Dragging those is scrolling,
   * not navigating, and must not also flip the slide.
   */
  const startedInHorizontalScroller = (target) => {
    let node = target && target.nodeType === 1 ? target : null;
    while (node && node !== el) {
      if (node.scrollWidth > node.clientWidth) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll') return true;
      }
      node = node.parentElement;
    }
    return false;
  };

  let touchStartX = 0;
  let touchStartY = 0;
  let tracking = false;

  const onTouchStart = (e) => {
    // Multi-touch is a pinch/zoom, not a navigation gesture. This also has to
    // cancel a gesture already in progress: the browser fires a one-touch
    // start before the second finger lands.
    if (e.touches?.length !== 1) {
      tracking = false;
      return;
    }
    if (startedInHorizontalScroller(e.target)) {
      tracking = false;
      return;
    }
    const t = e.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    tracking = true;
  };

  const onTouchEnd = (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches?.[0];
    if (!t) return;
    if (enabled && !enabled()) return;
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    if (Math.abs(dx) < MIN_DX) return;
    if (Math.abs(dy) > MAX_DY) return;
    if (dx < 0) onNext?.();
    else onPrev?.();
  };

  const onTouchCancel = () => {
    tracking = false;
  };

  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchend', onTouchEnd, { passive: true });
  el.addEventListener('touchcancel', onTouchCancel, { passive: true });

  return () => {
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchend', onTouchEnd);
    el.removeEventListener('touchcancel', onTouchCancel);
  };
}
