/**
 * The legacy `bgImage`/`bgAlt` pair: single read/fold authority, all types.
 *
 * Slide types historically carried their own `bgImage`/`bgAlt` fields, drawn as
 * a bespoke `<img class="slide-bg">` with a `.has-bg` readability treatment
 * (dark gradient + forced light text) and their own inspector picker. That is a
 * full-slide background — exactly what the generic, type-agnostic
 * `slideBgImage` layer (`injectSlideBackground` in presentation.js, with
 * fit/focus/overlay/auto-contrast) already provides for every type. Two systems
 * meant two "Background image" controls in the inspector and two images at
 * once on the slide.
 *
 * Canonical key is `slideBgImage`, and it is the only one anything reads. The
 * read funnel folds the pair once (schema v21 -> v22, `foldLegacyBgImage` in
 * schema-version.js, B257 B1-bg); before that a read-only render fallback drew
 * it and the editor folded it on edit. `bgAlt` is dropped on migration: a
 * full-slide background is decorative (the heading carries the meaning), so
 * the generic `aria-hidden` layer is the correct treatment.
 *
 * This module used to live at `types/title-slide/background.js` and the fold
 * ran for `title-slide` only. The pair is a CONTENT legacy, not a title-slide
 * one — any type could declare it, and the doc taught forks to (the CIIIC fork
 * type shipped `bgImage` + `bgAlt` and so rendered both controls side by side).
 * So the authority sits with the other shared slide-content helpers and the
 * fold is type-agnostic: one legacy, one place, one fold. The funnel and
 * `scripts/migrate-legacy-bg-image.js` (which persists it) both call it.
 */

/** Every key the legacy pair left on slide content. */
export const LEGACY_KEYS = ['bgImage', 'bgAlt', 'bgImagekitFileId'];

/**
 * The fold (mutates content): move a legacy `bgImage` onto the canonical
 * `slideBgImage` and reproduce the old `.has-bg` look through the generic
 * controls — light text + a bottom gradient scrim — but only when those are
 * still unset, so an author's own choices are never overwritten. A canonical
 * image wins; the legacy one is then dropped as the duplicate it was.
 * `bgImage`, `bgAlt` and the picker's `bgImagekitFileId` (a provider id
 * nothing reads) are deleted. Idempotent and a no-op on a slide that never
 * carried any of them.
 *
 * An EMPTY legacy key is folded too, as an empty canonical one. Key presence
 * carries meaning for types declaring `autoBackgroundPreset` — "never chosen"
 * (absent) versus "deliberately cleared" (present, empty) — so deleting the
 * key outright would silently re-seed a background the author had removed.
 * Folding the emptiness keeps the migration lossless.
 *
 * @param {Object} content
 * @returns {Object} the same content object
 */
export function ensureSlideBgImage(content) {
  if (!content || typeof content !== 'object') return content;
  const has = (key) => Object.prototype.hasOwnProperty.call(content, key);
  if (!LEGACY_KEYS.some(has)) return content;

  const legacy =
    typeof content.bgImage === 'string' ? content.bgImage.trim() : '';
  const canonical =
    typeof content.slideBgImage === 'string' ? content.slideBgImage.trim() : '';
  // Only adopt the legacy image when there is no canonical one (canonical wins,
  // as the render fallback had it); otherwise the legacy image is simply dropped
  // as the redundant duplicate it was.
  if (legacy && !canonical) {
    content.slideBgImage = legacy;
    // Reproduce the legacy readability treatment via the generic controls,
    // without clobbering an author's explicit choice.
    if (!content.slideBgText) content.slideBgText = 'light';
    if (!content.slideBgOverlay) content.slideBgOverlay = 'gradient-bottom';
  } else if (!legacy && has('bgImage') && !has('slideBgImage')) {
    // "Deliberately cleared" — see the note above.
    content.slideBgImage = '';
  }
  for (const key of LEGACY_KEYS) delete content[key];
  return content;
}
