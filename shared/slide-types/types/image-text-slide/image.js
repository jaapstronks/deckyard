/**
 * ImageRef helpers for the image-text slide.
 *
 * image-text is a true singleton since D100: ONE image beside text, stored as
 * the flat ImageRef `image` / `alt` / `fit` / `focusX` / `focusY`, in the same
 * spelling image-slide uses. The plural layouts that used to live here (a `duo`
 * and two rows reading `images[0..2]`) are their own type now,
 * `image-set-slide`; stored decks are folded by the schema funnel, so nothing
 * here reads a second shape.
 *
 * The resolution chain is one link long as a result: an image without its own
 * `fit` follows the type default.
 */

/**
 * Type-level image config for image-text (the ImageRef defaults, right-hand
 * side of `content.fit ?? imageDefaults.fit`). Looked up, not stored: an empty
 * field means "follow the type", a value means "the author chose this
 * deliberately". Retroactive by design - changing a default here changes every
 * deck that never overrode it, like a theme.
 *
 * `focus` is the type-level crop default (a persons-grid would set 50/35 so
 * heads sit high); image-text uses centre. `aspectRatio`/`allowUpscale` are
 * reserved so a later need does not arrive as a fourth ad-hoc field; the
 * renderer does not enforce them yet.
 */
export const IMAGE_TEXT_IMAGE_DEFAULTS = Object.freeze({
  fit: 'cover',
  focus: Object.freeze({ x: 50, y: 50 }),
  aspectRatio: null,
  allowUpscale: true,
});

/**
 * Single authority for image-text's image resolution: own `fit` -> type
 * default, and nothing in between. renderHtml, the canvas focal-point drag and
 * the inspector all read through this, so the three cannot drift (see
 * docs/reference/image-property-ownership.md).
 *
 * Does NOT run pickAltText or apply the decorative/aria rules: those are
 * render-surface concerns. `alt` is the explicit alt string (before the
 * render's own caption/title/hard fallbacks).
 *
 * @param {Object} content - slide content
 * @returns {{
 *   src: string,
 *   alt: string,
 *   fit: 'cover'|'contain',
 *   fitExplicit: boolean,
 *   focusX: *,
 *   focusY: *,
 * }}
 */
export function resolveImageTextImage(content) {
  const c = content && typeof content === 'object' ? content : {};
  const fitExplicit = c.fit === 'cover' || c.fit === 'contain';
  return {
    src: typeof c.image === 'string' ? c.image.trim() : '',
    alt: typeof c.alt === 'string' ? c.alt.trim() : '',
    fit: fitExplicit ? c.fit : IMAGE_TEXT_IMAGE_DEFAULTS.fit,
    fitExplicit,
    focusX: c.focusX ?? '',
    focusY: c.focusY ?? '',
  };
}
