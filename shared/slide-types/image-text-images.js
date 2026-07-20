/**
 * images[] helpers for the image-text slide (layout catalogue phase 2 +
 * datamodel-normalisation steps 2/2b: the canonical ImageRef).
 *
 * The canonical multi-image field is `images` (type 'items', max 3): every
 * item is one ImageRef `{ src, alt, fit, focusX, focusY }` and the single home
 * for **alt, focus and fit**. `ensureImageTextImages` folds the legacy
 * slide-level values into the items on edit: `alt`/`focusX`/`focusY` into
 * images[0] (step 2, which fixed the display-baseline bug), and `imageFit`
 * across the items (step 2b - a fan-out only when it deviates from the type
 * default, so the empty-means-follow-the-type signal survives). The fan-out
 * became render-neutral once the fit CSS unified onto one frame-based
 * mechanism (every frame carries its effective is-fit-* class); see
 * docs/reference/image-property-ownership.md.
 *
 * Read fallbacks that stay (read-only) for un-migrated / legacy decks, since
 * renderHtml is pure and never migrates: the flat `image`, the slide-level
 * alt/focus/`imageFit` (all folded on next edit), and the vestigial inline
 * `altNl`/`altEn` per-language alt (0 live decks, forks might).
 */

/**
 * Type-level image config for image-text (the ImageRef defaults, right-hand
 * side of the eventual `images[i].fit ?? imageDefaults.fit`). Looked up, not
 * stored: an empty per-image field means "follow the type", a value means "the
 * user chose this deliberately". Retroactive by design - changing a default
 * here changes every deck that never overrode it, like a theme.
 *
 * `focus` is the type-level crop default (a persons-grid would set 50/35 so
 * heads sit high); image-text uses centre. `aspectRatio`/`allowUpscale` are
 * reserved so a later need does not arrive as a fourth ad-hoc field; the
 * renderer does not enforce them yet. `fit` is live since step 2b: an item
 * without its own fit follows this value.
 */
export const IMAGE_TEXT_IMAGE_DEFAULTS = Object.freeze({
  fit: 'cover',
  focus: Object.freeze({ x: 50, y: 50 }),
  aspectRatio: null,
  allowUpscale: true,
});

export const IMAGE_TEXT_MAX_IMAGES = 3;

/** Layouts that show more than one image cell. */
const MULTI_CELL_LAYOUTS = new Set(['duo', 'row-top', 'row-bottom']);

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Sanitize one images[] item to the canonical ImageRef shape. `bleed` is
 * carried through when set (an ImageRef property image-text does not render
 * yet, but that e.g. an image-slide conversion delivers losslessly - see the
 * fit/bleed split in docs/reference/image-property-ownership.md).
 * @param {Object} raw
 * @returns {{src: string, alt: string, fit: string, focusX: *, focusY: *, bleed?: boolean}}
 */
