export function createPresenterFullscreenController({ shell } = {}) {
  const syncFullscreenClass = () => {
    // Use a class as a reliable cross-browser hook for fullscreen styling.
    document.documentElement.classList.toggle(
      'is-fullscreen',
      !!document.fullscreenElement
    );
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

  return { syncFullscreenClass, toggleFullscreen };
}
