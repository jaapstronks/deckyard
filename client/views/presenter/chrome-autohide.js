/**
 * Auto-hiding presenter chrome (the top bar and the bottom progress bar) for
 * fullscreen.
 *
 * In windowed mode both bars sit in their own grid rows and are always
 * visible. In fullscreen those rows collapse (so the deck fills a true 16:9
 * with no pillarbox bars) and both bars become overlays that appear on pointer
 * or touch activity, fading away — together with the cursor — after a short
 * idle period. Standard video-player / Keynote behavior.
 *
 * Navigation keys do not reveal them: a presenter on a clicker would otherwise
 * see the bars flash on every slide (D111). Keyboard users still reach the
 * controls: focus moving into a bar (Tab) reveals it, and a bar stays up while
 * the pointer rests on it or focus is inside it.
 *
 * Fullscreen is whatever `html.is-fullscreen` says (set by fullscreen.js), so
 * the published page and the presenter share one signal. The CSS keys off
 * `.presenter-shell.is-chrome-active`; this controller only toggles that class
 * and manages the idle timer. No imports and a single export: the published
 * page inlines it through the script chain.
 *
 * @param {object} opts
 * @param {Element} opts.shell - The `.presenter-shell` element.
 * @param {number} [opts.idleMs=2600] - Idle time before chrome/cursor hide.
 * @returns {{ detach: () => void }}
 */
export function createChromeAutoHide({ shell, idleMs = 2600 } = {}) {
  if (!shell) return { detach() {} };

  const CHROME = '.presenter-topbar, .presenter-progress';
  const root = document.documentElement;
  const isFullscreen = () => root.classList.contains('is-fullscreen');

  let tid = null;
  let wasFullscreen = isFullscreen();
  // Where the last pointer move landed: a bar under the pointer stays up.
  let pointerInChrome = false;

  const clearTid = () => {
    if (tid) {
      clearTimeout(tid);
      tid = null;
    }
  };

  const reveal = () => shell.classList.add('is-chrome-active');
  const conceal = () => shell.classList.remove('is-chrome-active');

  const inChrome = (node) => !!(node && node.closest && node.closest(CHROME));
  // Keyboard focus only: a button clicked with the mouse keeps focus too, and
  // must not pin the bar up after the pointer has left it.
  const hasKeyboardFocus = () => {
    const el = document.activeElement;
    if (!inChrome(el)) return false;
    try {
      return el.matches(':focus-visible');
    } catch {
      return true;
    }
  };
  const isHeld = () => pointerInChrome || hasKeyboardFocus();

  const scheduleHide = () => {
    clearTid();
    tid = setTimeout(() => {
      tid = null;
      // Only auto-hide while fullscreen; windowed mode keeps chrome visible.
      if (!isFullscreen()) return;
      if (isHeld()) scheduleHide();
      else conceal();
    }, idleMs);
  };

  const onActivity = (e) => {
    pointerInChrome = e?.type === 'mousemove' && inChrome(e.target);
    if (!isFullscreen()) return;
    reveal();
    scheduleHide();
  };

  const onFocusIn = (e) => {
    if (!inChrome(e.target) || !isFullscreen()) return;
    reveal();
    scheduleHide();
  };

  const onFullscreenFlip = () => {
    const now = isFullscreen();
    if (now === wasFullscreen) return;
    wasFullscreen = now;
    clearTid();
    // Entering: start hidden, the next pointer move brings the bars back.
    // Leaving: the bars are grid rows again, keep them shown.
    if (now) conceal();
    else reveal();
  };

  const observer = new MutationObserver(onFullscreenFlip);
  observer.observe(root, { attributes: true, attributeFilter: ['class'] });

  document.addEventListener('mousemove', onActivity);
  document.addEventListener('touchstart', onActivity, { passive: true });
  shell.addEventListener('focusin', onFocusIn);

  if (wasFullscreen) conceal();
  else reveal();

  return {
    detach() {
      clearTid();
      observer.disconnect();
      document.removeEventListener('mousemove', onActivity);
      document.removeEventListener('touchstart', onActivity);
      shell.removeEventListener('focusin', onFocusIn);
    },
  };
}
