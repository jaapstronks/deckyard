/**
 * Writing a loaded deck back without losing a language version (B620).
 *
 * The write seam (`normalizeI18n`) takes top-level `title`/`slides` as the
 * buffer of `i18n.active`, then projects the dominant version back to the top
 * level. The editor writes that way: its top level is the version on screen.
 * A loaded deck does not: its top level carries the dominant version. Writing
 * one back whole while `active` names another language would put the dominant
 * text in `versions[active]`. Every service that writes a deck's language
 * buffers goes through {@link alignToActiveVersion} first; aligning in the
 * seam itself is rejected, because the seam cannot tell an editor save from a
 * loaded deck (D320 (6)).
 *
 * @module server/services/deck-versions
 */

import {
  DEFAULT_DECK_LANG,
  normalizeLang,
  TRANSLATION_LANGS,
} from '../../shared/i18n-utils.js';

/**
 * A write body with its top-level `title`/`slides` set to the active
 * version's buffer, so the seam writes that version back as it is. A body
 * without an active language, or whose active language has no version yet,
 * is returned as it came: the seam then reads its top level as the dominant
 * buffer, which is what a loaded deck carries.
 *
 * @param {Object} body - A write body whose `i18n.versions` are authoritative.
 * @returns {Object} The body to hand to `updatePresentation`.
 */
export function alignToActiveVersion(body) {
  const active = normalizeLang(body?.i18n?.active);
  const version = active ? body.i18n.versions?.[active] : null;
  if (!version) return body;
  return {
    ...body,
    title: typeof version.title === 'string' ? version.title : '',
    slides: Array.isArray(version.slides) ? version.slides : [],
  };
}

/**
 * An i18n block with every language version's slides passed through
 * `mapSlides`, for a change that holds per slide id in every language (a
 * theme switch's conversions, B623). The block is copied, not changed; a
 * block without versions comes back as it was.
 *
 * @param {Object|null|undefined} i18n - A deck's or a write body's `i18n`.
 * @param {(slides: Array, lang: string) => Array} mapSlides - Answers the
 *   new slides of the version in `lang`.
 * @returns {Object|null|undefined} The i18n block with mapped versions.
 */
export function mapVersionSlides(i18n, mapSlides) {
  if (!i18n?.versions || typeof i18n.versions !== 'object') return i18n;
  const versions = {};
  for (const [lang, version] of Object.entries(i18n.versions)) {
    versions[lang] = Array.isArray(version?.slides)
      ? { ...version, slides: mapSlides(version.slides, lang) }
      : version;
  }
  return { ...i18n, versions };
}

/**
 * The write body for a new dominant slide buffer on a loaded deck: the
 * dominant version gets `slides`, every other version and deck column stays
 * as stored.
 *
 * @param {Object} pres - The deck as loaded (top level = dominant version).
 * @param {Array} slides - The new dominant slides.
 * @returns {Object} A partial write body (`slides`, plus `id`, `title` and
 *   `i18n` on a deck that carries versions).
 */
export function dominantSlidesBody(pres, slides) {
  const i18n = pres.i18n;
  if (!i18n?.versions || Object.keys(i18n.versions).length === 0)
    return { slides };
  const dominant =
    normalizeLang(i18n.dominant) ||
    normalizeLang(i18n.active) ||
    TRANSLATION_LANGS.find((lang) => i18n.versions[lang]) ||
    DEFAULT_DECK_LANG;
  const copy = structuredClone(i18n);
  copy.versions[dominant] = {
    ...(copy.versions[dominant] || {}),
    title: pres.title,
    slides,
  };
  return alignToActiveVersion({
    id: pres.id,
    title: pres.title,
    slides,
    i18n: copy,
  });
}
