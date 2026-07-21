export function attachThumbScale(thumb, { virtualWidth = 1600 } = {}) {
  if (!thumb) return () => {};

  const update = () => {
    const w = thumb.clientWidth || 1;
    const scale = w / virtualWidth;
    thumb.style.setProperty('--thumb-scale', String(scale));
  };

  update();
  const ro = new ResizeObserver(() => update());
  ro.observe(thumb);
  return () => ro.disconnect();
}

// Like "object-fit: contain" but for slide thumbs (preserve aspect ratio while fitting
// within the available stage width+height).
//
// This is intentionally separate from attachThumbScale() because most thumbs in the app
// are width-driven by layout (lists/panels) and should not be height-constrained.
export function attachThumbScaleContain(
  thumb,
  {
    virtualWidth = 1600,
    virtualHeight = 900,
    containerEl = null,
    padding = 0,
  } = {}
) {
  if (!thumb) return () => {};

  const stage = containerEl || thumb.parentElement || thumb;

  const update = () => {
    const w = Math.max(1, (stage.clientWidth || 1) - padding * 2);
    const h = Math.max(1, (stage.clientHeight || 1) - padding * 2);
    const scale = Math.min(w / virtualWidth, h / virtualHeight);
    thumb.style.setProperty('--thumb-scale', String(scale));

    // Ensure the thumb itself matches the scaled slide size so it can be centered
    // and never overflows the stage.
    thumb.style.width = `${virtualWidth * scale}px`;
    thumb.style.height = `${virtualHeight * scale}px`;
  };

  update();
  const ro = new ResizeObserver(() => update());
  ro.observe(stage);
  // The stage often isn't measurable until after it's in the DOM.
  requestAnimationFrame(() => update());
  setTimeout(() => update(), 0);
  return () => ro.disconnect();
}
