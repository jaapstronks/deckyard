import crypto from 'node:crypto';
import { SLIDE_TYPES } from '../../../shared/slide-schemas.js';
import { normalizeSlides } from './slides.js';
import {
  normalizeLang,
  normalizeTranslationLang,
  otherLang,
  isNonEmptyString,
  ALL_TRANSLATION_LANGS,
  KNOWN_LANGS,
} from '../../../shared/i18n-utils.js';

export { normalizeLang, normalizeTranslationLang, otherLang, isNonEmptyString, ALL_TRANSLATION_LANGS, KNOWN_LANGS };

/**
 * Presentation dominant/active languages (legacy two-language system).
 */
export const SUPPORTED_LANGS = ['nl', 'en-GB'];

/**
 * All supported translation target languages.
 * Includes all 12 i18n languages from client/i18n/manifest.json.
 */
export const TRANSLATION_LANGS = [
  'nl',     // Dutch
  'en-GB',  // British English
  'de',     // German
  'fr',     // French
  'es',     // Spanish
  'pt',     // Portuguese
  'it',     // Italian
  'pl',     // Polish
  'fi',     // Finnish
  'da',     // Danish
  'sv',     // Swedish
  'no',     // Norwegian
];

export function translateKeysForSlideType(type) {
  const def = SLIDE_TYPES?.[type];
  if (!def || !Array.isArray(def.fields)) return [];
  return def.fields
    .filter((f) => f && (f.type === 'string' || f.type === 'markdown'))
    .map((f) => f.key)
    .filter((k) => typeof k === 'string' && k.trim());
}

export function pickVersion(pres, lang) {
  const l = normalizeLang(lang);
  if (
    l &&
    pres?.i18n?.versions &&
    typeof pres.i18n.versions === 'object' &&
    pres.i18n.versions?.[l]
  ) {
    const v = pres.i18n.versions[l];
    return {
      title: typeof v?.title === 'string' ? v.title : '',
      slides: Array.isArray(v?.slides) ? v.slides : [],
    };
  }
  return {
    title: typeof pres?.title === 'string' ? pres.title : '',
    slides: Array.isArray(pres?.slides) ? pres.slides : [],
  };
}

function buildSlideIndex(slides) {
  const arr = Array.isArray(slides) ? slides : [];
  const byId = new Map();
  for (let i = 0; i < arr.length; i += 1) {
    const s = arr[i];
    if (s && typeof s === 'object' && typeof s.id === 'string' && s.id)
      byId.set(s.id, s);
  }
  return { arr, byId };
}

export function computeMissingCount({ source, target } = {}) {
  let count = 0;
  if (isNonEmptyString(source?.title) && !isNonEmptyString(target?.title))
    count += 1;

  const srcIdx = buildSlideIndex(source?.slides);
  const tgtIdx = buildSlideIndex(target?.slides);
  for (let i = 0; i < srcIdx.arr.length; i += 1) {
    const s = srcIdx.arr[i];
    if (!s || typeof s !== 'object') continue;
    const type = typeof s.type === 'string' ? s.type : '';
    const keys = translateKeysForSlideType(type);
    if (!keys.length) continue;

    const srcContent =
      s.content && typeof s.content === 'object' ? s.content : {};
    const t =
      (typeof s.id === 'string' && s.id && tgtIdx.byId.get(s.id)) ||
      tgtIdx.arr[i] ||
      null;
    const tgtContent =
      t?.content && typeof t.content === 'object' ? t.content : {};

    for (const k of keys) {
      const sv = srcContent[k];
      const tv = tgtContent[k];
      if (isNonEmptyString(sv) && !isNonEmptyString(tv)) count += 1;
    }
  }
  return count;
}

/**
 * Normalize existing follow-invite slides (update presentationId/sourceLang).
 * Does NOT auto-insert a slide if missing – users add it manually.
 */
export function normalizeFollowInviteSlides(slides, { presentationId, sourceLang } = {}) {
  const arr = Array.isArray(slides) ? slides : [];
  const presId = String(presentationId || '').trim();
  const src = normalizeLang(sourceLang) || 'nl';
  const target = otherLang(src);

  // Find all follow-invite slides and ensure their content is correct.
  for (const s of arr) {
    if (s?.type !== 'follow-invite-slide') continue;
    s.content = s.content && typeof s.content === 'object' ? s.content : {};
    s.content.presentationId = presId;
    s.content.sourceLang = src;
    s.content.targetLang = target;
    if (typeof s.content.enabled !== 'boolean') s.content.enabled = true;
  }
  return arr;
}

