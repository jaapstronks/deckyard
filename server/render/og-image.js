import { SLIDE_TYPES } from '../../shared/slide-types.js';

function firstNonEmptyString(arr) {
  for (const v of arr || []) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export function pickOgImageUrlFromPresentation(pres) {
  const slides = Array.isArray(pres?.slides) ? pres.slides : [];
  const first = slides.find((s) => s?.type !== 'follow-invite-slide') || null;
  if (!first || typeof first !== 'object') return '';

  const type = String(first.type || '');
  const content =
    first.content && typeof first.content === 'object'
      ? first.content
      : {};
  const def = SLIDE_TYPES?.[type];

  // Heuristic: use the first image-like field (in schema order).
  if (def?.fields && Array.isArray(def.fields)) {
    for (const f of def.fields) {
      if (!f || typeof f !== 'object') continue;
      if (f.type === 'image' && typeof f.key === 'string') {
        const v = content[f.key];
        if (typeof v === 'string' && v.trim())
          return v.trim();
      }
      if (
        f.type === 'images' &&
        typeof f.key === 'string'
      ) {
        const v = content[f.key];
        if (Array.isArray(v)) {
          const s = firstNonEmptyString(v);
          if (s) return s;
        }
      }
    }
  }

  // Fallback: scan for any string that looks like an asset/upload URL.
  for (const v of Object.values(content)) {
    if (typeof v === 'string' && v.trim()) {
      const s = v.trim();
      if (
        s.startsWith('/uploads/') ||
        s.startsWith('/assets/')
      )
        return s;
    }
    if (Array.isArray(v)) {
      const s = firstNonEmptyString(v);
      if (
        s.startsWith('/uploads/') ||
        s.startsWith('/assets/')
      )
        return s;
    }
  }

  return '';
}
