/**
 * Presenter unmount / teardown.
 *
 * Builds the cleanup function the SPA router calls when it swaps the presenter
 * view out (pushState navigation doesn't fire popstate, so this is the only
 * disposal hook). It stops the animator, tears down slide runtimes and video,
 * detaches every listener the view installed, and releases the session,
 * highlighter, auto-advance timer, console, projector channel and keep-alive.
 *
 * Lifted out of `renderPresenter` as a P4 seam (docs/plans/TODO.md B10). Pure
 * leaf: it only disposes handles built elsewhere, so the extraction is
 * behaviour-preserving. `shortcutsOverlay` is the one handle that changes after
 * this closure is built (the keyboard handler opens/closes it at runtime), so
 * it is read through a getter; every other handle is stable by the time the
 * view finishes mounting.
 */

/**
 * @param {object} handles
 * @returns {() => void} The unmount function.
 */
export function createPresenterTeardown({
  animator,
  stage,
  pauseVideoEmbeds,
  cleanupSlideRuntimes,
  detachKeys,
  detachSwipe,
  syncFullscreenClass,
  closeSessionEvents,
  toolsMenu,
  detachStageScale,
  chromeAutoHide,
  startCurtain,
  highlighter,
  autoAdvance,
  presenterConsole,
  handlePageHide,
  presentChannel,
  getShortcutsOverlay,
  videoLayer,
  edgeHintCtl,
  keepAliveTid,
}) {
  return () => {
    animator.cancel();
    try {
      const section =
        stage?.querySelector?.('.deck-slide.is-active') ||
        null;
      if (section) pauseVideoEmbeds(section);
    } catch {}
    cleanupSlideRuntimes(stage);
    try {
      stage.innerHTML = '';
    } catch {}
    try {
      detachKeys?.();
    } catch {}
    try {
      detachSwipe?.();
    } catch {}
    document.removeEventListener(
      'fullscreenchange',
      syncFullscreenClass
    );
    document.documentElement.classList.remove(
      'is-fullscreen'
    );
    if (typeof closeSessionEvents === 'function')
      closeSessionEvents();
    // Null the captured handle so a double unmount doesn't re-close the
    // session — mirrors the original inline teardown's guard.
    closeSessionEvents = null;
    toolsMenu.cleanup();
    try {
      detachStageScale?.();
    } catch {}
    try {
      chromeAutoHide?.destroy?.();
    } catch {}
    try {
      startCurtain?.dismiss?.();
    } catch {}
    try {
      highlighter?.destroy?.();
    } catch {}
    try {
      autoAdvance?.destroy?.();
    } catch {}
    try {
      presenterConsole?.destroy?.();
    } catch {}
    try {
      window.removeEventListener('pagehide', handlePageHide);
    } catch {}
    try {
      presentChannel.close();
    } catch {}
    try {
      getShortcutsOverlay()?.close?.();
    } catch {}
    videoLayer.destroy();
    edgeHintCtl.destroy();
    if (keepAliveTid) {
      try {
        clearInterval(keepAliveTid);
      } catch {}
      keepAliveTid = null;
    }
    if (document.fullscreenElement) {
      try {
        const p =
          document.exitFullscreen &&
          document.exitFullscreen();
        if (p?.catch) p.catch(() => {});
      } catch {}
    }
  };
}
