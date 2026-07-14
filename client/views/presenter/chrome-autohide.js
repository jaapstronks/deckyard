/**
 * Auto-hiding presenter chrome (the bottom progress bar) for fullscreen.
 *
 * In windowed mode the progress bar sits in its own grid row and is always
 * visible. In fullscreen that row is collapsed (so the deck fills a true 16:9
 * with no pillarbox bars) and the bar becomes a bottom overlay that only shows
 * on pointer/keyboard activity, fading away — together with the cursor — after
 * a short idle period. Standard video-player / Keynote behavior.
 *
 * The CSS keys off `.presenter-shell.is-chrome-active`; this controller only
 * toggles that class and manages the idle timer.
 *
 * @param {object} opts
 * @param {Element} opts.shell - The `.presenter-shell` element.
 * @param {number} [opts.idleMs=2600] - Idle time before chrome/cursor hide.
 * @returns {{ destroy: () => void }}
 */
export function createChromeAutoHide({ shell, idleMs = 2600 } = {}) {
  if (!shell) return { destroy() {} };

  let tid = null;
  const isFullscreen = () => !!document.fullscreenElement;

  const clearTid = () => {
    if (tid) {
      try {
        clearTimeout(tid);
      } catch {}
      tid = null;
    }
  };

  const reveal = () => shell.classList.add('is-chrome-active');
  const conceal = () => shell.classList.remove('is-chrome-active');

  const scheduleHide = () => {
    clearTid();
    tid = setTimeout(() => {
      // Only auto-hide while fullscreen; windowed mode keeps chrome visible.
      if (isFullscreen()) conceal();
      tid = null;
    }, idleMs);
  };

  const onActivity = () => {
    if (!isFullscreen()) return;
    reveal();
    scheduleHide();
  };

  const onFullscreenChange = () => {
    if (isFullscreen()) {
      // Entering fullscreen: show once, then arm the idle timer.
      reveal();
      scheduleHide();
    } else {
      // Back to windowed: chrome is grid-flow again, keep it shown.
      clearTid();
      reveal();
    }
  };

  document.addEventListener('mousemove', onActivity);
  document.addEventListener('keydown', onActivity);
  document.addEventListener('touchstart', onActivity, { passive: true });
  document.addEventListener('fullscreenchange', onFullscreenChange);

  // Start visible (windowed default).
  reveal();

  return {
    destroy() {
      clearTid();
      document.removeEventListener('mousemove', onActivity);
      document.removeEventListener('keydown', onActivity);
      document.removeEventListener('touchstart', onActivity);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    },
  };
}
