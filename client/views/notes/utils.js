export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function normalizeNotes(s) {
  if (s == null) return '';
  if (typeof s === 'string') return s;
  return String(s);
}

export function normalizePresentation(pres) {
  const slides = Array.isArray(pres?.slides) ? pres.slides : [];
  for (const s of slides) {
    if (!s || typeof s !== 'object') continue;
    if (typeof s.notes !== 'string') s.notes = '';
  }
  return pres;
}
