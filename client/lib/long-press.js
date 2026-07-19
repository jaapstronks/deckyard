/**
 * Long-press as a touch stand-in for right-click.
 *
 * `contextmenu` is not a reliable long-press signal on touch: Android Chrome
 * fires it, but iOS Safari answers a long press with its own callout instead.
 * Anything reachable only by right-click is therefore unreachable on an
 * iPhone or iPad unless we detect the press ourselves.
 *
 * Listeners are passive and the press is cancelled by any real movement, so
 * scrolling a list never turns into a long press.
 *
 * @param {Element} el - element to listen on (delegation-friendly)
 * @param {object} [opts]
 * @param {(detail: {target: EventTarget, x: number, y: number}) => void} [opts.onLongPress]
 * @param {number} [opts.delay=500] - hold time in ms before it fires
 * @param {number} [opts.moveTolerance=10] - px of drift allowed while holding
 * @returns {() => void} detach function
 */
export function attachLongPress(
  el,
  { onLongPress, delay = 500, moveTolerance = 10 } = {}
) {
  if (!el) return () => {};

  let timer = null;
  let startX = 0;
  let startY = 0;

  const cancel = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const onTouchStart = (e) => {
    cancel();
    if (e.touches?.length !== 1) return;
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    const target = e.target;
    timer = setTimeout(() => {
      timer = null;
      onLongPress?.({ target, x: startX, y: startY });
    }, delay);
  };

  const onTouchMove = (e) => {
    if (timer === null) return;
    const t = e.touches?.[0];
    if (!t) return;
    if (
      Math.abs(t.clientX - startX) > moveTolerance ||
      Math.abs(t.clientY - startY) > moveTolerance
    ) {
      cancel();
    }
  };

  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchmove', onTouchMove, { passive: true });
  el.addEventListener('touchend', cancel, { passive: true });
  el.addEventListener('touchcancel', cancel, { passive: true });

  return () => {
    cancel();
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchmove', onTouchMove);
    el.removeEventListener('touchend', cancel);
    el.removeEventListener('touchcancel', cancel);
  };
}
