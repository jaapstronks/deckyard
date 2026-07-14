export function attachSwipeNavigation(el, { onPrev, onNext } = {}) {
  let touchStartX = 0;
  let touchStartY = 0;

  const onTouchStart = (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    touchStartX = t.clientX;
    touchStartY = t.clientY;
  };

  const onTouchEnd = (e) => {
    const t = e.changedTouches?.[0];
    if (!t) return;
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    if (Math.abs(dx) < 60) return;
    if (Math.abs(dy) > 80) return;
    if (dx < 0) onNext?.();
    else onPrev?.();
  };

  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchend', onTouchEnd, { passive: true });

  return () => {
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchend', onTouchEnd);
  };
}
