/**
 * Alt text management utilities for image fields
 * Handles updating alt text in both active and other language buffers
 *
 * One setter, one write target: the alt key a field declares. The former
 * `createIndexedAltSetter` wrote numbered `logo{N}Alt` keys; the v7 -> v8 sweep
 * (#938) retired the last type declaring those, and since the setter only wrote
 * a key already present on the slide it had become a guaranteed no-op. Alt text
 * for a collection now lives on the item (`logos[].alt`), reached through this
 * setter with the item's own field key.
 */

/**
 * Create an alt setter function for a specific slide field
 * @param {Object} options - Configuration options
 * @param {Object} options.slide - The slide object
 * @param {Object} options.pres - The presentation object
 * @param {Function} options.normalizeLang - Language normalizer function
 * @param {string} options.activeLang - The active language
 * @param {string} options.fieldKey - The content field key for the alt text (e.g., 'alt', 'bgAlt')
 * @returns {Function} A function that sets alt text for a given language
 */
export function createAltSetter({
  slide,
  pres,
  normalizeLang,
  activeLang,
  fieldKey,
}) {
  return (lang, alt) => {
    const l = normalizeLang?.(lang);
    if (!l) return;

    // If this language is the active editor buffer, update the slide object directly.
    if (l === activeLang) {
      slide.content =
        slide.content && typeof slide.content === 'object' ? slide.content : {};
      slide.content[fieldKey] = typeof alt === 'string' ? alt : '';
      return;
    }

    // Otherwise, only update if the other language version exists locally.
    const ver = pres?.i18n?.versions?.[l];
    const slides = Array.isArray(ver?.slides) ? ver.slides : null;
    if (!slides) return;
    const tgt = slides.find((s) => s?.id === slide?.id);
    if (!tgt) return;
    tgt.content =
      tgt.content && typeof tgt.content === 'object' ? tgt.content : {};
    tgt.content[fieldKey] = typeof alt === 'string' ? alt : '';
  };
}

// Note: the former `applyAltFromLibraryItem` / `applyAltFromImageKitPick`
// helpers were unified into `applyAltFromPick` in `../../media/apply-pick.js`,
// which operates on the normalized picked-image contract from the picker seam.
