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
  let fired = false;

  const cancel = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  /**
   * Swallow the compatibility click the browser synthesizes on release.
   *
   * Whatever a long press opens (a menu, a popover) almost always closes
   * itself on the next document click, so without this the thing appears
   * under the finger and vanishes the moment it lifts. preventDefault on
   * touchend is the textbook fix but isn't dependable — the click can arrive
   * well after touchend on iOS, and some environments don't deliver touchend
   * to the page at all — so this catches the click itself, once.
   */
  const swallowNextClick = () => {
    const onClick = (e) => {
      // stopImmediatePropagation, not stopPropagation: the dismiss-on-outside-
      // click listeners we're guarding against are bound on document too, and
      // plain stopPropagation doesn't stop other listeners on the same node.
      e.stopImmediatePropagation();
      e.preventDefault();
      done();
    };
    const done = () => {
      clearTimeout(expiry);
      document.removeEventListener('click', onClick, true);
    };
    // Expire on its own, so a press that never produces a click doesn't leave
    // a listener armed to eat an unrelated one later.
    const expiry = setTimeout(done, 900);
    document.addEventListener('click', onClick, true);
  };

  const onTouchStart = (e) => {
    cancel();
    fired = false;
    if (e.touches?.length !== 1) return;
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    const target = e.target;
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      // Arm here rather than on touchend: the press has already succeeded, and
      // touchend is not guaranteed to reach us before the click does.
      swallowNextClick();
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

  // Not passive: preventDefault here suppresses the synthetic click outright
  // where touchend is delivered normally. swallowNextClick covers the rest.
  const onTouchEnd = (e) => {
    cancel();
    if (!fired) return;
    fired = false;
    e.preventDefault();
  };

  const onTouchCancel = () => {
    cancel();
    fired = false;
  };

  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchmove', onTouchMove, { passive: true });
  el.addEventListener('touchend', onTouchEnd, { passive: false });
  el.addEventListener('touchcancel', onTouchCancel, { passive: true });

  return () => {
    cancel();
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchmove', onTouchMove);
    el.removeEventListener('touchend', onTouchEnd);
    el.removeEventListener('touchcancel', onTouchCancel);
  };
}
