import { normalizeSlides } from './slides.js';
import {
  computeMissingTranslation,
  pickVersion,
} from '../../utils/translation-status.js';
import {
  normalizeLang,
  normalizeTranslationLang,
  otherLang,
  TRANSLATION_LANGS,
  TRANSLATION_LANG_LABELS,
} from '../../../shared/i18n-utils.js';

/**
 * Server-side facade for the shared i18n vocabulary. `TRANSLATION_LANGS` and
 * `TRANSLATION_LANG_LABELS` are re-exported, not redefined — `shared/i18n-utils.js`
 * is the single source for the deck translation targets. `pickVersion` comes
 * from `server/utils/translation-status.js` for the same reason: this file
 * carried a byte-for-byte copy of it.
 */
export {
  normalizeLang,
  normalizeTranslationLang,
  otherLang,
  pickVersion,
  TRANSLATION_LANGS,
  TRANSLATION_LANG_LABELS,
};

/**
 * Presentation dominant/active languages (legacy two-language system).
 */
export const SUPPORTED_LANGS = ['nl', 'en-GB'];

/**
 * Normalize existing follow-invite slides: strip the per-version language keys
 * and default `enabled`.
 *
 * `presentationId` is *not* set here. It is an instance key the type declares
 * (`instanceKeys` in shared/slide-types/instance-keys.js), so `normalizeSlides`
 * derives it from that declaration one line up — this function no longer has to
 * know which content key of which type caches the deck id (A7.23).
 *
 * `sourceLang`/`targetLang` used to be written here, once per language version.
 * They were never authored: the value was always the language of the version
 * being written, which the render context already knows (`ctx.lang`). Storing a
 * copy only created a second place the truth could live, and therefore a way
 * for the two to disagree — the codec treats them as plain fields and would
 * happily let one version claim another's language.
 *
 * So they are derived at render now and **stripped** here. No migration script
 * is needed: this function runs on every save, so existing decks shed the keys
 * the first time they are written. See
 * docs/plans/briefs/collab-codec-per-language-fields.md.
 *
 * Does NOT auto-insert a slide if missing – users add it manually.
 */
function normalizeFollowInviteSlides(slides) {
  const arr = Array.isArray(slides) ? slides : [];

  // Find all follow-invite slides and ensure their content is correct.
  for (const s of arr) {
    if (s?.type !== 'follow-invite-slide') continue;
    s.content = s.content && typeof s.content === 'object' ? s.content : {};
    delete s.content.sourceLang;
    delete s.content.targetLang;
    if (typeof s.content.enabled !== 'boolean') s.content.enabled = true;
  }
  return arr;
}

/**
 * Deck-level translation-progress counter. Delegates to the one missing-scan
 * in `server/utils/translation-status.js`: this file used to carry two more
 * copies of the same walk (one of them dead, both top-level only), so a deck
 * whose only untranslated prose sat in `rows[].blocks[]` counted as complete.
 * @param {Object} fromVer - Source language version (`{title, slides}`)
 * @param {Object} toVer - Target language version
 * @returns {number}
 */
function missingTranslationCount(fromVer, toVer) {
  return computeMissingTranslation({ source: fromVer, target: toVer })
    .missingCount;
}

/**
 * Normalize a deck's i18n block in place: fill in the dominant version, keep
 * every language version's slides through the write seam, and recompute the
 * translation-progress counters.
 *
 * @param {object} pres - the deck being written
 * @param {object} [opts]
 * @param {Record<string, object>} [opts.slideTypes] - the organization's slide
 *   type registry, forwarded to `normalizeSlides` so a DB-backed custom type
 *   resolves in every language version too (B129). Omitted falls back to the
 *   process-wide registry.
 */
export function normalizeI18n(pres, { slideTypes } = {}) {
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
    // The write seam fills in each type's declared instance keys, which is
    // where the follow-invite slide's `presentationId` comes from.
    v.slides = normalizeSlides(v.slides, {
      presentationId: pres.id,
      slideTypes,
    });
    // Strip the stored per-version language keys — the version's own language
    // is the answer.
    v.slides = normalizeFollowInviteSlides(v.slides);
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
      (typeof progress.missingNlToEnGb === 'number' &&
        progress.missingNlToEnGb > 0) ||
      (typeof progress.missingEnGbToNl === 'number' &&
        progress.missingEnGbToNl > 0);
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
