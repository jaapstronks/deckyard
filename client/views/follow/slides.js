export function slideByIdOrIndex(pres, { slideId } = {}) {
  const slides = Array.isArray(pres?.slides) ? pres.slides : [];
  const sid = String(slideId || '').trim();
  if (sid) {
    const idx = slides.findIndex((s) => s?.id === sid);
    if (idx >= 0) return { slide: slides[idx], idx };
    return { slide: null, idx: -1 };
  }
  // The server resolves legacy index-only state before filtering. Empty ids
  // mean the current presenter slide is unavailable to this audience.
  return { slide: null, idx: -1 };
}
