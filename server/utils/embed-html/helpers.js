// Re-export from shared helpers for backwards compatibility
export { escapeHtml } from '../../../shared/slide-types/helpers.js';

export function detectLang(pres) {
  const slides = Array.isArray(pres?.slides) ? pres.slides : [];
  for (const s of slides) {
    const lang = s?.content?.lang;
    if (lang === 'en') return 'en';
    if (lang === 'nl') return 'nl';
  }
  return 'nl';
}

export function slideA11yLabel(slide, idx, total) {
  const n = Number(idx || 0) + 1;
  const t = Math.max(0, Number(total || 0) || 0);
  const type = String(slide?.type || '');
  const c = slide?.content && typeof slide.content === 'object' ? slide.content : {};
  const titleKeys = ['title', 'authorName', 'label'];
  let title = '';
  for (const k of titleKeys) {
    if (typeof c?.[k] === 'string' && c[k].trim()) {
      title = c[k].trim();
      break;
    }
  }
  if (!title && typeof c?.caption === 'string' && c.caption.trim())
    title = c.caption.trim();
  if (!title && type === 'payoff-slide') title = 'Payoff';
  const prefix = t ? `Slide ${n} of ${t}` : `Slide ${n}`;
  return title ? `${prefix}: ${title}` : prefix;
}

export function parseBoolParam(v, fallback) {
  if (v == null) return fallback;
  const s = String(v).trim();
  if (s === '1' || s.toLowerCase() === 'true') return true;
  if (s === '0' || s.toLowerCase() === 'false') return false;
  return fallback;
}

export function parseUiParam(v, fallback = 'default') {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'min') return 'min';
  if (s === 'default') return 'default';
  return fallback;
}

export function parseAllowedOriginsParam(v) {
  const raw = String(v || '').trim();
  if (!raw) return [];
  if (raw === '*') return ['*'];
  // URLSearchParams already decodes, so a comma-separated list is safe.
  const parts = raw
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return parts;
}
