/**
 * Pure logic for the floating selection toolbar (editing-surfaces text
 * phase, step 2): placement math, per-button state, and the link-URL gate.
 * DOM-free on purpose so it unit-tests without a browser — the DOM wiring
 * lives in ./selection-toolbar.js (same split as reorder-geometry.js).
 */

/**
 * Position the toolbar relative to the selection: centered above the
 * selection rect, clamped to the thumb's horizontal bounds, flipped below
 * the selection when there is no room above. All rects are viewport rects
 * (getBoundingClientRect); the result is in thumb-local coordinates, ready
 * for the unscaled overlay layer.
 *
 * @param {Object} opts
 * @param {{left:number, top:number, width:number, height:number}} opts.sel -
 *   selection rect (Range.getBoundingClientRect)
 * @param {{left:number, top:number, width:number, height:number}} opts.host -
 *   thumb rect (the overlay's positioning context)
 * @param {{width:number, height:number}} opts.size - measured toolbar size
 * @param {number} [opts.gap] - distance between selection and toolbar
 * @param {number} [opts.margin] - minimum inset from the thumb edges
 * @returns {{left:number, top:number, below:boolean}|null} null when the
 *   selection rect is empty (nothing to anchor to)
 */
export function computeToolbarPlacement({ sel, host, size, gap = 8, margin = 4 }) {
  if (!sel || (sel.width <= 0 && sel.height <= 0)) return null;
  const selLeft = sel.left - host.left;
  const selTop = sel.top - host.top;
  let left = selLeft + sel.width / 2 - size.width / 2;
  const maxLeft = host.width - size.width - margin;
  left = Math.min(Math.max(margin, left), Math.max(margin, maxLeft));
  let top = selTop - size.height - gap;
  let below = false;
  // The thumb has overflow visible in inline-edit mode, but a toolbar pushed
  // above its top edge would sit over unrelated chrome; flip below instead.
  if (top < margin) {
    top = selTop + sel.height + gap;
    below = true;
  }
  return { left, top, below };
}

/**
 * Which emphasis buttons must be disabled for the current selection.
 *
 * The dialect cannot nest emphasis: `*a **b***` does not round-trip
 * (shared/markdown.js renders the inner markers literally). So the toolbar
 * refuses to CREATE nesting: inside italic-only text the Bold button is
 * disabled, and vice versa. Toggling the SAME style off stays allowed —
 * inside strong, Bold means "unbold", which is always safe.
 *
 * @param {{insideEm?: boolean, insideStrong?: boolean}} state - whether the
 *   selection sits inside an em/i resp. strong/b ancestor
 * @returns {{bold: boolean, italic: boolean}} true = disable that button
 */
export function emphasisDisables({ insideEm = false, insideStrong = false } = {}) {
  return {
    bold: insideEm && !insideStrong,
    italic: insideStrong && !insideEm,
  };
}

/**
 * Gate a URL for insertion as a slide-dialect link. Stricter than the
 * comment grammar's safeLinkUrl: the markdown serializer only keeps
 * http(s) hrefs (`serializeInlineNode`, tag A) — any other scheme would
 * silently degrade to bare text on commit, so it is rejected up front.
 *
 * @param {string} url
 * @returns {string|null} the URL if storable, otherwise null
 */
export function slideLinkUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  // Embedded control characters or whitespace are how `java\nscript:` style
  // bypasses get smuggled past a prefix check (see safeLinkUrl).
  if (/[\u0000-\u0020]/.test(raw)) return null;
  const lower = raw.toLowerCase();
  return lower.startsWith('http://') || lower.startsWith('https://') ? raw : null;
}
