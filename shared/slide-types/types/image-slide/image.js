/**
 * ImageRef helpers for the image-slide (datamodel-normalisation step 3:
 * split the conflated `layout` into `fit` + `bleed`).
 *
 * The legacy `layout` enum carried two unrelated axes under one word:
 * `full`/`centered` are fit values (cover/contain) while `bleed` is a frame
 * property (edge-to-edge) that implied cover. The canonical model stores the
 * two axes as the ImageRef properties they are:
 *
 *   fit   = 'cover' | 'contain'   (empty = follow imageDefaults.fit)
 *   bleed = true | false          (boolean; absent = follow imageDefaults.bleed)
 *
 * Mapping from the legacy enum: full -> cover/no-bleed, bleed -> cover/bleed,
 * centered -> contain/no-bleed. The split also makes `contain + bleed`
 * expressible (image fits, frame runs to the slide edge) - a legitimate state
 * the three-value enum could not represent.
 *
 * `layout` stays a read-only render fallback for un-migrated decks (renderHtml
 * is pure and never migrates); `ensureImageSlideImage` folds it on edit, the
 * same pattern as image-text's `ensureImageTextImages`.
 */

/**
 * Type-level image config for image-slide (looked up, never stored per
 * slide): an image without its own fit/bleed follows these. Only deviating
 * values are written into content, so the empty-means-follow-the-type signal
 * survives and a future default change reaches old decks (retroactive by
 * design, like a theme). `focus`/`aspectRatio`/`allowUpscale` mirror the
 * image-text bundle; the renderer does not enforce the reserved ones yet.
 */
export const IMAGE_SLIDE_IMAGE_DEFAULTS = Object.freeze({
  fit: 'cover',
  bleed: false,
  focus: Object.freeze({ x: 50, y: 50 }),
  aspectRatio: null,
  allowUpscale: true,
});

/**
 * Single authority for the image-slide fit/bleed resolution. Resolution per
 * axis: own value -> legacy `layout` (un-migrated decks, read-only) -> type
 * default. renderHtml, the editor controls and the conversion seam all read
 * through this, so the surfaces cannot drift.
 *
 * @param {Object} content - slide content
 * @returns {{
 *   fit: 'cover'|'contain',
 *   bleed: boolean,
 *   fitExplicit: boolean,
 *   bleedExplicit: boolean,
 * }}
 */
export function resolveImageSlideImage(content) {
  const legacy = String(content?.layout || '').trim();
  const fitExplicit =
    content?.fit === 'cover' || content?.fit === 'contain';
  const bleedExplicit = typeof content?.bleed === 'boolean';
  const fit = fitExplicit
    ? content.fit
    : legacy === 'centered'
      ? 'contain'
      : IMAGE_SLIDE_IMAGE_DEFAULTS.fit;
  const bleed = bleedExplicit
    ? content.bleed
    : legacy === 'bleed'
      ? true
      : IMAGE_SLIDE_IMAGE_DEFAULTS.bleed;
  return { fit, bleed, fitExplicit, bleedExplicit };
}

/**
 * Editor-side migration (mutates content): fold the legacy `layout` into the
 * canonical `fit`/`bleed` and clear it. Values equal to the type default are
 * dropped, not stamped (empty keeps meaning "follow the type"); an explicit
 * own value always wins over the folded legacy one. Idempotent.
 * @param {Object} content
 * @returns {Object} the same content object
 */
export function ensureImageSlideImage(content) {
  if (!content || typeof content !== 'object') return content;
  const legacy = String(content.layout || '').trim();
  if (!legacy) return content;
  const { fit, bleed } = resolveImageSlideImage(content);
  if (
    fit !== IMAGE_SLIDE_IMAGE_DEFAULTS.fit &&
    !(content.fit === 'cover' || content.fit === 'contain')
  ) {
    content.fit = fit;
  }
  if (
    bleed !== IMAGE_SLIDE_IMAGE_DEFAULTS.bleed &&
    typeof content.bleed !== 'boolean'
  ) {
    content.bleed = bleed;
  }
  content.layout = '';
  return content;
}
