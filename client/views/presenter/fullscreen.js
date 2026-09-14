/**
 * The one fullscreen contract for the in-app presenter, the audience window
 * and the published page (`/p/`), which inlines this module through the script
 * chain (server/utils/script-chain.js). No imports and a single export, so it
 * runs as a classic script there too.
 *
 * Fullscreen means the viewport fills the screen, by either route:
 *   - the Fullscreen API (`document.fullscreenElement`), e.g. the F key;
 *   - a window that covers the whole screen without that API — Safari's green
 *     button, F11 in Chrome on Windows/Linux — where `:fullscreen` never
 *     matches.
 * One detector turns both into one class, `html.is-fullscreen`; the CSS keys
 * on that class alone (D111).
 *
 * @param {object} [opts]
 * @param {Element} [opts.shell] - The `.presenter-shell`; fullscreened instead
 *   of `<html>` when the API route is taken.
 * @returns {{ attach: () => () => void, toggleFullscreen: () => void,
 *   isFullscreen: () => boolean }}
 */
export function createPresenterFullscreenController({ shell } = {}) {
  const isFullscreen = () => {
    if (document.fullscreenElement) return true;
    const scr = window.screen;
    if (!scr || !scr.width || !scr.height) return false;
    return window.innerWidth >= scr.width && window.innerHeight >= scr.height;
  };

  const syncFullscreenClass = () => {
    document.documentElement.classList.toggle('is-fullscreen', isFullscreen());
  };

  /**
   * Keep `html.is-fullscreen` in step with both signals.
   *
   * @returns {() => void} Detach: stops listening and drops the class.
   */
  const attach = () => {
    document.addEventListener('fullscreenchange', syncFullscreenClass);
    window.addEventListener('resize', syncFullscreenClass, { passive: true });
    syncFullscreenClass();
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenClass);
      window.removeEventListener('resize', syncFullscreenClass);
      document.documentElement.classList.remove('is-fullscreen');
    };
  };

  const toggleFullscreen = () => {
    // Prefer fullscreening the presenter container (more reliable than fullscreening <html> in some browsers).
    if (!document.fullscreenElement) {
      const p =
        (shell?.requestFullscreen && shell.requestFullscreen()) ||
        (document.documentElement.requestFullscreen &&
          document.documentElement.requestFullscreen());
      if (p?.catch) p.catch(() => {});
    } else {
      const p = document.exitFullscreen && document.exitFullscreen();
      if (p?.catch) p.catch(() => {});
    }
  };

  return { attach, toggleFullscreen, isFullscreen };
}
