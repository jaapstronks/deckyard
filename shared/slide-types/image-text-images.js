/**
 * images[] helpers for the image-text slide (layout catalogue phase 2).
 *
 * The canonical multi-image field is `images` (type 'items', max 3, per-image
 * src/alt/fit/focusX/focusY). Legacy decks carry a single flat `image` with
 * slide-level alt/imageFit/focusX/focusY; the read helpers fold that shape
 * into item 0 so unmigrated content renders identically. The mutating helper
 * (`ensureImageTextImages`) migrates flat -> images[0] and pads placeholder
 * items up to the active layout's cell count; it is only called from the
 * editor - renderHtml stays pure and pads visually.
 */

export const IMAGE_TEXT_MAX_IMAGES = 3;

/** Layouts that show more than one image cell. */
const MULTI_CELL_LAYOUTS = new Set(['duo', 'row-top', 'row-bottom']);

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Sanitize one images[] item to the canonical shape.
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
 * Read the slide's images as sanitized items (max 3). When images[] is empty
 * the legacy flat `image` becomes item 0 (its slide-level alt/fit/focus stay
 * where they are; renderHtml falls back to them for item 0).
 * @param {Object} content
 * @returns {Array<Object>}
 */
export function imageTextImageItems(content) {
  const arr = Array.isArray(content?.images) ? content.images : [];
  if (arr.length) {
    return arr.slice(0, IMAGE_TEXT_MAX_IMAGES).map(sanitizeItem);
  }
  const legacy =
    typeof content?.image === 'string' ? content.image.trim() : '';
  if (!legacy) return [];
  return [sanitizeItem({ src: legacy })];
}

/**
 * How many image cells the current layout renders. Rows follow the number of
 * added images (2 or 3, per the catalogue's row model); duo is fixed at two;
 * split and corner show one.
 * @param {Object} content
 * @returns {number}
 */
export function imageTextCellCount(content) {
  const layout = String(content?.layout || 'split');
  if (layout === 'duo') return 2;
  if (layout === 'row-top' || layout === 'row-bottom') {
    return clamp(imageTextImageItems(content).length, 2, IMAGE_TEXT_MAX_IMAGES);
  }
  return 1;
}

/**
 * Whether the layout renders multiple image cells.
 * @param {Object} content
 * @returns {boolean}
 */
export function isMultiImageLayout(content) {
  return MULTI_CELL_LAYOUTS.has(String(content?.layout || 'split'));
}

/**
 * Editor-side normalization (mutates content): migrate the legacy flat
 * `image` into images[0] and pad empty items up to the active layout's cell
 * count so every rendered cell has a live item behind it (the inline media
 * popover mutates `images[idx]` in place). Idempotent; never destructive -
 * extra items beyond the cell count are kept so switching layouts remembers
 * the images. Slide-level alt/fit/focus are NOT copied into the item: they
 * keep working as item-0 fallbacks, which preserves alt translations.
 * @param {Object} content
 * @returns {Object} the same content object
 */
export function ensureImageTextImages(content) {
  if (!content || typeof content !== 'object') return content;
  if (!Array.isArray(content.images)) content.images = [];
  const legacy =
    typeof content.image === 'string' ? content.image.trim() : '';
  const hasFilledItem = content.images.some(
    (it) => typeof it?.src === 'string' && it.src.trim()
  );
  if (legacy && !hasFilledItem) {
    if (content.images.length) {
      content.images[0] = { ...content.images[0], src: legacy };
    } else {
      content.images.push({ src: legacy, alt: '' });
    }
    content.image = '';
  }
  const min = imageTextCellCount(content);
  while (content.images.length < min) {
    content.images.push({ src: '', alt: '' });
  }
  if (content.images.length > IMAGE_TEXT_MAX_IMAGES) {
    content.images.length = IMAGE_TEXT_MAX_IMAGES;
  }
  return content;
}
