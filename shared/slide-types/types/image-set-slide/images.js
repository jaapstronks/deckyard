/**
 * images[] helpers for the image-set slide.
 *
 * An image-set slide is a `collection`: its content is 2-3 ImageRefs plus one
 * shared story (title + body + caption). `images` is the ONLY place an image
 * lives on this type — there is no flat `image`, no slide-level `alt`, no
 * slide-level `imageFit`, so there is nothing to fold and no second spelling to
 * read. That is the point of the type existing at all (D100): the plural
 * layouts used to share an id with a single-image slide, which made one id
 * carry two contracts.
 *
 * Every item is one ImageRef `{ src, alt, fit, focusX, focusY }` and the single
 * home for alt, focus and fit. No `bleed`: this type renders no edge-to-edge
 * frame, and a carried-but-unrendered key is a hidden field (D100, the same
 * rule that drops it on the image-slide → image-text conversion). See
 * docs/reference/image-property-ownership.md.
 */

/**
 * Type-level image config for image-set (the ImageRef defaults, right-hand side
 * of `images[i].fit ?? imageDefaults.fit`). Looked up, not stored: an empty
 * per-image field means "follow the type", a value means "the author chose this
 * deliberately". Retroactive by design — changing a default here changes every
 * deck that never overrode it, like a theme.
 *
 * `focus` is the type-level crop default; image-set uses centre.
 * `aspectRatio`/`allowUpscale` are reserved so a later need does not arrive as
 * a fourth ad-hoc field; the renderer does not enforce them yet.
 */
export const IMAGE_SET_IMAGE_DEFAULTS = Object.freeze({
  fit: 'cover',
  focus: Object.freeze({ x: 50, y: 50 }),
  aspectRatio: null,
  allowUpscale: true,
});

/** The most images one set may hold (three columns is the widest row that reads). */
export const IMAGE_SET_MAX_IMAGES = 3;

/** The fewest: two images are what makes this a set rather than an image-text slide. */
export const IMAGE_SET_MIN_IMAGES = 2;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Sanitize one images[] item to the canonical ImageRef shape.
 * @param {Object} raw
 * @returns {{src: string, alt: string, fit: string, focusX: *, focusY: *}}
 */
function sanitizeItem(raw) {
  const it = raw && typeof raw === 'object' ? raw : {};
  return {
    src: typeof it.src === 'string' ? it.src.trim() : '',
    alt: typeof it.alt === 'string' ? it.alt : '',
    fit: it.fit === 'contain' || it.fit === 'cover' ? it.fit : '',
    focusX: it.focusX ?? '',
    focusY: it.focusY ?? '',
  };
}

/**
 * The slide's images as sanitized items (max 3). Read-only: no legacy key is
 * consulted, because this type never had one.
 * @param {Object} content
 * @returns {Array<Object>}
 */
export function imageSetImageItems(content) {
  const arr = Array.isArray(content?.images) ? content.images : [];
  return arr.slice(0, IMAGE_SET_MAX_IMAGES).map(sanitizeItem);
}

/**
 * How many image cells the slide renders — the same count in every layout,
 * because the layout only decides *where* the set sits, never how big it is.
 * @param {Object} content
 * @returns {number}
 */
export function imageSetCellCount(content) {
  return clamp(
    imageSetImageItems(content).length,
    IMAGE_SET_MIN_IMAGES,
    IMAGE_SET_MAX_IMAGES,
  );
}

/**
 * Single authority for image-set's per-cell image resolution: item own value ->
 * type default, and nothing in between. renderHtml, the canvas focal-point drag
 * and the inspector all read through this, so the three cannot drift.
 *
 * Does NOT run pickAltText or apply the decorative/aria rules: those are
 * render-surface concerns. `altExplicit` is the item's own alt (before the
 * render's caption/title/hard fallbacks).
 *
 * @param {Object} content - slide content
 * @param {number} idx - cell index (0-based)
 * @returns {{
 *   item: {src: string, alt: string, fit: string, focusX: *, focusY: *},
 *   fit: 'cover'|'contain',
 *   fitOverride: ''|'cover'|'contain',
 *   hasOwnFocus: boolean,
 *   focusSource: {focusX: *, focusY: *},
 *   altExplicit: string,
 * }}
 */
export function resolveImageSetCell(content, idx) {
  const items = imageSetImageItems(content);
  const item = items[idx] || {
    src: '',
    alt: '',
    fit: '',
    focusX: '',
    focusY: '',
  };
  const fitOverride =
    item.fit === 'contain' || item.fit === 'cover' ? item.fit : '';
  const fit = fitOverride || IMAGE_SET_IMAGE_DEFAULTS.fit;
  const hasOwnFocus = item.focusX !== '' || item.focusY !== '';
  const altExplicit = typeof item.alt === 'string' ? item.alt.trim() : '';
  return {
    item,
    fit,
    fitOverride,
    hasOwnFocus,
    focusSource: item,
    altExplicit,
  };
}

/**
 * Editor-side normalization (mutates content): materialize `images[]` so every
 * rendered cell has a live item behind it — the inline media popover mutates
 * `images[idx]` in place, and a cell with nothing stored under it would have
 * nothing to write to.
 *
 * Shape only: pad up to the minimum, cap at the maximum, and replace a
 * non-object entry with an empty ImageRef. No value fold, because this type has
 * no legacy slide-level image keys to fold from. Idempotent, non-destructive,
 * and safe on a null/non-object argument.
 *
 * @param {Object} content
 * @returns {Object} the same content object
 */
export function ensureImageSetImages(content) {
  if (!content || typeof content !== 'object') return content;
  if (!Array.isArray(content.images)) content.images = [];
  for (let i = 0; i < content.images.length; i += 1) {
    const it = content.images[i];
    if (!it || typeof it !== 'object' || Array.isArray(it)) {
      content.images[i] = { src: '', alt: '' };
    }
  }
  while (content.images.length < IMAGE_SET_MIN_IMAGES) {
    content.images.push({ src: '', alt: '' });
  }
  if (content.images.length > IMAGE_SET_MAX_IMAGES) {
    content.images.length = IMAGE_SET_MAX_IMAGES;
  }
  return content;
}
