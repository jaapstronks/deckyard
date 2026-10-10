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
 * The read funnel folds a stored `layout` and deletes it (schema v19 -> v20,
 * B257-A2), so nothing past it ever sees the enum.
 */

import { pickAltText } from '../../helpers.js';

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
 * axis: own value -> type default. renderHtml, the editor controls and the
 * conversion seam all read through this, so the surfaces cannot drift.
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
  const fitExplicit = content?.fit === 'cover' || content?.fit === 'contain';
  const bleedExplicit = typeof content?.bleed === 'boolean';
  const fit = fitExplicit ? content.fit : IMAGE_SLIDE_IMAGE_DEFAULTS.fit;
  const bleed = bleedExplicit
    ? content.bleed
    : IMAGE_SLIDE_IMAGE_DEFAULTS.bleed;
  return { fit, bleed, fitExplicit, bleedExplicit };
}

/**
 * The image-slide picture's alt text: empty for a decorative image, else the
 * author's own (`alt`, or a legacy `altNl`/`altEn`), else the caption, title
 * or subheading, else a name read from the file. The one answer for the canvas
 * `<img alt>` and the PPTX picture's description, so a screen reader hears the
 * same thing in either.
 *
 * @param {Object} content - slide content
 * @returns {string}
 */
export function imageSlideAltText(content) {
  if (content?.imageRole === 'decorative') return '';
  const own = (key) =>
    typeof content?.[key] === 'string' ? content[key].trim() : '';
  return pickAltText({
    explicit: own('alt') || own('altNl') || own('altEn'),
    src: content?.image,
    fallbacks: [content?.caption, content?.title, content?.subheading],
    hardFallback: 'Image',
  });
}
