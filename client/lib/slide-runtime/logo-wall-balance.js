/**
 * Optical balance for logo walls: hand each logo's intrinsic aspect ratio to
 * the CSS as `--lw-aspect`, which sizes every logo to the same area
 * (46-logo-wall.css). A square mark and an 8:1 wordmark in one frame shape
 * otherwise differ threefold in area; the ratio is the one thing CSS cannot
 * read off an image, so this pass reads it and does nothing else.
 *
 * Without it (not yet loaded, no script) the frame's own caps apply, which is
 * the layout the wall had before. The script chain inlines this module into
 * export documents, so it must keep no imports and exactly one export.
 */

const SELECTOR = '.slide-logo-wall .logo-wall-img';

const setAspect = (img) => {
  if (!img.naturalWidth || !img.naturalHeight) return;
  img.style.setProperty(
    '--lw-aspect',
    String(img.naturalWidth / img.naturalHeight),
  );
};

/**
 * Mark every logo under `rootEl` with its aspect ratio, now or once it loads.
 *
 * @param {Element|Document|null} rootEl
 * @returns {() => void} detach: drops the load listeners still waiting.
 */
export function initLogoWallBalance(rootEl) {
  if (!rootEl) return () => {};
  const imgs = Array.from(rootEl.querySelectorAll?.(SELECTOR) || []);
  const waiting = [];
  for (const img of imgs) {
    if (img.complete && img.naturalWidth) {
      setAspect(img);
      continue;
    }
    const onLoad = () => setAspect(img);
    img.addEventListener('load', onLoad);
    waiting.push({ img, onLoad });
  }
  return () => {
    for (const { img, onLoad } of waiting) {
      img.removeEventListener('load', onLoad);
    }
    waiting.length = 0;
  };
}