function sanitizeItem(raw) {
  const it = raw && typeof raw === 'object' ? raw : {};
  const out = {
    src: typeof it.src === 'string' ? it.src.trim() : '',
    alt: typeof it.alt === 'string' ? it.alt : '',
    fit: it.fit === 'contain' || it.fit === 'cover' ? it.fit : '',
    focusX: it.focusX ?? '',
    focusY: it.focusY ?? '',
  };
  if (it.bleed === true) out.bleed = true;
  return out;
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
 * Legacy slide-level base fit (`imageFit`). Read-only fallback for un-migrated
 * decks, like the flat `image`: `ensureImageTextImages` folds it into the
 * items and clears it on the next edit (step 2b). Not a live write target.
 */
function slideBaseFit(content) {
  return content?.imageFit === 'contain' || content?.imageFit === 'cover'
    ? content.imageFit
    : '';
}

/**
 * Single authority for image-text's per-cell image resolution. Resolution:
 *  - fit:   item own fit -> legacy slide-level `imageFit` (un-migrated) -> type default config
 *  - focus: item own crop -> slide-level focus (cell 0 only, un-migrated) -> default
 *  - alt:   item own alt   -> slide-level alt/altNl/altEn (cell 0 only) -> ''
 * renderHtml, the canvas focal-point drag and the inspector all read through
 * this, so the three cannot drift (see docs/reference/image-property-ownership.md).
 *
 * Does NOT run pickAltText or apply the decorative/aria rules: those are
 * render-surface concerns. `altExplicit` is the effective explicit alt string
 * (before the render's own caption/title/hard fallbacks).
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
export function resolveImageTextCell(content, idx) {
  const items = imageTextImageItems(content);
  const item = items[idx] || { src: '', alt: '', fit: '', focusX: '', focusY: '' };
  // Fit: item own fit -> legacy slide-level fit (un-migrated) -> type default.
  const fitOverride = item.fit === 'contain' || item.fit === 'cover' ? item.fit : '';
  const fit = fitOverride || slideBaseFit(content) || IMAGE_TEXT_IMAGE_DEFAULTS.fit;
  // A cell has its own crop point once either axis is set; cell 0 without one
  // reads the legacy slide-level focus, later cells read their own (empty ->
  // renderer default, which equals IMAGE_TEXT_IMAGE_DEFAULTS.focus 50/50).
  // Mirrors objectPositionStyleAttrFromFocus's input.
  const hasOwnFocus = item.focusX !== '' || item.focusY !== '';
  const focusSource = hasOwnFocus || idx > 0 ? item : content || {};
  const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');
  const slideAlt = trimmed(content?.alt) || trimmed(content?.altNl) || trimmed(content?.altEn);
  const ownAlt = trimmed(item.alt);
  const altExplicit = ownAlt || (idx === 0 ? slideAlt : '');
  return { item, fit, fitOverride, hasOwnFocus, focusSource, altExplicit };
}

/**
 * Editor-side normalization (mutates content). Two jobs:
 *
 *  1. Shape: migrate the legacy flat `image` into images[0] and pad empty
 *     items up to the active layout's cell count, so every rendered cell has a
 *     live item behind it (the inline media popover mutates `images[idx]`).
 *
 *  2. Migration to the canonical ImageRef: fold the slide-level
 *     `alt`/`focusX`/`focusY` into images[0] (step 2) and `imageFit` across
 *     the items (step 2b), then clear them. Render-equivalent (the resolver
 *     already folded the same values), so snapshots stay green; what it fixes
 *     is *editing after* - the inspector reads the canonical per-image values.
 *     The fit fold preserves the empty-means-follow-the-type signal: a base
 *     fit equal to the type default is simply dropped, never stamped onto the
 *     items (that fan-out would freeze the deck against a future default
 *     change); only a deviating base fit fans out.
 *
 * Idempotent and non-destructive: an item's own value always wins over the
 * folded slide value, extra items beyond the cell count are kept (a deviating
 * base fit fans out to those too, so switching layouts keeps their look), and
 * the legacy `altNl`/`altEn` are left untouched as a read fallback.
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

  // --- Step-2 fold: canonicalize the slide-level ImageRef props into items ---
  if (content.images.length) {
    const first = content.images[0];
    if (first && typeof first === 'object') {
      // Alt: fold into item 0 (item.alt already wins). Keep altNl/altEn.
      if (!(typeof first.alt === 'string' && first.alt.trim())) {
        const slideAlt = typeof content.alt === 'string' ? content.alt : '';
        if (slideAlt.trim()) first.alt = slideAlt;
      }
      // Focus: fold into item 0 when it has no own crop point.
      const itemHasFocus = first.focusX !== '' && first.focusX != null
        || first.focusY !== '' && first.focusY != null;
      if (!itemHasFocus) {
        if (content.focusX !== '' && content.focusX != null) first.focusX = content.focusX;
        if (content.focusY !== '' && content.focusY != null) first.focusY = content.focusY;
      }
    }
  }
  if (typeof content.alt === 'string' && content.alt.trim()) content.alt = '';
  if (content.focusX !== '' && content.focusX != null) content.focusX = '';
  if (content.focusY !== '' && content.focusY != null) content.focusY = '';

  // --- Step-2b fold: fit becomes an ImageRef property ---
  // A base fit equal to the type default is dropped without touching the
  // items (empty keeps meaning "follow the type"); a deviating base fit fans
  // out to every item without its own fit - render-neutral since the CSS
  // unified on one frame-based mechanism.
  const baseFit = slideBaseFit(content);
  if (baseFit && baseFit !== IMAGE_TEXT_IMAGE_DEFAULTS.fit) {
    for (const it of content.images) {
      if (it && typeof it === 'object' && it.fit !== 'cover' && it.fit !== 'contain') {
        it.fit = baseFit;
      }
    }
  }
  if (content.imageFit !== '' && content.imageFit != null) content.imageFit = '';

  return content;
}