export function missingTranslationCount(fromVer, toVer) {
  const srcTitle = typeof fromVer?.title === 'string' ? fromVer.title : '';
  const tgtTitle = typeof toVer?.title === 'string' ? toVer.title : '';
  let missing = 0;
  if (srcTitle.trim() && !tgtTitle.trim()) missing += 1;

  const srcSlides = Array.isArray(fromVer?.slides) ? fromVer.slides : [];
  const tgtSlides = Array.isArray(toVer?.slides) ? toVer.slides : [];
  const tgtById = new Map(
    tgtSlides
      .filter((s) => s && typeof s === 'object' && typeof s.id === 'string')
      .map((s) => [s.id, s])
  );

  for (const src of srcSlides) {
    if (!src || typeof src !== 'object') continue;
    const srcId = typeof src.id === 'string' ? src.id : '';
    const tgt = srcId ? tgtById.get(srcId) : null;
    const srcContent =
      src?.content && typeof src.content === 'object' ? src.content : {};
    const tgtContent =
      tgt?.content && typeof tgt.content === 'object' ? tgt.content : {};
    const keys = translateKeysForSlideType(src?.type);
    for (const k of keys) {
      const a = srcContent?.[k];
      const b = tgtContent?.[k];
      if (typeof a === 'string' && a.trim()) {
        if (!(typeof b === 'string' && b.trim())) missing += 1;
      }
    }
  }

  return missing;
}

export function normalizeI18n(pres) {
  if (!pres || typeof pres !== 'object') return;
  const raw = pres.i18n;
  if (!raw || typeof raw !== 'object') return;

  const i18n = raw;
  const versionsIn =
    i18n.versions && typeof i18n.versions === 'object' ? i18n.versions : {};
  i18n.versions = versionsIn;

  const cleanLang = (v) => (v === 'nl' || v === 'en-GB' ? v : null);
  const dominant =
    cleanLang(i18n.dominant) ||
    (versionsIn.nl ? 'nl' : versionsIn['en-GB'] ? 'en-GB' : 'nl');
  const active = cleanLang(i18n.active) || null;

  i18n.dominant = dominant;
  if (active) i18n.active = active;

  // Keep a deck-level language hint for exports/public HTML.
  // Only set when missing/invalid so user overrides are respected.
  if (!normalizeLang(pres.lang)) pres.lang = dominant;

  // Ensure the active language (if present) gets updated from the top-level fields.
  // This lets the editor POST/PUT the "currently edited" language in pres.title/slides
  // while the server keeps top-level synced with the dominant language for compatibility.
  if (active) {
    i18n.versions[active] = {
      title: typeof pres.title === 'string' ? pres.title : '',
      slides: Array.isArray(pres.slides) ? pres.slides : [],
    };
  }

  // Update the dominant version from top-level slides when:
  // 1. active is not set (fallback/initial creation case)
  // 2. active === dominant (most common case, including AI wizard flow)
  // This ensures consistency when AI wizard creates a presentation (which sets up initial
  // i18n structure) and then immediately updates it with generated content.
  // We avoid overwriting the dominant version when actively editing a different language.
  if (!active || active === dominant) {
    i18n.versions[dominant] = {
      title: typeof pres.title === 'string' ? pres.title : '',
      slides: Array.isArray(pres.slides) ? pres.slides : [],
    };
  } else if (!i18n.versions[dominant]) {
    // Backfill dominant version if missing and we're editing a different language
    i18n.versions[dominant] = {
      title: typeof pres.title === 'string' ? pres.title : '',
      slides: Array.isArray(pres.slides) ? pres.slides : [],
    };
  }

  // Normalize all known language versions.
  for (const lang of SUPPORTED_LANGS) {
    const v = i18n.versions?.[lang];
    if (!v || typeof v !== 'object') continue;
    v.title = typeof v.title === 'string' ? v.title : '';
    v.slides = normalizeSlides(v.slides);
    // Normalize any existing follow-invite slides (update presentationId/sourceLang).
    v.slides = normalizeFollowInviteSlides(v.slides, {
      presentationId: pres.id,
      sourceLang: lang,
    });
  }

  // Track missing translation fields (computed, lightweight).
  // This is informational only and is recomputed whenever the presentation is saved/translated.
  try {
    const nowIso = new Date().toISOString();
    const nl = i18n.versions?.nl;
    const en = i18n.versions?.['en-GB'];
    const progress = {
      updatedAt: nowIso,
      missingNlToEnGb: nl && en ? missingTranslationCount(nl, en) : null,
      missingEnGbToNl: en && nl ? missingTranslationCount(en, nl) : null,
    };
    progress.hasIncomplete =
      (typeof progress.missingNlToEnGb === 'number' && progress.missingNlToEnGb > 0) ||
      (typeof progress.missingEnGbToNl === 'number' && progress.missingEnGbToNl > 0);
    i18n.progress = progress;
  } catch {
    // ignore
  }

  // Always keep top-level title/slides aligned to the dominant language version.
  const dv = i18n.versions[dominant];
  if (dv && typeof dv === 'object') {
    pres.title = typeof dv.title === 'string' ? dv.title : pres.title;
    pres.slides = Array.isArray(dv.slides) ? dv.slides : pres.slides;
  }
}

/**
 * Project a presentation to a specific language.
 * Returns a shallow copy of the presentation with title and slides from the
 * requested language version (falls back to dominant if not available).
 *
 * @param {Object} pres - The presentation object
 * @param {string} lang - Target language code (e.g., 'nl', 'en-GB')
 * @returns {Object} Presentation with title/slides projected to the target language
 */
export function projectPresentationToLang(pres, lang) {
  if (!pres || typeof pres !== 'object') return pres;

  const version = pickVersion(pres, lang);
  return {
    ...pres,
    title: version.title || pres.title,
    slides: version.slides || pres.slides,
    lang: normalizeLang(lang) || pres.lang,
  };
}
