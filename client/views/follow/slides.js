export function slideByIdOrIndex(pres, { slideId, slideIndex } = {}) {
  const slides = Array.isArray(pres?.slides) ? pres.slides : [];
  const sid = String(slideId || '').trim();
  if (sid) {
    const idx = slides.findIndex((s) => s?.id === sid);
    if (idx >= 0) return { slide: slides[idx], idx };
  }
  const i = Math.max(
    0,
    Math.min(slides.length - 1, Number(slideIndex || 0) || 0)
  );
  return { slide: slides[i] || null, idx: i };
}
