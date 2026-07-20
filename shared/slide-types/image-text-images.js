/**
 * images[] helpers for the image-text slide (layout catalogue phase 2 +
 * datamodel-normalisation step 2: the canonical ImageRef for focus + alt).
 *
 * The canonical multi-image field is `images` (type 'items', max 3): every
 * item is one ImageRef `{ src, alt, fit, focusX, focusY }`. Step 2 makes the
 * item the single home for **alt and focus** - `ensureImageTextImages` folds
 * the legacy slide-level `alt`/`focusX`/`focusY` into images[0] on edit, and
 * the inspector reads the item, so the focus grid finally shows the real crop
 * start (the display-baseline bug).
 *
 * **`fit` is deliberately NOT migrated yet.** Slide-level `imageFit` and
 * per-image `fit` render through two *different* CSS mechanisms (`.media`
 * padding vs `.frame` padding) that only coincide for multi-cell layouts, so a
 * data fan-out is not render-equivalent for single-cell slides. Fit becomes an
 * ImageRef property in step 3, *after* the CSS is unified onto one mechanism -
 * see docs/reference/image-property-ownership.md. Until then `imageFit` stays a
 * slide-level base fit (pending unwind), and `IMAGE_TEXT_IMAGE_DEFAULTS.fit`
 * below is only the eventual config target, not yet the live authority.
 *
 * Read fallbacks that stay (read-only) for un-migrated / legacy decks, since
 * renderHtml is pure and never migrates: the flat `image`, the slide-level
 * alt/focus (folded on next edit), the slide-level `imageFit` base, and the
 * vestigial inline `altNl`/`altEn` per-language alt (0 live decks, forks might).
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
 * renderer does not enforce them yet. `fit` is the config target for step 3
 * (see the file header) - the live fit base is still slide-level `imageFit`.
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
 * Slide-level base fit (`imageFit`), the fit for any cell without its own
 * override. This is still a live slide-level field (pending unwind to the
 * ImageRef in step 3 - see the file header); it is not a legacy read.
 */
function slideBaseFit(content) {
  return content?.imageFit === 'contain' || content?.imageFit === 'cover'
    ? content.imageFit
    : '';
}

/**
 * Single authority for image-text's per-cell image resolution. Resolution:
 *  - fit:   item override -> slide-level base `imageFit` -> type default config
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
  // Fit: item override -> slide-level base fit -> type default config.
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
 *  2. Step-2 migration to the canonical ImageRef (alt + focus only): fold the
 *     slide-level `alt`/`focusX`/`focusY` into images[0] and clear them. This
 *     is render-equivalent (the resolver already folded the same values), so
 *     snapshots stay green; what it fixes is *editing after* - the inspector
 *     now reads the canonical per-image focus, so the focus grid shows the real
 *     crop start (the display-baseline bug), not a stale empty centre.
 *
 * `imageFit` is deliberately left slide-level (see the file header): its
 * fan-out is not render-equivalent, so it waits for step 3's CSS unification.
 *
 * Idempotent and non-destructive: an item's own value always wins over the
 * folded slide value, extra items beyond the cell count are kept, and the
 * legacy `altNl`/`altEn` are left untouched as a read fallback.
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

  // NB: `imageFit` is intentionally NOT folded here. Slide-level and per-image
  // fit render through different CSS mechanisms (see the file header), so a
  // fan-out is not render-equivalent for single-cell layouts. Fit migrates to
  // the ImageRef in step 3, after the CSS is unified; until then it stays a
  // slide-level base and the resolver reads it via slideBaseFit().

  return content;
}
