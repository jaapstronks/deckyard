/**
 * Shared flatten helper for the pluggable image picker.
 *
 * The picker seam (`picker-provider.js`) yields a normalized, provider-agnostic
 * `PickedImage`. Every call site persists that pick onto the flat
 * `slide.content` storage model in exactly the same way, so the flattening
 * lives here rather than being re-implemented per field. Generalizes the older
 * `applyAltFromLibraryItem` / `applyAltFromImageKitPick` split from
 * `fields/images/alt-utils.js`.
 *
 * URL placement is intentionally NOT handled here: single-image fields store a
 * string at `content[key]`, multi-image fields push into an array, and the
 * inline popover mutates an item object. Each call site owns its URL write and
 * delegates the rest (alt buffers, caption, provider id) to this helper.
 */

/**
 * @typedef {import('./picker-provider.js').PickedImage} PickedImage
 */

/**
 * Seed alt text from a normalized pick into the relevant language buffers.
 *
 * Two provider shapes collapse here:
 * - `picked.alts` (a per-language map, e.g. the native library) wins: the
 *   active + other buffers are set from it.
 * - otherwise `picked.alt` (a single seed, e.g. ImageKit's altSeed) is applied
 *   to the active, English, and other buffers as a translation baseline.
 *
 * @param {Object} opts
 * @param {PickedImage} opts.picked
 * @param {string} opts.activeLang
 * @param {string|null} [opts.otherLang]
 * @param {(lang: string, alt: string) => void} opts.setAltForLang - language-scoped setter
 */
export function applyAltFromPick({ picked, activeLang, otherLang, setAltForLang }) {
  if (typeof setAltForLang !== 'function' || !picked) return;

  const alts = picked.alts && typeof picked.alts === 'object' ? picked.alts : null;
  if (alts) {
    setAltForLang(activeLang, alts[activeLang] || '');
    if (otherLang && otherLang !== activeLang) setAltForLang(otherLang, alts[otherLang] || '');
    return;
  }

  const seed = typeof picked.alt === 'string' ? picked.alt : '';
  if (!seed) return;
  setAltForLang(activeLang, seed);
  // Seed the English buffer as a translation baseline (unless it is the active one).
  if (activeLang !== 'en-GB') setAltForLang('en-GB', seed);
  if (otherLang && otherLang !== activeLang) setAltForLang(otherLang, seed);
}

/**
 * Apply the non-alt metadata of a normalized pick onto a plain content object:
 * an opaque provider file id (under a caller-chosen key) and, when the field
 * opted into it, a resolved caption/credit string.
 *
 * @param {Object} opts
 * @param {PickedImage} opts.picked
 * @param {Object} opts.content - the object to mutate (e.g. `slide.content` or an item)
 * @param {string} [opts.providerIdKey] - where to store `picked.providerId` (e.g. 'imagekitFileId')
 * @param {boolean} [opts.allowCaption] - whether this field accepts a caption/credit
 */
export function applyPickMeta({ picked, content, providerIdKey, allowCaption = false } = {}) {
  if (!picked || !content || typeof content !== 'object') return;

  // Keep the opaque provider id in lock-step with the URL: a provider that
  // supplies one (ImageKit) sets it; any other pick (native library, S3) clears
  // it, so a native URL never carries a dangling ImageKit file id.
  if (providerIdKey) {
    if (picked.providerId) content[providerIdKey] = picked.providerId;
    else delete content[providerIdKey];
  }

  if (
    allowCaption &&
    typeof picked.caption === 'string' &&
    picked.caption.trim() &&
    typeof content.caption === 'string' &&
    !content.caption.trim()
  ) {
    content.caption = picked.caption.trim();
  }
}
