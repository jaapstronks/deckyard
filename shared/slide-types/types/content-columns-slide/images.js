/**
 * ImageRef helpers for the content-columns slide (datamodel-normalisation
 * step 4: resolve the numbered `col{n}*` image keys into the canonical
 * ImageRef).
 *
 * content-columns stores its per-column image state as flat numbered slide
 * keys (`col{n}Image`, `col{n}Alt`, `col{n}ImageFit`, `col{n}ImageFocusX/Y`)
 * - per-item state masquerading as slide fields, with no array twin. Step 4
 * does not rewrite that storage; it ends the duality the ImageRef way: every
 * column's image *resolves* to one ImageRef value object through the single
 * authority below, and the type declares its defaults as config
 * (`imageDefaults`) instead of stamping them into every new deck. The old
 * defaults wrote `cover` + focus 50/50 onto all seven columns of every deck -
 * exactly the fan-out the reference doc warns freezes decks against a future
 * default change. `ensureContentColumnsImages` drops those stamped
 * default-equal values on edit, so empty means "follow the type" again.
 *
 * See docs/reference/image-property-ownership.md (target model + audit
 * criterion "every default is lookupable in the type definition").
 */

export const CONTENT_COLUMNS_MAX = 7;

/**
 * Type-level image config for content-columns (looked up, never stored per
 * slide): a column image without its own fit/focus follows these. Fit `cover`
 * renders the 16:9 crop; `focus` is the crop centre. `aspectRatio`/
 * `allowUpscale` mirror the other bundles (reserved, not enforced yet).
 */
export const CONTENT_COLUMNS_IMAGE_DEFAULTS = Object.freeze({
  fit: 'cover',
  focus: Object.freeze({ x: 50, y: 50 }),
  aspectRatio: null,
  allowUpscale: true,
});

/**
 * Single authority for a column's image resolution (1-based column number).
 * Resolution per property: own value -> type default config. renderHtml, the
 * editor controls, the focal-point cropMode and the conversion seam all read
 * through this, so the surfaces cannot drift.
 *
 * @param {Object} content - slide content
 * @param {number} n - 1-based column number
 * @returns {{
 *   src: string,
 *   alt: string,
 *   fit: 'cover'|'contain',
 *   fitExplicit: boolean,
 *   focusX: *, focusY: *,
 *   hasOwnFocus: boolean,
 * }}
 */
export function resolveContentColumnImage(content, n) {
  const get = (suffix) => content?.[`col${n}${suffix}`];
  const rawFit = get('ImageFit');
  const fitExplicit = rawFit === 'cover' || rawFit === 'contain';
  const fit = fitExplicit ? rawFit : CONTENT_COLUMNS_IMAGE_DEFAULTS.fit;
  const focusX = get('ImageFocusX') ?? '';
  const focusY = get('ImageFocusY') ?? '';
  const hasOwnFocus = focusX !== '' || focusY !== '';
  return {
    src: typeof get('Image') === 'string' ? get('Image').trim() : '',
    alt: typeof get('Alt') === 'string' ? get('Alt') : '',
    fit,
    fitExplicit,
    focusX,
    focusY,
    hasOwnFocus,
  };
}

/**
 * Editor-side migration (mutates content): drop stamped default-equal image
 * values so empty means "follow the type" again. The old type defaults wrote
 * `cover` + focus 50/50 onto every column; those were never user choices, and
 * they render identically to the looked-up default (`cover` resolves the same,
 * and a dropped 50/50 focus falls back to object-position's own 50% 50%
 * initial value). Deviating values are user choices and stay. Idempotent.
 * @param {Object} content
 * @returns {Object} the same content object
 */
export function ensureContentColumnsImages(content) {
  if (!content || typeof content !== 'object') return content;
  for (let n = 1; n <= CONTENT_COLUMNS_MAX; n += 1) {
    const fitKey = `col${n}ImageFit`;
    if (content[fitKey] === CONTENT_COLUMNS_IMAGE_DEFAULTS.fit) {
      content[fitKey] = '';
    }
    const fxKey = `col${n}ImageFocusX`;
    const fyKey = `col${n}ImageFocusY`;
    if (
      Number(content[fxKey]) === CONTENT_COLUMNS_IMAGE_DEFAULTS.focus.x &&
      Number(content[fyKey]) === CONTENT_COLUMNS_IMAGE_DEFAULTS.focus.y
    ) {
      content[fxKey] = '';
      content[fyKey] = '';
    }
  }
  return content;
}
