export function createOverlayRegistry() {
  // Open overlays register a close() here so cleanup can safely close them.
  const openOverlayClosers = new Set();

  const closeAll = () => {
    for (const close of Array.from(openOverlayClosers)) {
      try {
        close();
      } catch {
        // ignore
      }
    }
    openOverlayClosers.clear();
  };

  return { openOverlayClosers, closeAll };
}
