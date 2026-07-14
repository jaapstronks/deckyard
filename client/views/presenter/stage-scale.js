export function attachStageScale(
  stageWrap,
  stage,
  { baseW = 1600, baseH = 900 } = {}
) {
  if (!stageWrap || !stage) return () => {};

  const updateStageScale = () => {
    const w = stageWrap.clientWidth || 1;
    const h = stageWrap.clientHeight || 1;
    const scale = Math.max(0.05, Math.min(w / baseW, h / baseH));
    const sw = baseW * scale;
    const sh = baseH * scale;
    const left = Math.max(0, (w - sw) / 2);
    const top = Math.max(0, (h - sh) / 2);
    stage.style.left = `${left}px`;
    stage.style.top = `${top}px`;
    stage.style.transform = `scale(${scale})`;
  };

  updateStageScale();

  let ro = null;
  const onResize = () => updateStageScale();
  try {
    ro = new ResizeObserver(() => updateStageScale());
    ro.observe(stageWrap);
  } catch {
    window.addEventListener('resize', onResize, { passive: true });
  }

  return () => {
    if (ro) {
      try {
        ro.disconnect();
      } catch {}
      ro = null;
      return;
    }
    try {
      window.removeEventListener('resize', onResize);
    } catch {}
  };
}
