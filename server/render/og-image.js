import crypto from 'node:crypto';
import { filterForPublished } from '../utils/public-output.js';
import { getOgImageUrl } from '../config/branding.js';
import { SLIDE_TYPES } from '../../shared/slide-types.js';
import { firstPublicSlide } from '../utils/public-output.js';

function firstNonEmptyString(arr) {
  for (const v of arr || []) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export function pickOgImageUrlFromPresentation(pres, options) {
  const first = firstPublicSlide(pres, options);
  if (!first) return '';

  const type = String(first.type || '');
  const content =
    first.content && typeof first.content === 'object' ? first.content : {};
  const def = SLIDE_TYPES?.[type];

  // Heuristic: use the first image-like field (in schema order).
  if (def?.fields && Array.isArray(def.fields)) {
    for (const f of def.fields) {
      if (!f || typeof f !== 'object') continue;
      if (f.type === 'image' && typeof f.key === 'string') {
        const v = content[f.key];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      if (f.type === 'images' && typeof f.key === 'string') {
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
      if (s.startsWith('/uploads/') || s.startsWith('/assets/')) return s;
    }
    if (Array.isArray(v)) {
      const s = firstNonEmptyString(v);
      if (s.startsWith('/uploads/') || s.startsWith('/assets/')) return s;
    }
  }

  return '';
}

/** Versioned evidence for a rendered published preview, never an author snapshot. */
export function publishedPreviewFingerprint(pres) {
  const projected = filterForPublished(pres);
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        contract: 'published-preview-v2',
        slides: projected?.slides || [],
        versions: projected?.i18n?.versions || {},
        theme: pres?.theme,
        settings: pres?.settings?.ogPreview,
      }),
    )
    .digest('hex');
}

/** Legacy or changed snapshots fail closed; publishing again creates fresh proof. */
export function safePublishedOgImage(
  pres,
  storedUrl = pres?.published?.ogImageUrl,
) {
  if (
    storedUrl &&
    pres?.published?.ogImageUrl === storedUrl &&
    pres?.published?.previewFingerprint === publishedPreviewFingerprint(pres)
  ) {
    return storedUrl;
  }
  return getOgImageUrl();
}

/** Only filenames minted by the publication OG generator, never arbitrary uploads. */
export function isPublishedPreviewAssetName(name) {
  return /^og-(?:[a-f0-9]{8}|v2-[a-f0-9]{8}-[a-f0-9]{20})-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.png$/.test(
    name,
  );
}
